import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createUltraExpertAdapter } from "../src/adapter-ultraexpert.js";
import { eingabePlan, schadenText, vorschaedenText, waehleModell, waehleOption } from "../src/eingabe-plan.js";
import { textFuerTrigger } from "../src/schaden-trigger.js";
import { eingeben } from "../src/phase2.js";
import { analysiere } from "../src/pipeline.js";
import { closeState, getVorgang, openState } from "../src/state.js";
import { fakeSeite } from "../src/ultraexpert-seite.js";

function neueDb() {
  const dir = mkdtempSync(path.join(tmpdir(), "gutachten-eingabe-"));
  return openState(path.join(dir, "state.sqlite"));
}

function datensatz() {
  return {
    kuerzel: "HU",
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
    fin: { wert: "WVWZZZCDZLW002977", lesbar: true },
    erstzulassung: { wert: "14.05.2020", lesbar: true },
    getriebe: { wert: "Automatik", lesbar: true },
    hu: { wert: "05.2027", lesbar: true },
    anwalt: { name: "Kanzlei Beispiel", lesbar: true },
    versicherung: { name: "Versicherung Beispiel", lesbar: true },
    gegner: { name: "Kathrin Gegner" },
    hsn: "0603",
    tsn: "CKN",
    bereifung: {
      profiltiefe: "6",
      hersteller: "Michelin",
      dimension: "205/55 R16",
      felgen: "Aluminium",
      lesbar: true,
    },
    schilderung: { wert: "Parkplatzunfall", lesbar: true },
    fahrbereitschaft: "nicht verkehrssicher",
    airbagAusgeloest: false,
    beschaedigungen: ["Der Stoßfänger vorne links ist beschädigt und muss erneuert werden."],
  };
}

test("Plan übernimmt nur lesbare Felder und lässt Gegner und HSN weg", () => {
  const plan = eingabePlan(datensatz());
  const text = JSON.stringify(plan);
  assert.equal(text.includes("Kathrin Gegner"), false);
  assert.equal(text.includes("0603"), false);
  assert.equal(text.includes("CKN"), false);
  assert.equal(plan.besichtigung.befehle.find((befehl) => befehl.feld === "surveys.0.locationName").wert, "");
  assert.equal(plan.besichtigung.befehle.find((befehl) => befehl.feld === "surveys.0.location").wert, "Weg 1, 20095 Hamburg");
  assert.equal(plan.besichtigung.befehle.find((befehl) => befehl.feld === "Sachverständiger").wert, "Hussein Souleiman");
  assert.equal(plan.beteiligte.befehle.find((befehl) => befehl.rolle === "Anwalt").anrede, "Firma");
  assert.equal(plan.fahrzeug.befehle.find((befehl) => befehl.feld === "vehicle.vin").wert, "WVWZZZCDZLW002977");
  assert.equal(plan.bereifung.befehle.some((befehl) => befehl.typ === "bereifung" && befehl.felgen === "Aluminium"), true);
  assert.equal(JSON.stringify(plan.bereifung).includes("Sommer"), false);
  assert.equal(plan.schadenfeststellung.befehle.find((befehl) => befehl.feld === "airbagReleased").wert, "Nein");

  const unleserlich = datensatz();
  unleserlich.bereifung = { ...unleserlich.bereifung, lesbar: false, profiltiefe: "6" };
  assert.equal(eingabePlan(unleserlich).bereifung.fachlich, "Bereifung fehlt");
  assert.equal(JSON.stringify(eingabePlan(unleserlich).bereifung).includes("Michelin"), false);
});

test("abweichender Scheinname wird Fahrzeughalter, gleicher Name nicht", () => {
  const abweichend = datensatz();
  abweichend.fahrzeughalter = {
    anrede: "Herr",
    name: "Max Halter",
    strasse: "Andere Str. 2",
    plz: "28195",
    ort: "Bremen",
    lesbar: true,
  };
  const rollen = eingabePlan(abweichend).beteiligte.befehle.filter((befehl) => befehl.typ === "beteiligter");
  assert.equal(rollen.find((befehl) => befehl.rolle === "Auftraggeber").vorname, "Anna");
  const ohneAnrede = datensatz();
  delete ohneAnrede.auftraggeber.anrede;
  assert.equal(eingabePlan(ohneAnrede).beteiligte.befehle.find((befehl) => befehl.rolle === "Auftraggeber").anrede, "Herr");
  assert.equal(rollen.find((befehl) => befehl.rolle === "Fahrzeughalter").nachname, "Halter");

  const gleich = datensatz();
  gleich.fahrzeughalter = { ...abweichend.fahrzeughalter, name: "Anna Beispiel" };
  const ohneHalter = eingabePlan(gleich).beteiligte.befehle.filter((befehl) => befehl.rolle === "Fahrzeughalter");
  assert.equal(ohneHalter.length, 0);
});

test("Fahrbereitschaft und Modell werden eindeutig gewählt", () => {
  const optionen = ["verkehrssicher", "fahrfähig (nicht verkehrssicher)", "nicht fahrbereit"];
  assert.equal(waehleOption(optionen, "nicht verkehrssicher"), "fahrfähig (nicht verkehrssicher)");
  assert.equal(waehleOption(optionen, "verkehrssicher"), "verkehrssicher");
  assert.equal(waehleOption(optionen, "nicht fahrbereit"), "nicht fahrbereit");
  assert.equal(waehleModell(
    ["C 180 Schaltgetriebe", "C 180 Automatik 2020"],
    { erstzulassung: "14.05.2020", getriebe: "Automatik" },
  ), "C 180 Automatik 2020");
  assert.equal(waehleModell(
    ["C 180 Automatik", "C 200 Automatik"],
    { erstzulassung: "14.05.2020", getriebe: "Automatik" },
  ), null);
});

