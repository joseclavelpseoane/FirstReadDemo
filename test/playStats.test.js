import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LABEL, scoringSide, netYards, filterPlays, downSplit, downDistanceGrid,
  bucketOf, buildDriveResults, sideStats, playerStats,
} from "../src/playStats.js";

// Constructor de jugada: solo hay que nombrar lo que la prueba mira.
let seq = 0;
const play = (o = {}) => ({
  sequence: ++seq, quarter: "Q1", down: 1, yards_to_go: 10, yards_gained: 0,
  has_offense: true, has_defense: false, has_special: false,
  label: LABEL.RUSH, outcome: null, drive_id: 1, ...o,
});
const snap = (name, jersey) => ({ name, jersey });

// ─── El marcador se deriva: SAFETY invierte el lado ───────────────────────────

test("scoringSide da los puntos a quien posee el balón", () => {
  assert.equal(scoringSide(play({ has_offense: true, outcome: "TD" })), "us");
  assert.equal(scoringSide(play({ has_offense: false, has_defense: true, outcome: "TD" })), "rival");
});

test("scoringSide invierte en SAFETY: puntúa el que DEFIENDE", () => {
  // La razón de que este lado no pueda derivarse de has_offense/has_defense a secas.
  // Si esto se rompe, el marcador de todo el partido se descuadra en 2 puntos.
  assert.equal(scoringSide(play({ has_offense: true, outcome: "SAFETY" })), "rival");
  assert.equal(scoringSide(play({ has_offense: false, has_defense: true, outcome: "SAFETY" })), "us");
});

test("scoringSide no atribuye una jugada que no es de nadie", () => {
  assert.equal(scoringSide(play({ has_offense: false, has_defense: false })), null);
});

// ─── Yardas netas vs yardas de jugador ───────────────────────────────────────

test("netYards suma las penalizaciones que yards_gained deja fuera a propósito", () => {
  // yards_gained NUNCA lleva la penalización (inflaría las stats del jugador);
  // netYards existe para caminar la posición de campo, que sí necesita el efecto real.
  const p = play({ yards_gained: 7, offense: { penalty_yards: -10 } });
  assert.equal(netYards(p), -3);
  assert.equal(netYards(play({ yards_gained: 4 })), 4, "sin penalización, es la yarda limpia");
  assert.equal(netYards(play({ yards_gained: null })), 0, "null no contamina la suma");
});

// ─── Filtro situacional ──────────────────────────────────────────────────────

test("filterPlays recorta por periodo y por down sobre el mismo stream", () => {
  const plays = [
    play({ quarter: "Q1", down: 1 }), play({ quarter: "Q3", down: 3 }),
    play({ quarter: "Q4", down: 3 }), play({ quarter: "OT", down: 1 }),
  ];
  assert.equal(filterPlays(plays, { period: "H1" }).length, 1);
  assert.equal(filterPlays(plays, { period: "H2" }).length, 3, "OT va con la 2ª parte");
  assert.equal(filterPlays(plays, { down: 3 }).length, 2);
  assert.equal(filterPlays(plays, { period: "H2", down: 3 }).length, 2);
  assert.equal(filterPlays(plays, {}).length, 4, "sin filtro no se pierde nada");
});

// ─── Success rate: los umbrales estándar por down ────────────────────────────

test("el éxito depende del down: 40% en 1º, 60% en 2º, conversión en 3º/4º", () => {
  const of = (down, gained, togo = 10) =>
    downSplit([play({ down, yards_gained: gained, yards_to_go: togo })], "us").total.succ;

  assert.equal(of(1, 4), 1, "1º y 10: 4 yardas llegan al 40%");
  assert.equal(of(1, 3), 0);
  assert.equal(of(2, 6), 1, "2º y 10: hacen falta 6");
  assert.equal(of(2, 5), 0);
  assert.equal(of(3, 10), 1, "en 3º el éxito ES convertir");
  assert.equal(of(3, 9), 0, "9 de 10 en 3º no es medio éxito, es un punt");
});

