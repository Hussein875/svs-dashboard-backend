import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { analysiere, naechsterEingabeAuftrag } from "../src/pipeline.js";
import { closeState, getVorgang, openState } from "../src/state.js";

function neueDb() {
  const dir = mkdtempSync(path.join(tmpdir(), "gutachten-pipeline-"));
  return openState(path.join(dir, "state.sqlite"));
}

function quellen(daten, fotos) {
  return {
    dokumente: async () => daten,
    fotos: async () => fotos,
  };
}

const dokumente = {
  fahrzeugschein: { vorhanden: true, lesbar: true },
  kennzeichen: { wert: "DH-ED 1701", lesbar: true },
  vorschaeden: { angegeben: true, lesbar: true },
  auftraggeber: {
    anrede: "Herr",
    name: "Eri Danaj",
    strasse: "Lübecker Str. 7",
    plz: "28844",
    ort: "Weyhe",
    lesbar: true,
  },
};

const fotos = {
  kilometerstand: { wert: "154862", lesbar: true },
  schadenfotos: {
    vorneLinks: true,
    vorneRechts: true,
    hintenRechts: true,
    hintenLinks: true,
  },
};

test("unvollständige Akte kommt nicht in die Eingabe-Warteschlange", async () => {
  const db = neueDb();
  try {
    const ergebnis = await analysiere(db, {
      nummer: "2100/26",
      ...quellen(dokumente, {
        kilometerstand: { wert: "", lesbar: false },
        schadenfotos: { vorneLinks: true, vorneRechts: false, hintenRechts: true, hintenLinks: true },
      }),
    });

    assert.equal(ergebnis.angenommen, false);
    assert.equal(ergebnis.stand, "wartet_auf_eingabe");
    assert.equal(ergebnis.bericht.includes("DH-ED 1701"), false);
    assert.equal(naechsterEingabeAuftrag(db), null);
    assert.equal(getVorgang(db, "2100/26").schritte["pflichtfelder-pruefen"], "offen");
  } finally {
    closeState(db);
  }
});

test("vollständige Akte wird genau einmal eingereiht und Phase 2 nimmt nur eine", async () => {
  const db = neueDb();
  try {
    const erste = await analysiere(db, { nummer: "2101/26", ...quellen(dokumente, fotos) });
    const zweite = await analysiere(db, { nummer: "2102/26", ...quellen(dokumente, fotos) });
    await analysiere(db, { nummer: "2101/26", ...quellen(dokumente, fotos) });

    assert.equal(erste.angenommen, true);
    assert.equal(erste.stand, "geprueft");
    assert.equal(zweite.angenommen, true);

    const auftrag = naechsterEingabeAuftrag(db);
    assert.equal(auftrag.nummer, "2101/26");
    assert.equal(naechsterEingabeAuftrag(db), null);
    assert.equal(auftrag.datensatz.kennzeichen.wert, "DH-ED 1701");
  } finally {
    closeState(db);
  }
});

test("zwei verschiedene Akten können parallel gelesen werden", async () => {
  const db = neueDb();
  try {
    const [eine, andere] = await Promise.all([
      analysiere(db, { nummer: "2103/26", owner: "leser-a", ...quellen(dokumente, fotos) }),
      analysiere(db, { nummer: "2104/26", owner: "leser-b", ...quellen(dokumente, fotos) }),
    ]);
    assert.equal(eine.angenommen, true);
    assert.equal(andere.angenommen, true);
  } finally {
    closeState(db);
  }
});
