// Derivación de estadísticas a partir de las jugadas.
// FUENTE ÚNICA: nada se guarda como "stat"; todo se calcula aquí desde PLAY.
// Este módulo es la ÚNICA definición de cómo una jugada se convierte en número,
// para que la vista de partido y la de temporada nunca puedan discrepar.
import { parseSpot, advance, inRedZone } from "./fieldPosition.js";

// Etiquetas de jugada. Las produce la factoría (PlayByPlayEntry) y las consume esta
// derivación: viven aquí una sola vez para que no puedan desincronizarse por un typo.
export const LABEL = {
  RUSH: "CARRERA",
  PASS: "PASE",
  PASS_INCOMPLETE: "PASE INCOMP.",
  SACK: "SACK",   // dropback sin lanzamiento: NO es intento de pase; yardas negativas, consume down.
};

// Lado al que van los puntos de una jugada. Normalmente el que posee el balón
// (ataque = nosotros). El SAFETY invierte: puntúa el equipo que DEFIENDE, no el que
// posee — por eso no se puede derivar solo de has_offense/has_defense.
export function scoringSide(p) {
  const flip = p.outcome === "SAFETY";
  if (p.has_offense) return flip ? "rival" : "us";
  if (p.has_defense) return flip ? "us" : "rival";
  return null;
}

const num = v => (v == null ? 0 : Number(v));
export const avg = (y, n) => (n ? (y / n).toFixed(1) : "0.0");

// Cuánto se mueve REALMENTE el balón en una jugada: su resultado en el campo +
// cualquier penalización enforced sobre ella. yards_gained en sí NUNCA incluye la
// penalización (así las estadísticas de jugador no se inflan) — esto es solo para
// caminar la posición de campo, que sí necesita el efecto neto completo.
export function netYards(p) {
  return num(p.yards_gained) + num(p.offense?.penalty_yards) + num(p.defense?.penalty_yards);
}

// Filtro situacional sobre el stream de jugadas. ESTO es la base del motor de stats:
// cada panel situacional (un cuarto, una parte, un down) es este filtro + la MISMA derivación
// (sideStats/playerStats). No hay código de stats por vista, solo un subconjunto distinto.
// Filtra por campos ya guardados en la jugada (cuarto, down) → play-level, exacto.
// (Zona/2-min quedan fuera: necesitan posición de campo / reloj, que se derivan aparte.)
const HALF_1 = ["Q1", "Q2"], HALF_2 = ["Q3", "Q4", "OT"];
export function filterPlays(plays, f = {}) {
  return plays.filter(p => {
    if (f.period && f.period !== "all") {
      if (f.period === "H1") { if (!HALF_1.includes(p.quarter)) return false; }
      else if (f.period === "H2") { if (!HALF_2.includes(p.quarter)) return false; }
      else if (p.quarter !== f.period) return false;
    }
    if (f.down && f.down !== "all" && String(p.down) !== String(f.down)) return false;
    return true;
  });
}

// ── Lente de DOWN: tendencia carrera/pase + eficiencia, por down ──────────────
// Convención de charting: un SACK es una jugada de pase (dropback), cuenta como pase.
const isRunCall  = p => p.label === LABEL.RUSH;
const isPassCall = p => p.label === LABEL.PASS || p.label === LABEL.PASS_INCOMPLETE || p.label === LABEL.SACK;

// Success rate (estándar analítico): una jugada tiene "éxito" si gana suficiente de la distancia
// según el down — 1º ≥40%, 2º ≥60%, 3º/4º ≥100% (en 3º/4º el éxito ES la conversión).
const SUCCESS_NEED = { "1": 0.4, "2": 0.6, "3": 1, "4": 1 };
function isSuccess(p) {
  const togo = num(p.yards_to_go);
  const gained = num(p.yards_gained);
  if (togo <= 0) return gained > 0;   // sin distancia registrada: éxito = ganar algo
  return gained >= (SUCCESS_NEED[String(p.down)] ?? 0.5) * togo;
}