test("Eingabe speichert die bekannten Schritte und stoppt vor der Reifengrafik", async () => {
  const db = neueDb();
  const seite = fakeSeite({ modelle: ["C 180 Schaltgetriebe", "C 180 Automatik 2020"] });
  const zeilen = [];
  try {
    await analysiere(db, {
      nummer: "2400/26",
      dokumente: async () => datensatz(),
      fotos: async () => datensatz(),
    });
    const ergebnis = await eingeben(db, createUltraExpertAdapter({ seite }), {
      sleep: async () => {},
      owner: "klick",
      log: (zeile) => zeilen.push(zeile),
    });
    assert.equal(ergebnis.stand, "pausiert");
    assert.equal(getVorgang(db, "2400/26").schritte.besichtigung, "erledigt");
    assert.equal(getVorgang(db, "2400/26").schritte.fahrzeug, "erledigt");
    assert.equal(getVorgang(db, "2400/26").schritte.bereifung, "offen");
    assert.equal(seite.gespeichert.length, 3);
    assert.equal(seite.gespeichert.some((stand) => JSON.stringify(stand).includes("HH-AB 100")), false);
    assert.equal(zeilen.some((zeile) => zeile.includes("HH-AB 100") || zeile.includes("Beispiel")), false);
    assert.equal(seite.geoeffnet.includes("2083/26"), false);
  } finally {
    closeState(db);
  }
});

test("fertig bearbeitete Akten werden nicht geöffnet", async () => {
  const db = neueDb();
  const seite = fakeSeite();
  try {
    await analysiere(db, {
      nummer: "2083/26",
      dokumente: async () => datensatz(),
      fotos: async () => datensatz(),
    });
    const ergebnis = await eingeben(db, createUltraExpertAdapter({ seite }), {
      sleep: async () => {},
      owner: "schutz",
    });
    assert.equal(ergebnis.stand, "uebersprungen");
    assert.equal(seite.geoeffnet.length, 0);
    assert.equal(seite.gespeichert.length, 0);
    const zeile = db.prepare("SELECT status FROM eingabe_queue WHERE nummer = ?").get("2083/26");
    assert.equal(zeile.status, "uebersprungen");
  } finally {
    closeState(db);
  }
});

test("nicht reparierte Vorschäden stehen nur in einer Liste", () => {
  const text = vorschaedenText({
    ausserhalb: [
      "Tür hinten links beschädigt",
      "Tür vorne links beschädigt",
      "Tür vorne links beschädigt",
      "Außenspiegel links beschädigt",
      "Stoßfänger hinten links beschädigt",
    ],
    imSchadenbereich: [
      "Stoßfänger hinten links beschädigt",
      "Stoßfänger hinten rechts beschädigt",
      "Seitenwand hinten links beschädigt",
      "Scheibenrad sowie Reifen hinten links beschädigt",
      "Kotflügel vorne links beschädigt",
      "Scheibenrad sowie Reifen vorne links beschädigt",
    ],
  });
  assert.equal(
    text,
    "<p>Nicht im Schadenbereich:</p><ul><li>Tür hinten links beschädigt</li><li>Tür vorne links beschädigt</li><li>Außenspiegel links beschädigt</li></ul>"
      + "<p>Im Schadenbereich:</p><ul><li>Stoßfänger hinten beschädigt</li><li>Seitenwand hinten links beschädigt</li><li>Scheibenrad sowie Reifen hinten links beschädigt</li><li>Kotflügel vorne links beschädigt</li><li>Scheibenrad sowie Reifen vorne links beschädigt</li></ul>"
      + "<p>Die Vorschäden, welche sich ebenfalls im aktuellen Schadenbereich befinden haben einen geringen Schadenausmaß. Durch den neuen Zusammenstoß, ist ein <strong>wirtschaftlicher Mehrschaden</strong> entstanden.</p>"
      + "<p>Für diese Vorschäden wurde ein Vorteilsausgleich bei der Lackierung sowie den Ersatzteilen berücksichtigt (<strong>vgl. Wertverbesserung</strong>). Im Rahmen der Instandsetzung des Fahrzeuges werden die Vorschäden zwangsläufig mit beseitigt. Vorliegend tritt eine Gesamtwertverbesserung des Fahrzeuges in Höhe von {{INCREASE_IN_VALUE_PREDAMAGE}} ein.</p>",
  );
});

test("Vorschäden nur außerhalb ohne Mehrschaden und Wertverbesserung", () => {
  const text = vorschaedenText({
    ausserhalb: ["Stoßfänger hinten beschädigt"],
  });
  assert.equal(text, "<p>Nicht im Schadenbereich:</p><ul><li>Stoßfänger hinten beschädigt</li></ul>");
});

test("Schadenbeschreibung übernimmt den Triggertext", () => {
  assert.equal(textFuerTrigger("sfv"), "Der Stoßfänger vorne ist beschädigt und muss erneuert werden");
  assert.equal(textFuerTrigger("<div"), textFuerTrigger("div"));
  const text = schadenText([textFuerTrigger("sfv")]);
  assert.match(text, /• Der Stoßfänger vorne ist beschädigt und muss erneuert werden/);
  assert.match(text, /• Diverse Anbauteile sowie Komponenten im Schadenbereich sind beschädigt und müssen erneuert werden \(vgl\. Ersatzteile in der Kalkulation\)\./);
});