test("un SACK cuenta como jugada de pase (convención de charting)", () => {
  const plays = [
    play({ label: LABEL.RUSH, yards_gained: 5 }),
    play({ label: LABEL.SACK, yards_gained: -8 }),
    play({ label: LABEL.PASS_INCOMPLETE, yards_gained: 0 }),
  ];
  const s = downSplit(plays, "us");
  assert.equal(s.run.plays, 1);
  assert.equal(s.pass.plays, 2, "sack e incompleto son dropbacks");
  assert.equal(s.runPct, 1 / 3);
});

test("downSplit ignora lo que no es un snap con tipo", () => {
  const s = downSplit([play({ label: null, outcome: "PUNT" })], "us");
  assert.equal(s.total.plays, 0, "una penalización suelta no es ni carrera ni pase");
});

// ─── Down × distancia ────────────────────────────────────────────────────────

test("los cubos de distancia son corto 1-3 / medio 4-7 / largo 8+", () => {
  assert.equal(bucketOf(1), "short");
  assert.equal(bucketOf(3), "short");
  assert.equal(bucketOf(4), "med");
  assert.equal(bucketOf(7), "med");
  assert.equal(bucketOf(8), "long");
  assert.equal(bucketOf(25), "long");
  assert.equal(bucketOf(null), null, "sin distancia registrada no se inventa cubo");
});

test("downDistanceGrid devuelve la fracción cruda, no solo el porcentaje", () => {
  // Sin denominador, un 100% de 1/1 miente. La rejilla tiene que poder enseñar ambos.
  const plays = [
    play({ down: 3, yards_to_go: 2, yards_gained: 5 }),
    play({ down: 3, yards_to_go: 2, yards_gained: 0 }),
    play({ down: 3, yards_to_go: 12, yards_gained: 15 }),
  ];
  const g = downDistanceGrid(plays, "us");
  assert.equal(g["3"].short.plays, 2);
  assert.equal(g["3"].short.succ, 1);
  assert.equal(g["3"].short.succRate, 0.5);
  assert.equal(g["3"].long.plays, 1);
  assert.equal(g["3"].all.plays, 3);
  assert.equal(g["1"].all.plays, 0, "un down sin jugadas existe y vale cero, no undefined");
});

// ─── Resultado de drive ──────────────────────────────────────────────────────

test("el resultado de un drive es el de su ÚLTIMA jugada, no la primera que lo diga", () => {
  const plays = [
    play({ drive_id: 7, sequence: 3, outcome: "TD" }),
    play({ drive_id: 7, sequence: 1, outcome: null }),
    play({ drive_id: 7, sequence: 2, outcome: null }),
  ];
  assert.deepEqual(buildDriveResults(plays), { 7: "TD" });
});

test("buildDriveResults ignora las jugadas sin drive (kickoffs sueltos)", () => {
  assert.deepEqual(buildDriveResults([play({ drive_id: null, outcome: "PUNT" })]), {});
});

// ─── Stats por lado ──────────────────────────────────────────────────────────

const drive = (o = {}) => ({ id: 1, possession_team_side: "us", segment_type: "drive", start_field_position: "OWN 25", ...o });

test("sideStats cuenta conversiones de 3er down y explosivas", () => {
  const plays = [
    play({ drive_id: 1, down: 3, yards_to_go: 4, yards_gained: 12 }),
    play({ drive_id: 1, down: 3, yards_to_go: 8, yards_gained: 2 }),
    play({ drive_id: 1, down: 1, yards_to_go: 10, yards_gained: 10 }),
  ];
  const s = sideStats(plays, [drive()], "us", buildDriveResults(plays));
  assert.equal(s.thirdAtt, 2);
  assert.equal(s.thirdConv, 1);
  assert.equal(s.firstDowns, 2, "la de 1º y 10 que gana 10 también es un primer down");
  assert.equal(s.explosive, 2, "≥10 yardas");
  assert.equal(s.yards, 24);
  assert.equal(s.ypp, 8);
});

