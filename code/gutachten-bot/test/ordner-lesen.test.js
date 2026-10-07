import assert from "node:assert/strict";
import test from "node:test";
import { ordneDateien } from "../src/dateien-ordnen.js";
import { gleicheFelder, sammleFotoRollen } from "../src/ordner-lesen.js";
import { rohAusModell } from "../src/lese-roh.js";
import { werteLesung } from "../src/lesung.js";

test("Ordner trennt BD, Abtretung und Fotos und lässt Video sowie Fotos 2 weg", () => {
  const gruppen = ordneDateien([
    { name: "2102/26 BD.pdf", mimeType: "application/pdf", ordner: "" },
    { name: "2102/26 AE.pdf", mimeType: "application/pdf", ordner: "" },
    { name: "2102/26 Vollmacht.pdf", mimeType: "application/pdf", ordner: "" },
    { name: "2102/26 K.pdf", mimeType: "application/pdf", ordner: "" },
    { name: "IMG_4166.JPG", mimeType: "image/jpeg", ordner: "Fotos" },
    { name: "IMG_4165.JPG", mimeType: "image/jpeg", ordner: "Fotos" },
    { name: "clip.mp4", mimeType: "video/mp4", ordner: "Fotos 2" },
  ]);
  assert.equal(gruppen.bd.length, 1);
  assert.equal(gruppen.ae.length, 1);
  assert.equal(gruppen.vollmacht.length, 1);
  assert.deepEqual(gruppen.fotos.map((datei) => datei.name), ["IMG_4165.JPG", "IMG_4166.JPG"]);
});

test("Der Fahrzeugschein wird auch unter den ersten Fotos erkannt", async () => {
  const fotos = ["IMG_4389.JPG", "IMG_4390.JPG", "IMG_4391.JPG"].map((name) => ({ name }));
  const rollen = await sammleFotoRollen(fotos, async (_auftrag, stapel) => {
    const schein = stapel.find((foto) => foto.name === "IMG_4390.JPG");
    return schein ? { schein: schein.name, vorneLinks: "IMG_4391.JPG" } : {};
  });
  assert.equal(rollen.schein, "IMG_4390.JPG");
  assert.equal(rollen.vorneLinks, "IMG_4391.JPG");
  assert.equal(rollen.vorneRechts, "");
});

test("Zwei Reifenfotos werden gesammelt, eine Übersicht nicht", async () => {
  const fotos = ["IMG_1.JPG", "IMG_2.JPG", "IMG_3.JPG"].map((name) => ({ name }));
  const rollen = await sammleFotoRollen(fotos, async () => ({
    vorneLinks: "IMG_1.JPG",
    reifen: ["IMG_1.JPG", "IMG_2.JPG", "IMG_3.JPG", "fremd.jpg"],
  }));
  assert.deepEqual(rollen.reifen, ["IMG_2.JPG", "IMG_3.JPG"]);
});

test("Reifenfotos füllen die Bereifung, wenn die BD leer ist", () => {
  const roh = rohAusModell({}, {
    bereifungBild: { profiltiefe: "5 mm", hersteller: "Michelin", dimension: "205/55R16", felgen: "Alu" },
  });
  const daten = werteLesung({ ...roh, ordnerName: "2113/26 Unfallgutachten (HU)" });
  assert.equal(daten.bereifung.profiltiefe, "5");
  assert.equal(daten.bereifung.hersteller, "Michelin");
  assert.equal(daten.bereifung.dimension, "205/55 R16");
  assert.equal(daten.bereifung.felgen, "Aluminium");
  assert.equal(daten.bereifung.lesbar, true);
  const luecke = rohAusModell({}, {
    bereifungBild: { profiltiefe: "4", hersteller: "", dimension: "195/60 R16", felgen: "Stahl" },
  });
  assert.equal(luecke.bd.bereifung.lesbar, false);
});

test("Leere Fahrbereitschaft auf der BD ist verkehrssicher", () => {
  const leer = rohAusModell({ fahrbereitschaft: "" }, { bdGelesen: true });
  assert.equal(leer.bd.fahrbereitschaft, "verkehrssicher");
  const kreuz = rohAusModell({ fahrbereitschaft: "nicht verkehrssicher" }, { bdGelesen: true });
  assert.equal(kreuz.bd.fahrbereitschaft, "nicht verkehrssicher");
  const ohneBlatt = rohAusModell({ fahrbereitschaft: "" });
  assert.equal(ohneBlatt.bd.fahrbereitschaft, "");
});

