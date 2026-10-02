import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { sachverstaendigerName } from "../src/eingabe-plan.js";
import { leseOrdnerNamen } from "../src/ordner.js";
import { analysiere } from "../src/pipeline.js";
import { eingeben } from "../src/phase2.js";
import { starteAkte } from "../src/start-akte.js";
import { closeState, openState } from "../src/state.js";

function neueDb() {
  const dir = mkdtempSync(path.join(tmpdir(), "gutachten-start-"));
  return openState(path.join(dir, "state.sqlite"));
}

const basis = {
  fahrzeugschein: { vorhanden: true, lesbar: true },
  kennzeichen: { wert: "HH-AB 100", lesbar: true },
  kilometerstand: { wert: "1000", lesbar: true },
  schadenfotos: {
    vorneLinks: true,
    vorneRechts: true,
    hintenRechts: true,
    hintenLinks: true,
  },
  vorschaeden: { angegeben: true, lesbar: true },
  auftraggeber: {
    anrede: "Frau",
    name: "Anna Beispiel",
    strasse: "Weg 1",
    plz: "20095",
    ort: "Hamburg",
    lesbar: true,
  },
};

test("Ordnername liefert Nummer und Kürzel", () => {
  assert.deepEqual(leseOrdnerNamen("2102/26 Unfallgutachten Beispiel (OS)"), {
    nummer: "2102/26",
    kuerzel: "OS",
  });
  assert.deepEqual(leseOrdnerNamen("2037/26 Unfallgutachten Beispiel (HU)"), {
    nummer: "2037/26",
    kuerzel: "HU",
  });
  assert.equal(sachverstaendigerName("OS"), "Osama Sleiman");
});

test("ein unbekannter Sachverständiger startet keine Eingabe", async () => {
  const db = neueDb();
  const geoeffnet = [];
  try {
    const ergebnis = await starteAkte(db, {
      nummer: "2102/26",
      ordnerName: "2102/26 Unfallgutachten Beispiel (ZZ)",
      dokumente: async () => basis,
      fotos: async () => basis,
    }, {
      async vorbereiten(nummer) {
        geoeffnet.push(nummer);
      },
    }, { owner: "start" });
    assert.equal(ergebnis.gestartet, false);
    assert.equal(ergebnis.grund, "sachverstaendiger");
    assert.equal(ergebnis.kuerzel, "ZZ");
    assert.equal(geoeffnet.length, 0);
  } finally {
    closeState(db);
  }
});

test("die angeklickte Akte wird bearbeitet, nicht die ältere", async () => {
  const db = neueDb();
  const geoeffnet = [];
  try {
    await analysiere(db, {
      nummer: "2100/26",
      dokumente: async () => basis,
      fotos: async () => basis,
    });
    await analysiere(db, {
      nummer: "2102/26",
      dokumente: async () => ({ ...basis, kuerzel: "HU" }),
      fotos: async () => basis,
    });
    const ergebnis = await eingeben(db, {
      async vorbereiten(nummer) {
        geoeffnet.push(nummer);
        throw new Error("stopp");
      },
    }, { nummer: "2102/26", fortsetzen: true, sleep: async () => {}, owner: "ziel" });
    assert.equal(ergebnis.nummer, "2102/26");
    assert.deepEqual(geoeffnet, ["2102/26"]);
    const aeltere = db.prepare("SELECT status FROM eingabe_queue WHERE nummer = ?").get("2100/26");
    assert.equal(aeltere.status, "wartend");
  } finally {
    closeState(db);
  }
});