test("un kickoff NO se cuela como drive", () => {
  // La trampa: los kickoffs viven en la misma tabla que los drives y también llevan
  // possession_team_side. Sin el filtro por segment_type se les caminaría la posición
  // de campo y los viajes a zona roja saldrían inflados.
  const plays = [play({ drive_id: 1, yards_gained: 3 })];
  const drives = [drive(), drive({ id: 2, segment_type: "kickoff", start_field_position: "OPP 15" })];
  const s = sideStats(plays, drives, "us", {});
  assert.equal(s.redTrips, 0, "el kickoff arrancaba en zona roja y aun así no cuenta");
});

test("la zona roja se camina desde la yarda de inicio del drive", () => {
  const plays = [
    play({ drive_id: 1, sequence: 1, yards_gained: 40 }),
    play({ drive_id: 1, sequence: 2, yards_gained: 20 }),  // OWN 25 → 65 → 85: entra
  ];
  const s = sideStats(plays, [drive()], "us", {});
  assert.equal(s.redTrips, 1);
  assert.equal(s.redTD, 0, "llegar no es anotar");
});

test("un TD cuenta como viaje a zona roja aunque el drive esté infra-registrado", () => {
  // Backstop deliberado: en defensa se registran menos jugadas, y un TD pasa por la
  // zona roja sí o sí. Sin esto, un TD daría 0/0 en eficiencia de zona roja.
  const plays = [play({ drive_id: 1, yards_gained: 2, outcome: "TD" })];
  const s = sideStats(plays, [drive()], "us", buildDriveResults(plays));
  assert.equal(s.redTrips, 1);
  assert.equal(s.redTD, 1);
});

test("sideStats separa yardas de pase y de carrera, y completos de intentos", () => {
  const plays = [
    play({ label: LABEL.PASS, yards_gained: 30 }),
    play({ label: LABEL.PASS_INCOMPLETE, yards_gained: 0 }),
    play({ label: LABEL.RUSH, yards_gained: 6 }),
  ];
  const s = sideStats(plays, [drive()], "us", {});
  assert.equal(s.passYds, 30);
  assert.equal(s.runYds, 6);
  assert.equal(s.passAtt, 2);
  assert.equal(s.passComp, 1);
});

test("la defensa se lee como el ataque rival, sobre los mismos snaps", () => {
  const plays = [play({ has_offense: false, has_defense: true, yards_gained: 9 })];
  const drives = [drive({ possession_team_side: "rival" })];
  const s = sideStats(plays, drives, "rival", {});
  assert.equal(s.plays, 1);
  assert.equal(s.yards, 9);
});

// ─── Stats por jugador ───────────────────────────────────────────────────────

const byName = (rows, name) => rows.find(r => r.name === name);

test("un two-way acumula ataque y defensa bajo la misma entrada", () => {
  // Misma persona = misma roster_id. Si esto se rompe, el jugador aparece dos veces
  // en el box score y ninguna de las dos filas es él.
  const plays = [
    play({ has_offense: true, label: LABEL.RUSH, yards_gained: 12,
           offense: { executor_roster_id: 4, executor_snapshot: snap("Nieto", 22) } }),
    play({ has_offense: false, has_defense: true,
           defense: { tackler_roster_id: 4, tackler_snapshot: snap("Nieto", 22) } }),
  ];
  const rows = playerStats(plays);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].rush.yds, 12);
  assert.equal(rows[0].def.tackles, 1);
});

test("pase: el pasador suma intento siempre, yardas solo si se completa", () => {
  const plays = [
    play({ label: LABEL.PASS, yards_gained: 25, outcome: "TD",
           offense: { executor_roster_id: 1, executor_snapshot: snap("QB", 7),
                      receiver_roster_id: 2, receiver_snapshot: snap("WR", 80) } }),
    play({ label: LABEL.PASS_INCOMPLETE, yards_gained: 0,
           offense: { executor_roster_id: 1, executor_snapshot: snap("QB", 7),
                      receiver_roster_id: 2, receiver_snapshot: snap("WR", 80) } }),
  ];
  const rows = playerStats(plays);
  const qb = byName(rows, "QB"), wr = byName(rows, "WR");
  assert.equal(qb.pass.att, 2);
  assert.equal(qb.pass.cmp, 1);
  assert.equal(qb.pass.yds, 25);
  assert.equal(qb.pass.td, 1);
  assert.equal(wr.rec.tgt, 2, "un incompleto sigue siendo un objetivo");
  assert.equal(wr.rec.rec, 1);
  assert.equal(wr.rec.yds, 25);
});