// Reparto carrera/pase de un lado en un subconjunto ya filtrado (un down, y lo que el filtro imponga).
// Solo cuenta snaps con tipo (una penalización suelta no es ni carrera ni pase).
export function downSplit(plays, side) {
  const sp = plays.filter(p => (side === "us" ? p.has_offense : p.has_defense) && (isRunCall(p) || isPassCall(p)));
  const agg = list => {
    const n = list.length;
    const yds = list.reduce((s, p) => s + num(p.yards_gained), 0);
    const succ = list.filter(isSuccess).length;
    return { plays: n, yds, ypp: n ? yds / n : 0, succ, succRate: n ? succ / n : 0 };
  };
  const run = agg(sp.filter(isRunCall));
  const pass = agg(sp.filter(isPassCall));
  const togo = sp.filter(p => p.yards_to_go != null);
  return {
    run, pass, total: agg(sp),
    runPct: sp.length ? run.plays / sp.length : 0,
    avgToGo: togo.length ? togo.reduce((s, p) => s + num(p.yards_to_go), 0) / togo.length : 0,
  };
}

// ─── Down × distancia ──────────────────────────────────────────────────────────
// El corte que de verdad usa un entrenador: no "cómo vamos en 3er down", sino "cómo vamos
// en 3º y largo", que es una situación distinta con otro playbook. No necesita ningún dato
// nuevo — son umbrales sobre `yards_to_go`, que ya se captura en cada jugada.
//
// Cubos estándar del análisis de fútbol americano: corto 1-3, medio 4-7, largo 8+.
export const DIST_BUCKETS = [
  { id: "short", label: "Corto", hint: "1-3", test: y => y <= 3 },
  { id: "med",   label: "Medio", hint: "4-7", test: y => y >= 4 && y <= 7 },
  { id: "long",  label: "Largo", hint: "8+",  test: y => y >= 8 },
];

export const bucketOf = togo => (togo == null ? null : (DIST_BUCKETS.find(b => b.test(num(togo)))?.id ?? null));

// Matriz down (1-4) × cubo de distancia. Cada celda trae su tasa de éxito Y su fracción
// cruda: sin el denominador, un 100% de 1/1 miente igual que en cualquier otra pantalla.
export function downDistanceGrid(plays, side) {
  const sp = plays.filter(p =>
    (side === "us" ? p.has_offense : p.has_defense)
    && (isRunCall(p) || isPassCall(p))
    && p.yards_to_go != null
    && ["1", "2", "3", "4"].includes(String(p.down)));

  const cell = list => ({
    plays: list.length,
    succ: list.filter(isSuccess).length,
    succRate: list.length ? list.filter(isSuccess).length / list.length : 0,
    yds: list.reduce((s, p) => s + num(p.yards_gained), 0),
    ypp: list.length ? list.reduce((s, p) => s + num(p.yards_gained), 0) / list.length : 0,
    // Reparto de llamada: en 3º y largo, "¿corremos o pasamos?" es media lectura del rival.
    runPct: list.length ? list.filter(isRunCall).length / list.length : 0,
  });

  const grid = {};
  for (const d of ["1", "2", "3", "4"]) {
    grid[d] = {};
    const ofDown = sp.filter(p => String(p.down) === d);
    for (const b of DIST_BUCKETS) grid[d][b.id] = cell(ofDown.filter(p => bucketOf(p.yards_to_go) === b.id));
    grid[d].all = cell(ofDown);
  }
  return grid;
}

// El resultado de un drive lo cierra su última jugada (drives.result no se persiste).
export function buildDriveResults(plays) {
  const ordered = [...plays].sort((a, b) => a.sequence - b.sequence);
  const map = {};
  for (const p of ordered) if (p.drive_id != null) map[p.drive_id] = p.outcome ?? null;
  return map;
}

