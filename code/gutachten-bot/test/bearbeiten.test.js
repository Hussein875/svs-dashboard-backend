import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { bearbeiteAkte } from "../src/bearbeiten.js";
import { analysiere } from "../src/pipeline.js";
import { closeState, openState } from "../src/state.js";

function neueDb() {
  const dir = mkdtempSync(path.join(tmpdir(), "gutachten-bearbeiten-"));
  return openState(path.join(dir, "state.sqlite"));
}

const basis = {
  fahrzeugschein: { vorhanden: true, lesbar: true },
  kennzeichen: { wert: "HB-AA 455", lesbar: true },
  kilometerstand: { wert: "112450", lesbar: true },
  schadenfotos: {
    vorneLinks: true,
    vorneRechts: true,
    hintenRechts: true,
    hintenLinks: true,
  },
  vorschaeden: { angegeben: true, lesbar: true },
  auftraggeber: {
    anrede: "Herr",
    name: "Aras Dawd Psi",
    strasse: "Nimweger Str. 13",
    plz: "28259",
    ort: "Bremen",
    lesbar: true,
  },
};

function adapter() {
  const geoeffnet = [];
  const methoden = {
    geoeffnet,
    async vorbereiten(nummer) {
      geoeffnet.push(nummer);
    },
  };
  for (const id of [
    "besichtigung",
    "beteiligte",
    "fahrzeug",
    "bereifung",
    "vor-ort",
    "vorschaeden",
    "schadenfeststellung",
    "dokumente-import",
    "lichtbilder",
  ]) {
    methoden[id] = async () => {};
  }
  return methoden;
}

test("ohne Nummer und ohne Anmeldung startet keine Eingabe", async () => {
  const db = neueDb();
  const seite = adapter();
  try {
    const ohneNummer = await bearbeiteAkte(db, seite, "", { hatAnmeldung: true });
    assert.equal(ohneNummer.gestartet, false);
    assert.equal(ohneNummer.grund, "nummer");
    const ohneAnmeldung = await bearbeiteAkte(db, seite, "2102/26", { hatAnmeldung: false });
    assert.equal(ohneAnmeldung.gestartet, false);
    assert.equal(ohneAnmeldung.grund, "anmeldung");
    assert.deepEqual(seite.geoeffnet, []);
  } finally {
    closeState(db);
  }
});

test("Akte bearbeiten startet genau diese Nummer", async () => {
  const db = neueDb();
  const seite = adapter();
  try {
    await analysiere(db, {
      nummer: "2102/26",
      dokumente: async () => basis,
      fotos: async () => basis,
    });
    const ergebnis = await bearbeiteAkte(db, seite, "2102/26", {
      hatAnmeldung: true,
      owner: "bearbeiten",
    });
    assert.equal(ergebnis.gestartet, true);
    assert.equal(ergebnis.nummer, "2102/26");
    assert.deepEqual(seite.geoeffnet, ["2102/26"]);
  } finally {
    closeState(db);
  }
});
