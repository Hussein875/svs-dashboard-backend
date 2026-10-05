import assert from "node:assert/strict";
import test from "node:test";
import { beteiligungText } from "../src/ultraexpert-seite.js";

test("Beteiligung trifft die Bezeichnung in UltraExpert", () => {
  assert.equal(beteiligungText("Auftraggeber"), "AG Auftraggeber");
  assert.equal(beteiligungText("Fahrzeughalter"), "FH Fahrzeughalter");
  assert.equal(beteiligungText("Versicherung"), "VS Versicherung");
  assert.equal(beteiligungText("Anwalt"), "RA Rechtsanwalt");
  assert.equal(beteiligungText("Gegner"), "");
});