// Stats por lado (single-sided: defensa = ataque rival).
export function sideStats(plays, drives, side, driveResults) {
  const isUs = side === "us";
  // Solo snaps reales: una penalización suelta (sin label ni outcome) no es una jugada, no cuenta
  // para conteos/medias (sí afecta a la posición de campo, que se camina aparte con netYards).
  const ps = plays.filter(p => (isUs ? p.has_offense : p.has_defense) && (p.label || p.outcome));
  // ⚠️ SOLO drives de verdad. Los kickoffs viven en la MISMA tabla con segment_type='kickoff' y
  // también tienen `possession_team_side`, así que sin este filtro un kickoff se colaría como
  // drive y se le caminaría la posición de campo → viajes a zona roja inflados. GameDetail ya
  // filtraba antes de llamar, pero eso dejaba la trampa armada para el siguiente que llamase.
  const dr = drives.filter(d => d.possession_team_side === side && d.segment_type !== "kickoff");
  const made = p => p.yards_to_go != null && p.yards_gained != null && num(p.yards_gained) >= num(p.yards_to_go);

  const yards = ps.reduce((s, p) => s + num(p.yards_gained), 0);
  const third = ps.filter(p => String(p.down) === "3");

  // Zona roja: se camina el balón desde la yarda de inicio del drive.
  let redTrips = 0, redTD = 0;
  for (const d of dr) {
    const start = parseSpot(d.start_field_position);
    let spot = start, reached = inRedZone(start, side);
    const dplays = plays.filter(p => p.drive_id === d.id).sort((a, b) => a.sequence - b.sequence);
    for (const p of dplays) {
      spot = advance(spot, netYards(p), side);
      if (inRedZone(spot, side)) reached = true;
    }
    // Un TD pasa por la zona roja sí o sí: backstop para drives infra-registrados (típico en defensa).
    const scored = driveResults[d.id] === "TD";
    if (reached || scored) { redTrips++; if (scored) redTD++; }
  }

  return {
    plays: ps.length,
    yards,
    ypp: ps.length ? yards / ps.length : 0,
    explosive: ps.filter(p => num(p.yards_gained) >= 10).length,
    firstDowns: ps.filter(made).length,
    thirdAtt: third.length,
    thirdConv: third.filter(made).length,
    turnovers: dr.filter(d => ["INT", "FUMBLE"].includes(driveResults[d.id])).length,
    passYds: ps.filter(p => (p.label || "").includes(LABEL.PASS)).reduce((s, p) => s + num(p.yards_gained), 0),
    runYds:  ps.filter(p => (p.label || "").includes(LABEL.RUSH)).reduce((s, p) => s + num(p.yards_gained), 0),
    passComp: ps.filter(p => p.label === LABEL.PASS).length,
    passAtt:  ps.filter(p => p.label === LABEL.PASS || p.label === LABEL.PASS_INCOMPLETE).length,
    redTrips, redTD,
  };
}

