import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { berichtText, pruefePflichtfelder } from "../src/pflichtfelder.js";
import {
  closeState,
  getVorgang,
  openState,
  setWartetAufEingabe,
  VorgangGesperrtError,
  withVorgang,
} from "../src/state.js";

function vollstaendig() {
  return {
    fahrzeugschein: { vorhanden: true, lesbar: true },
    kennzeichen: { wert: "DH-ED 1701", lesbar: true },
    kilometerstand: { wert: "154862", lesbar: true },
    schadenfotos: {
      vorneLinks: true,
      vorneRechts: true,
      hintenRechts: true,
      hintenLinks: true,
    },
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
}

function neueDb() {
  const dir = mkdtempSync(path.join(tmpdir(), "gutachten-bot-"));
  return openState(path.join(dir, "state.sqlite"));
}

test("vollständige Akte hat keine offenen Pflichtfelder", () => {
  const ergebnis = pruefePflichtfelder(vollstaendig());
  assert.equal(ergebnis.vollstaendig, true);
  assert.deepEqual(ergebnis.fehlend, []);
  assert.match(berichtText("2083/26", ergebnis), /Pflichtfelder vollständig/);
});

test("unleserliche Felder bleiben leer und stehen ohne Wert im Report", () => {
  const daten = vollstaendig();
  daten.kennzeichen = { wert: "DH-ED 1701", lesbar: false };
  daten.kilometerstand = { wert: "999999", lesbar: false };
  daten.fahrzeugschein = { vorhanden: true, lesbar: false };

  const ergebnis = pruefePflichtfelder(daten);
  const text = berichtText("2083/26", ergebnis);

  assert.equal(ergebnis.vollstaendig, false);
  assert.equal(ergebnis.fehlend.find((feld) => feld.id === "kennzeichen").grund, "unleserlich");
  assert.equal(text.includes("DH-ED 1701"), false);
  assert.equal(text.includes("999999"), false);
  assert.match(text, /Kennzeichen: unleserlich, Feld bleibt leer/);
  assert.match(text, /Kilometerstand: unleserlich, Feld bleibt leer/);
  assert.match(text, /Fahrzeugschein: unleserlich, Feld bleibt leer/);
});

test("fehlende Perspektiven und fehlende Vorschäden-Angabe werden gemeldet", () => {
  const daten = vollstaendig();
  daten.schadenfotos.hintenLinks = false;
  daten.vorschaeden = { angegeben: false, lesbar: true };

  const ergebnis = pruefePflichtfelder(daten);
  const ids = ergebnis.fehlend.map((feld) => feld.id);

  assert.ok(ids.includes("schadenfoto-hinten-links"));
  assert.ok(ids.includes("vorschaeden"));
});

test("Angabe Keine zählt als Vorschäden-Angabe", () => {
  const daten = vollstaendig();
  daten.vorschaeden = { angegeben: true, lesbar: true, wert: "Keine" };
  assert.equal(pruefePflichtfelder(daten).vollstaendig, true);
});

test("erledigter Schritt wird übersprungen und ein Abbruch setzt ihn nicht", async () => {
  const db = neueDb();
  try {
    await withVorgang(db, "2083/26", "lauf-a", async (akte) => {
      await assert.rejects(() => akte.runSchritt("dokumente-lesen", async () => {
        throw new Error("Abbruch");
      }));
    });
    assert.equal(getVorgang(db, "2083/26").schritte["dokumente-lesen"], "offen");

    await withVorgang(db, "2083/26", "lauf-a", async (akte) => {
      const erster = await akte.runSchritt("dokumente-lesen", async () => {});
      const zweiter = await akte.runSchritt("dokumente-lesen", async () => {
        throw new Error("darf nicht noch einmal laufen");
      });
      assert.equal(erster.skipped, false);
      assert.equal(zweiter.skipped, true);
    });
    assert.equal(getVorgang(db, "2083/26").schritte["dokumente-lesen"], "erledigt");
  } finally {
    closeState(db);
  }
});

test("dieselbe Akte kann nicht von zwei Läufen gleichzeitig gesperrt werden", async () => {
  const db = neueDb();
  try {
    await withVorgang(db, "2090/26", "lauf-a", async () => {
      await assert.rejects(
        () => withVorgang(db, "2090/26", "lauf-b", async () => {}),
        VorgangGesperrtError,
      );
    });
    await withVorgang(db, "2090/26", "lauf-b", async (akte) => {
      assert.equal(akte.stand().nummer, "2090/26");
    });
  } finally {
    closeState(db);
  }
});

test("Stand steigt mit den erledigten Schritten und wartet bei Lücken", async () => {
  const db = neueDb();
  try {
    await withVorgang(db, "2091/26", "lauf-a", async (akte) => {
      await akte.runSchritt("dokumente-lesen", async () => {});
      await akte.runSchritt("fotos-auswerten", async () => {});
    });
    assert.equal(getVorgang(db, "2091/26").stand, "eingelesen");

    setWartetAufEingabe(db, "2091/26");
    assert.equal(getVorgang(db, "2091/26").stand, "wartet_auf_eingabe");

    await withVorgang(db, "2091/26", "lauf-a", async (akte) => {
      await akte.runSchritt("pflichtfelder-pruefen", async () => {});
    });
    assert.equal(getVorgang(db, "2091/26").stand, "geprueft");
  } finally {
    closeState(db);
  }
});