test("zwei Lesungen gelten auch bei Str. und zweistelliger Jahreszahl", () => {
  const felder = gleicheFelder(
    {
      auftraggeber: { name: "Ralf-Friedrich Schlemermeyer", strasse: "Bardenflethuser Str. 57", plz: "28259", ort: "Bremen" },
      schadentag: "30.09.26",
    },
    {
      auftraggeber: { name: "Ralf Friedrich Schlemermeyer", strasse: "Bardenflethuser Straße 57", plz: "28 259", ort: "Bremen" },
      schadentag: "30.09.2026",
    },
  );
  assert.equal(felder.auftraggeber.name, "Ralf-Friedrich Schlemermeyer");
  assert.equal(felder.auftraggeber.strasse, "Bardenflethuser Straße 57");
  assert.equal(felder.auftraggeber.plz, "28259");
  assert.equal(felder.schadentag, "30.09.2026");
});

test("Reifenfoto wird auch bei anderer Schreibweise des Dateinamens gefunden", async () => {
  const fotos = ["IMG_1.JPG", "IMG_2.JPG"].map((name) => ({ name }));
  const rollen = await sammleFotoRollen(fotos, async (auftrag) => {
    if (String(auftrag).includes("Nahaufnahmen von Reifen")) return { reifen: ["img_2.jpg"] };
    return { vorneLinks: "IMG_1.JPG" };
  });
  assert.deepEqual(rollen.reifen, ["IMG_2.JPG"]);
});

test("Schadentag in der Zukunft bleibt leer", () => {
  const roh = rohAusModell({ schadentag: "01.10.2099", schadennummer: "26-100", schadenort: "Bremen" });
  assert.equal(roh.ae.schadentag.lesbar, false);
  const kurz = rohAusModell({ schadentag: "30.09.26" });
  assert.equal(kurz.ae.schadentag.wert, "30.09.2026");
  const auffahrt = rohAusModell({ hergangAuffahrunfall: true }, { bdGelesen: true });
  assert.equal(auffahrt.bd.hergang[0], "auffahrunfall");
  assert.equal(roh.ae.schadennummer.wert, "26-100");
  assert.equal(roh.ae.schadenort.wert, "Bremen");
});

test("Anwalt nur aus der Vollmacht, nicht der Name des Auftraggebers", () => {
  const mitVollmacht = rohAusModell({
    auftraggeber: { anrede: "Herr", name: "Aras Dawd Psi", strasse: "Nimweger Str. 13", plz: "28259", ort: "Bremen" },
    anwalt: "Kanzlei Meier",
  }, { vollmacht: true });
  assert.equal(mitVollmacht.ae.anwalt.name, "Kanzlei Meier");
  const namenVerwechselt = rohAusModell({
    auftraggeber: { anrede: "Herr", name: "Aras Dawd Psi", strasse: "Nimweger Str. 13", plz: "28259", ort: "Bremen" },
    anwalt: "Aras Dawd Psi",
  }, { vollmacht: true });
  assert.equal(namenVerwechselt.ae.anwalt, undefined);
  const ohne = rohAusModell({ anwalt: "Kanzlei Meier" }, { vollmacht: false });
  assert.equal(ohne.ae.anwalt, undefined);
});

test("Straße mit angehängtem str. kommt vom Fahrzeugschein", () => {
  const roh = rohAusModell({
    halter: { name: "Eva Beispiel", strasse: "Hauptstr. 12", plz: "28195", ort: "Bremen" },
  });
  const daten = werteLesung(roh);
  assert.equal(daten.auftraggeber.name, "Eva Beispiel");
  assert.equal(daten.auftraggeber.strasse, "Hauptstr. 12");
  assert.equal(daten.auftraggeber.ort, "Bremen");
  assert.equal(daten.fahrzeughalter, undefined);
});

