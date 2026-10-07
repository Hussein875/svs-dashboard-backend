import assert from "node:assert/strict";
import test from "node:test";
import { abschlussMeldung } from "../src/abschluss-meldung.js";

test("Abschluss nennt das Gespeicherte und einmal, was fehlt", () => {
  const text = abschlussMeldung("2138/26", {
    gespeichert: ["auftrag"],
    manuell: ["Bereifung (fehlt)", "Auftraggeber (unleserlich)"],
    uebersprungen: [
      "bereifung (Bereifung; Hersteller; Klick nicht möglich; Rücklesen)",
      "dokumente-import",
      "vor-ort (Feld nicht klickbar: Besichtigungsbedingungen; Feld nicht klickbar: Besichtigungszustand)",
      "fahrzeug (locator.click: Timeout 45000ms exceeded Call log: waiting for button)",
    ],
  });
  assert.match(text, /Gespeichert: Auftrag/);
  assert.match(text, /^Offen:/m);
  assert.ok(text.includes("\n"));
  assert.equal(text.includes("Call log"), false);
  assert.equal(text.includes("Timeout"), false);
  assert.equal((text.match(/Bereifung/g) || []).length, 1);
  assert.match(text, /• Dokumente/);
  assert.match(text, /Fahrzeug: Klick nicht möglich/);
  assert.match(text, /Vor Ort: Besichtigungsbedingungen/);
});
