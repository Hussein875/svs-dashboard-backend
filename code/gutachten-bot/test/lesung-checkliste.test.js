import assert from "node:assert/strict";
import test from "node:test";
import {
  applyLesungOverrides,
  lesungCheckliste,
  mergeChecklistOverrides,
  parseBereifungOverrideText,
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

test("Schilderung als { wert } wird als Text angezeigt", () => {
  const rows = lesungCheckliste({
    schilderung: { wert: "Auffahrunfall an der Kreuzung", lesbar: true },
  });
  const s = rows.find((r) => r.id === "schilderung");
  assert.equal(s.wert, "Auffahrunfall an der Kreuzung");
  assert.equal(s.status, "ok");
});

test("Overrides überschreiben Anzeige und Datensatz", () => {
  const basis = { kennzeichen: { wert: "X", lesbar: true } };
  const neu = applyLesungOverrides(basis, { kennzeichen: "ME-HS 1718" });
  assert.equal(neu.kennzeichen.wert, "ME-HS 1718");
  const liste = mergeChecklistOverrides(lesungCheckliste(basis), { kennzeichen: "ME-HS 1718" });
  assert.equal(liste.find((r) => r.id === "kennzeichen").wert, "ME-HS 1718");
});

test("Bereifung-Override aus Checkliste-Text (Punkte)", () => {
  const parsed = parseBereifungOverrideText("8 mm · FALKEN · 215/60 R17");
  assert.equal(parsed.profiltiefe, "8");
  assert.equal(parsed.hersteller, "FALKEN");
  assert.equal(parsed.dimension, "215/60 R17");
  const neu = applyLesungOverrides({}, { bereifung: "8 mm · FALKEN · 215/60 R17" });
  assert.equal(neu.bereifung.hersteller, "FALKEN");
  assert.equal(neu.bereifung.lesbar, true);
});

test("Schadentag manuell setzen", () => {
  const neu = applyLesungOverrides({}, { schadentag: "27.12.2024" });
  assert.equal(neu.schadentag.wert, "27.12.2024");
  assert.equal(neu.schadentag.lesbar, true);
});
