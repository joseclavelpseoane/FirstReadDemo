import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSpot, formatSpot, advance, inRedZone, labelSpot } from "../src/fieldPosition.js";

test("parseSpot lee las dos mitades del campo en yarda absoluta", () => {
  assert.equal(parseSpot("OWN 25"), 25);
  assert.equal(parseSpot("OPP 25"), 75);
  assert.equal(parseSpot("50"), 50);
  assert.equal(parseSpot("MID"), 50);
  assert.equal(parseSpot("own 8"), 8, "no distingue mayúsculas");
  assert.equal(parseSpot("30"), 30, "un número suelto se asume OWN");
});

test("parseSpot devuelve null en vez de NaN cuando no hay dato", () => {
  // Importa: `start_field_position` es nullable y sideStats camina el balón desde aquí.
  // Un NaN se propagaría en silencio a los viajes a zona roja.
  assert.equal(parseSpot(null), null);
  assert.equal(parseSpot(""), null);
  assert.equal(parseSpot("a media cancha"), null);
});

test("formatSpot es el inverso de parseSpot dentro del campo", () => {
  for (const text of ["OWN 1", "OWN 25", "OPP 40", "OPP 3"]) {
    assert.equal(formatSpot(parseSpot(text)), text);
  }
  assert.equal(formatSpot(50), "50");
  assert.equal(formatSpot(null), "—");
});

test("advance mueve cada lado hacia su propia end zone", () => {
  assert.equal(advance(25, 10, "us"), 35, "nuestro ataque sube hacia 100");
  assert.equal(advance(25, 10, "rival"), 15, "el ataque rival baja hacia 0");
  assert.equal(advance(25, -7, "us"), 18, "un sack retrocede");
});

test("advance hace clamp en las dos end zones", () => {
  // Sin clamp, un drive infra-registrado empujaría la posición fuera del campo y
  // envenenaría todo lo que se derive después de esa jugada.
  assert.equal(advance(95, 30, "us"), 100);
  assert.equal(advance(5, 30, "rival"), 0);
  assert.equal(advance(null, 10, "us"), null);
});

test("inRedZone es relativa a quién ataca", () => {
  assert.equal(inRedZone(85, "us"), true, "us: a 15 de la end zone rival");
  assert.equal(inRedZone(85, "rival"), false, "para el rival esa yarda es campo propio");
  assert.equal(inRedZone(15, "rival"), true);
  assert.equal(inRedZone(80, "us"), true, "el límite (la 20) entra");
  assert.equal(inRedZone(null, "us"), false);
});

test("labelSpot sustituye OWN/OPP por abreviaturas sin ambigüedad de dueño", () => {
  assert.equal(labelSpot("OWN 48", "KRK", "COB"), "KRK 48");
  assert.equal(labelSpot("OPP 12", "KRK", "COB"), "COB 12");
  assert.equal(labelSpot("50", "KRK", "COB"), "50");
});
