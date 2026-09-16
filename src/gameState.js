// En qué estado está un partido. FUENTE ÚNICA: la portada y la lista de partidos tienen que
// decir lo MISMO del mismo partido.
//
// `games.status` NO se mantiene a mano: el partido real vs Ricers sigue en 'scheduled' con 70
// jugadas dentro, y arrastra un `final_score_us` rancio. Así que solo 'final' es fiable; el
// resto se deriva de si hay jugadas registradas.
//
// (Nada de leer `final_score_*`: el marcador se deriva del pbp, como todo lo demás.)
export function gameState(game, playCount = 0) {
  if (game.status === "final") return "final";
  return playCount > 0 ? "live" : "scheduled";
}
