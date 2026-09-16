// Posición de campo en yarda ABSOLUTA 0–100, frame siempre nuestro:
//   0   = nuestra línea de gol (nuestra end zone)
//   100 = línea de gol rival (su end zone)
// Texto: "OWN N" = yarda N (0–50) · "OPP N" = 100−N · "50"/"MID" = 50.
// Avance: nuestro ataque ('us') va hacia 100; el rival ('rival') va hacia 0.

export function parseSpot(text) {
  if (text == null) return null;
  const t = String(text).trim().toUpperCase();
  const m = t.match(/(OWN|OPP)\s*(\d{1,2})/);
  if (m) {
    const n = Number(m[2]);
    return m[1] === "OWN" ? n : 100 - n;
  }
  if (/\b(50|MID)\b/.test(t)) return 50;
  if (/^\d{1,2}$/.test(t)) return Number(t); // suelto → se asume OWN
  return null;
}

// Sustituye OWN/OPP por la abreviatura del equipo para mostrar (nunca para guardar):
// OWN/OPP confunde en defensa ("su OWN 48" ¿es nuestro OWN o el suyo?). Con abreviaturas
// ("COB 48") no hay ambigüedad de a quién pertenece la yarda, sea cual sea el frame.
export function labelSpot(text, usAbbr, rivalAbbr) {
  if (!text) return text;
  return text.replace(/^OWN\b/i, usAbbr || "OWN").replace(/^OPP\b/i, rivalAbbr || "OPP");
}

export function formatSpot(abs) {
  if (abs == null) return "—";
  if (abs <= 0) return "OWN 0";
  if (abs >= 100) return "OPP 0";
  if (abs === 50) return "50";
  return abs < 50 ? `OWN ${abs}` : `OPP ${100 - abs}`;
}

// Yarda tras avanzar `yards` desde `abs` para un lado (clamp 0–100).
export function advance(abs, yards, side) {
  if (abs == null) return null;
  const dir = side === "us" ? 1 : -1;
  return Math.max(0, Math.min(100, abs + dir * (yards || 0)));
}

// ¿La yarda está en zona roja para el atacante? us: OPP 20 o menos (abs≥80) · rival: nuestra 20 (abs≤20).
export function inRedZone(abs, side) {
  if (abs == null) return false;
  return side === "us" ? abs >= 80 : abs <= 20;
}
