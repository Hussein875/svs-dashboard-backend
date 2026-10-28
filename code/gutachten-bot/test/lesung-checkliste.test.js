import assert from "node:assert/strict";
import test from "node:test";
import {
  applyLesungOverrides,
  lesungCheckliste,
  mergeChecklistOverrides,
} from "../src/lesung-checkliste.js";

test("Checkliste zeigt gelesenes Kennzeichen und fehlende Felder", () => {
  const rows = lesungCheckliste({
    kennzeichen: { wert: "ME-HS 1718", lesbar: true },
    auftraggeber: {
      name: "Faro Houzan",
      strasse: "Weg 1",
      plz: "40789",
      ort: "Monheim",
      lesbar: true,
    },
  });
  const knz = rows.find((r) => r.id === "kennzeichen");
  assert.equal(knz.wert, "ME-HS 1718");
  assert.equal(knz.status, "ok");
  const fin = rows.find((r) => r.id === "fin");
  assert.equal(fin.status, "fehlt");
});

test("Overrides überschreiben Anzeige und Datensatz", () => {
  const basis = { kennzeichen: { wert: "X", lesbar: true } };
  const neu = applyLesungOverrides(basis, { kennzeichen: "ME-HS 1718" });
  assert.equal(neu.kennzeichen.wert, "ME-HS 1718");
  const liste = mergeChecklistOverrides(lesungCheckliste(basis), { kennzeichen: "ME-HS 1718" });
  assert.equal(liste.find((r) => r.id === "kennzeichen").wert, "ME-HS 1718");
});