test("un sack es placaje y sack; una INT o un balón suelto NO son placaje", () => {
  const def = (extra) => play({
    has_offense: false, has_defense: true,
    defense: { tackler_roster_id: 9, tackler_snapshot: snap("LB", 55), ...extra },
  });
  const rows = playerStats([def({ def_sack: 1 }), def({ def_interception: 1 }), def({ recovered_fumble: 1 }), def({})]);
  const lb = rows[0];
  assert.equal(lb.def.plays, 4);
  assert.equal(lb.def.sacks, 1);
  assert.equal(lb.def.ints, 1);
  assert.equal(lb.def.fumRec, 1);
  assert.equal(lb.def.tackles, 2, "el sack y el placaje limpio; la INT y la recuperación no");
});

test("punt: se guarda el retorno concedido, que es lo que permite el punt NETO", () => {
  // El bruto mide la pierna. El neto mide la posición de campo ganada, que es para
  // lo que se despeja — por eso el retorno del rival se acumula en el punteador.
  const plays = [play({
    has_offense: false, has_special: true, outcome: "PUNT",
    special: { special_type: "PUNT", kick_yards: 45, return_yards: 12,
               kicker_roster_id: 3, kicker_snapshot: snap("P", 19),
               returner_roster_id: 99, returner_snapshot: snap("RivalRet", 1) },
  })];
  const rows = playerStats(plays);
  const p = byName(rows, "P");
  assert.equal(p.kick.punts, 1);
  assert.equal(p.kick.puntYds, 45);
  assert.equal(p.kick.puntRetYds, 12);
  assert.equal(p.kick.puntYds - p.kick.puntRetYds, 33, "neto");
  assert.equal(byName(rows, "RivalRet").kick.ret, 0, "en un punt el retornador es del rival: no se le acredita");
});

test("el FG más largo solo cuenta los METIDOS", () => {
  const fg = (dist, good) => play({
    has_offense: false, has_special: true,
    special: { special_type: "FG", fg_distance: dist, fg_good: good,
               kicker_roster_id: 5, kicker_snapshot: snap("K", 3) },
  });
  const k = playerStats([fg(30, 1), fg(55, 0)])[0];
  assert.equal(k.kick.fga, 2);
  assert.equal(k.kick.fgm, 1);
  assert.equal(k.kick.fgLong, 30, "un fallo de 55 no es un récord de alcance");
});

test("un touchback no es un retorno: nadie lo devolvió", () => {
  const ko = (touchback) => play({
    has_offense: false, has_special: true,
    special: { special_type: "KICKOFF", return_yards: 0, is_touchback: touchback,
               returner_roster_id: 6, returner_snapshot: snap("RET", 21) },
  });
  assert.equal(playerStats([ko(1)])[0].kick.ret, 0);
  assert.equal(playerStats([ko(0)])[0].kick.ret, 1);
});

test("el placaje en cobertura no infla los placajes defensivos", () => {
  // Son unidades distintas. Mezclarlos infla al linebacker que además juega especiales.
  const plays = [play({
    has_offense: false, has_special: true,
    special: { special_type: "KICKOFF", tackler_roster_id: 9, tackler_snapshot: snap("LB", 55) },
  })];
  const lb = playerStats(plays)[0];
  assert.equal(lb.kick.covTackles, 1);
  assert.equal(lb.def.tackles, 0);
});

test("una jugada sin gente no genera filas fantasma", () => {
  assert.deepEqual(playerStats([play({ offense: null }), play({ has_offense: false, has_defense: true, defense: {} })]), []);
});