test("fehlender Auftraggeber kommt vom Fahrzeugschein", () => {
  const roh = rohAusModell({
    halter: { name: "Ralf Schlemermeyer", strasse: "Bardenflethuser Str. 57", plz: "28259", ort: "Bremen" },
  });
  const daten = werteLesung(roh);
  assert.equal(daten.auftraggeber.name, "Ralf Schlemermeyer");
  assert.equal(daten.auftraggeber.strasse, "Bardenflethuser Str. 57");
  assert.equal(daten.auftraggeber.plz, "28259");
  assert.equal(daten.auftraggeber.ort, "Bremen");
  assert.equal(daten.fahrzeughalter, undefined);

  const bleibt = rohAusModell({
    auftraggeber: { anrede: "Herr", name: "Anna Beispiel", strasse: "Weg 1", plz: "20095", ort: "Hamburg" },
    halter: { name: "Max Halter", strasse: "Andere Str. 2", plz: "28195", ort: "Bremen" },
  });
  const getrennt = werteLesung(bleibt);
  assert.equal(getrennt.auftraggeber.name, "Anna Beispiel");
  assert.equal(getrennt.fahrzeughalter.name, "Max Halter");
});

test("Kennzeichen des Unfallgegners bleibt, das eigene Kennzeichen nicht", () => {
  const roh = rohAusModell({
    kennzeichenAbtretung: "HB-AA 455",
    kennzeichenUnfallgegner: "HB-WA 541",
    versicherung: { name: "HUK Coburg" },
  });
  assert.equal(roh.ae.unfallgegnerKennzeichen.wert, "HB-WA 541");
  assert.equal(roh.ae.versicherung.lesbar, false);
  const gleich = rohAusModell({
    kennzeichenAbtretung: "HB-AA 455",
    kennzeichenUnfallgegner: "HB-AA 455",
  });
  assert.equal(gleich.ae.unfallgegnerKennzeichen.lesbar, false);
});

test("Lesung aus dem Modell übernimmt Plakette und lässt die Vollmacht weg", () => {
  const roh = rohAusModell({
    auftraggeber: { anrede: "Herr", name: "Aras Dawd Psi", strasse: "Nimweger Str. 13", plz: "28259", ort: "Bremen" },
    versicherung: { name: "HUK Coburg" },
    anwalt: "Kanzlei Beispiel",
    kennzeichenAbtretung: "HB-AA 465",
    kennzeichenSchein: "HB-AA 455",
    kennzeichenBild: "HB-AA 455",
    fin: "W0V7H9EGXL4345038",
    erstzulassung: "09.10.2020",
    getriebe: "Automatik",
    halter: { name: "Aras Dawd Psi", strasse: "Nimweger Str. 13", plz: "28259", ort: "Bremen" },
    huPlakette: "11.2027",
    kilometerstand: "112450",
    fahrbereitschaft: "verkehrssicher",
    hergangGeparkt: true,
    polizei: true,
    bereifung: { profiltiefe: "4", hersteller: "Hancock", dimension: "195/60 R16", felgen: "Aluminium" },
    beschaedigungKuerzel: ["sfv", "unbekannt"],
    beschaedigungOhneKuerzel: [{ artikel: "Die", teil: "Blende vorne links" }],
    vorschadenAusserhalb: ["Tür vorne links beschädigt"],
    vorschadenImBereich: [],
    uebersichten: { vorneLinks: "IMG_4165.JPG", vorneRechts: "IMG_4166.JPG", hintenRechts: "IMG_4167.JPG", hintenLinks: "IMG_4168.JPG" },
  }, { vollmacht: false, kuerzel: "OS" });
  const daten = werteLesung({ ...roh, ordnerName: "2102/26 Unfallgutachten Dawd Psi (OS)" });
  assert.equal(daten.kennzeichen.wert, "HB-AA 455");
  assert.equal(daten.hu.wert, "11.2027");
  assert.equal(daten.vollmacht, false);
  assert.equal(daten.anwalt, undefined);
  assert.equal(daten.fin.wert, "W0V7H9EGXL4345038");
  assert.equal(daten.beschaedigungen.some((satz) => satz.includes("Stoßfänger vorne")), true);
  assert.equal(daten.beschaedigungen.some((satz) => satz.includes("unbekannt")), false);
  assert.equal(daten.beschaedigungen.some((satz) => satz.includes("Blende vorne links")), true);
  assert.equal(daten.vorschaeden.ausserhalb[0], "Tür vorne links beschädigt");
  const leer = rohAusModell({ kennzeichenAbtretung: true, fin: "kurz", huPlakette: "10.25" });
  assert.equal(leer.ae.kennzeichen.wert, "");
  assert.equal(leer.schein.fin.lesbar, false);
  assert.equal(leer.bd.hu, "");
});
