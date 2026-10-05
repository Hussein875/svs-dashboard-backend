import assert from "node:assert/strict";
import test from "node:test";
import { ordneDateien } from "../src/dateien-ordnen.js";
import { sammleFotoRollen } from "../src/ordner-lesen.js";
import { rohAusModell } from "../src/lese-roh.js";
import { werteLesung } from "../src/lesung.js";

test("Ordner trennt BD, Abtretung und Fotos und lässt Video sowie Fotos 2 weg", () => {
  const gruppen = ordneDateien([
    { name: "2102/26 BD.pdf", mimeType: "application/pdf", ordner: "" },
    { name: "2102/26 AE.pdf", mimeType: "application/pdf", ordner: "" },
    { name: "2102/26 K.pdf", mimeType: "application/pdf", ordner: "" },
    { name: "IMG_4166.JPG", mimeType: "image/jpeg", ordner: "Fotos" },
    { name: "IMG_4165.JPG", mimeType: "image/jpeg", ordner: "Fotos" },
    { name: "clip.mp4", mimeType: "video/mp4", ordner: "Fotos 2" },
  ]);
  assert.equal(gruppen.bd.length, 1);
  assert.equal(gruppen.ae.length, 1);
  assert.equal(gruppen.vollmacht.length, 0);
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
