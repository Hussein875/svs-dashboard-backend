import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { FachlichError, TechnischError } from "../src/fehler.js";
import { analysiere } from "../src/pipeline.js";
import { eingeben } from "../src/phase2.js";
import { closeState, getVorgang, openState } from "../src/state.js";

function neueDb() {
  const dir = mkdtempSync(path.join(tmpdir(), "gutachten-phase2-"));
  return openState(path.join(dir, "state.sqlite"));
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

function adapter(overrides = {}) {
  const basis = {
    besichtigung: async () => {},
    beteiligte: async () => {},
    fahrzeug: async () => {},
    bereifung: async () => {},
    "vor-ort": async () => {},
    vorschaeden: async () => {},
    schadenfeststellung: async () => {},
    "dokumente-import": async () => {},
    lichtbilder: async () => {},
  };
  return { ...basis, ...overrides };
}

async function vorbereiten(db, nummer = "2200/26") {
  await analysiere(db, {
    nummer,
    dokumente: async () => dokumente,
    fotos: async () => fotos,
  });
}

test("Eingabe tippt eine Akte und lässt die zweite warten", async () => {
  const db = neueDb();
  const zeilen = [];
  try {
    await vorbereiten(db, "2200/26");
    await vorbereiten(db, "2201/26");
    let offen = true;
    const erste = eingeben(db, adapter({
      besichtigung: () => new Promise((resolve) => {
        const timer = setInterval(() => {
          if (!offen) {
            clearInterval(timer);
            resolve();
          }
        }, 5);
      }),
    }), {
      owner: "tipp-a",
      sleep: async () => {},
      log: (zeile) => zeilen.push(zeile),
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const zweite = await eingeben(db, adapter(), { owner: "tipp-b", sleep: async () => {} });
    assert.equal(zweite.gestartet, false);
    offen = false;
    const ergebnis = await erste;
    assert.equal(ergebnis.stand, "eingetippt");
    assert.equal(zeilen.some((zeile) => zeile.includes("DH-ED 1701") || zeile.includes("Danaj")), false);
    assert.equal(getVorgang(db, "2200/26").stand, "eingetippt");
  } finally {
    closeState(db);
  }
});

test("technischer Fehler wird wiederholt, fachlicher Fehler stoppt ohne Schätzen", async () => {
  const db = neueDb();
  try {
    await vorbereiten(db, "2202/26");
    let versuche = 0;
    const technisch = await eingeben(db, adapter({
      fahrzeug: async () => {
        versuche += 1;
        if (versuche < 3) throw new TechnischError("timeout");
      },
    }), { maxVersuche: 3, sleep: async () => {}, owner: "tipp-t" });
    assert.equal(technisch.stand, "eingetippt");
    assert.equal(versuche, 3);

    await vorbereiten(db, "2203/26");
    const fachlich = await eingeben(db, adapter({
      bereifung: async () => {
        throw new FachlichError("Felgenkreuz unleserlich");
      },
    }), { sleep: async () => {}, owner: "tipp-f" });
    assert.equal(fachlich.stand, "wartet_auf_eingabe");
    assert.equal(getVorgang(db, "2203/26").schritte.bereifung, "offen");
    assert.equal(getVorgang(db, "2203/26").schritte.besichtigung, "erledigt");
  } finally {
    closeState(db);
  }
});

test("Abbruch mitten in der Eingabe wird beim nächsten Lauf fortgesetzt", async () => {
  const db = neueDb();
  try {
    await vorbereiten(db, "2204/26");
    await eingeben(db, adapter({
      fahrzeug: async () => {
        throw new Error("Prozess weg");
      },
    }), { sleep: async () => {}, owner: "tipp-1" });
    assert.equal(getVorgang(db, "2204/26").schritte.besichtigung, "erledigt");
    assert.equal(getVorgang(db, "2204/26").schritte.fahrzeug, "offen");

    const weiter = await eingeben(db, adapter(), {
      fortsetzen: true,
      sleep: async () => {},
      owner: "tipp-2",
    });
    assert.equal(weiter.stand, "eingetippt");
    assert.equal(getVorgang(db, "2204/26").schritte.fahrzeug, "erledigt");
  } finally {
    closeState(db);
  }
});

test("nacheinander überspringt einen fehlenden Schritt und macht weiter", async () => {
  const db = neueDb();
  try {
    await vorbereiten(db, "2205/26");
    let vorOrt = false;
    const ergebnis = await eingeben(db, adapter({
      bereifung: async () => {
        throw new FachlichError("Bereifung fehlt");
      },
      "vor-ort": async () => {
        vorOrt = true;
      },
    }), { nacheinander: true, sleep: async () => {}, owner: "tipp-n" });
    assert.equal(vorOrt, true);
    assert.equal(ergebnis.stand, "teilweise");
    assert.match(ergebnis.offen.join(" "), /bereifung/);
    assert.equal(getVorgang(db, "2205/26").schritte.bereifung, "offen");
    assert.equal(getVorgang(db, "2205/26").schritte["vor-ort"], "erledigt");
  } finally {
    closeState(db);
  }
});
