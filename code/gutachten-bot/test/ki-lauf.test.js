import assert from "node:assert/strict";
import test from "node:test";
import { fuehreDatensatzZusammen, lesungOffen } from "../src/ki-lauf.js";

test("eine spätere Lesung füllt nur die Lücken", () => {
  const erste = {
    fin: { wert: "", lesbar: false },
    kennzeichen: { wert: "HB-AX 700", lesbar: true },
    schadenfotos: { vorneLinks: false, vorneRechts: true, hintenRechts: false, hintenLinks: false },
    auftraggeber: { lesbar: false },
  };
  const zweite = {
    fin: { wert: "WBAFG01080L333983", lesbar: true },
    kennzeichen: { wert: "HB-AX 999", lesbar: true },
    schadenfotos: { vorneLinks: true, vorneRechts: false, hintenRechts: true, hintenLinks: true },
    auftraggeber: {
      anrede: "Herr",
      name: "Adham Khalid Khider",
      strasse: "Goldener Reif 120",
      plz: "28259",
      ort: "Bremen",
      lesbar: true,
    },
  };
  const zusammen = fuehreDatensatzZusammen(erste, zweite);
  assert.equal(zusammen.fin.wert, "WBAFG01080L333983");
  assert.equal(zusammen.kennzeichen.wert, "HB-AX 700");
  assert.equal(zusammen.schadenfotos.vorneLinks, true);
  assert.equal(zusammen.schadenfotos.vorneRechts, true);
  assert.equal(zusammen.auftraggeber.name, "Adham Khalid Khider");
  assert.equal(lesungOffen(zusammen).some((zeile) => zeile.startsWith("FIN")), false);
});