// Stats por jugador. Agrupa por roster_id estable (fallback al snapshot congelado
// nombre/dorsal para referencias sueltas). Un jugador two-way (p.ej. WR/CB) acumula
// ataque Y defensa bajo la MISMA entrada (misma clave de roster_id).
// TD atribuido al ejecutor/receptor de la jugada de anotación (scorer_snapshot aún no se captura).
export function playerStats(plays) {
  const map = new Map();
  const get = (snap, rid) => {
    if (!snap) return null;
    const key = rid != null ? `r${rid}` : `s${snap.name}#${snap.jersey}`;
    if (!map.has(key)) map.set(key, {
      key, name: snap.name, jersey: snap.jersey,
      rush: { att: 0, yds: 0, td: 0, long: 0 },
      pass: { att: 0, cmp: 0, yds: 0, td: 0 },
      rec:  { tgt: 0, rec: 0, yds: 0, td: 0, long: 0 },
      def:  { plays: 0, tackles: 0, sacks: 0, ints: 0, fumRec: 0 },
      kick: { fga: 0, fgm: 0, fgLong: 0, punts: 0, puntYds: 0, puntLong: 0,
              pat: 0, patM: 0, ko: 0, koYds: 0, blocked: 0, puntRetYds: 0,
              ret: 0, retYds: 0, retLong: 0, covTackles: 0 },
    });
    return map.get(key);
  };

  // Ataque: corredor / pasador + receptor.
  for (const p of plays.filter(p => p.has_offense && p.offense)) {
    const o = p.offense, y = num(p.yards_gained), td = p.outcome === "TD";
    if (p.label === LABEL.RUSH) {
      const e = get(o.executor_snapshot, o.executor_roster_id);
      if (!e) continue;
      e.rush.att++; e.rush.yds += y; if (td) e.rush.td++; if (y > e.rush.long) e.rush.long = y;
    } else if (p.label === LABEL.PASS || p.label === LABEL.PASS_INCOMPLETE) {
      const comp = p.label === LABEL.PASS;
      const passer = get(o.executor_snapshot, o.executor_roster_id);
      if (passer) { passer.pass.att++; if (comp) { passer.pass.cmp++; passer.pass.yds += y; if (td) passer.pass.td++; } }
      const r = get(o.receiver_snapshot, o.receiver_roster_id);
      if (r) { r.rec.tgt++; if (comp) { r.rec.rec++; r.rec.yds += y; if (td) r.rec.td++; if (y > r.rec.long) r.rec.long = y; } }
    }
  }

  // Defensa: un defensor principal por jugada (tackler_roster_id). Los flags los produjo la
  // factoría derivándolos del tipo/resultado. Un sack cuenta también como placaje (es un
  // placaje tras la línea); una INT o una recuperación NO son placajes.
  for (const p of plays.filter(p => p.has_defense && p.defense)) {
    const d = p.defense;
    const e = get(d.tackler_snapshot, d.tackler_roster_id);
    if (!e) continue;
    e.def.plays++;
    if (d.def_sack) e.def.sacks++;
    if (d.def_interception) e.def.ints++;
    if (d.recovered_fumble) e.def.fumRec++;
    if (!d.def_interception && !d.recovered_fumble) e.def.tackles++;
  }

  // Equipos especiales — de momento SOLO el pie: quién patea un field goal y quién despeja.
  // Es lo que un entrenador mira primero de la unidad de kicking, y va sobre jugadas que ya
  // existían (outcome FG / FG FALLADO / PUNT), sin superficie nueva de captura.
  // Incluye kickoffs: cuelgan una jugada `has_special` de su segmento, así que un kickoff es
  // un snap con nombres (pateador/retornador/placador) como en cualquier play-by-play oficial.
  for (const p of plays.filter(p => p.has_special && p.special)) {
    const s = p.special;
    // Pateador: field goal, punt o kickoff. Cada tipo cuenta en su columna.
    const k = get(s.kicker_snapshot, s.kicker_roster_id);
    if (k) {
      const dist = num(s.kick_yards);
      if (s.special_type === "PUNT") {
        k.kick.punts++;
        k.kick.puntYds += dist;
        // Retorno concedido: se resta al bruto para el neto. En un punt, `return_yards` es
        // del RIVAL (no hay retornador nuestro que atribuir), por eso se acumula aquí y no
        // en las estadísticas de retorno del jugador.
        k.kick.puntRetYds += num(s.return_yards);
        if (dist > k.kick.puntLong) k.kick.puntLong = dist;
      } else if (s.special_type === "FG") {
        k.kick.fga++;
        if (s.fg_good) {
          k.kick.fgm++;
          // "Más largo" solo cuenta los METIDOS: un fallo de 55 no es un récord de alcance.
          const fd = num(s.fg_distance);
          if (fd > k.kick.fgLong) k.kick.fgLong = fd;
        }
      } else if (s.special_type === "PAT") {
        k.kick.pat++;
        if (s.fg_good) k.kick.patM++;
      } else if (s.special_type === "KICKOFF") {
        k.kick.ko++;
        k.kick.koYds += dist;
      }
      if (s.is_blocked) k.kick.blocked++;
    }
    // Retornador. Un touchback NO es un retorno: nadie lo devolvió.
    const r = get(s.returner_snapshot, s.returner_roster_id);
    if (r && !s.is_touchback && s.special_type !== "PUNT") {
      const y = num(s.return_yards);
      r.kick.ret++;
      r.kick.retYds += y;
      if (y > r.kick.retLong) r.kick.retLong = y;
    }
    // Placaje en cobertura: quién frena el retorno del rival. Se cuenta aparte de los placajes
    // defensivos porque es otra unidad — mezclarlos inflaría el total de un linebacker que
    // además juega en equipos especiales.
    const t = get(s.tackler_snapshot, s.tackler_roster_id);
    if (t) t.kick.covTackles++;
  }

  return [...map.values()];
}
