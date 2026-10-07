import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ordneDateien } from "./dateien-ordnen.js";
import { ladeBytes, ladeVorschau } from "./drive-foto.js";
import { leseOrdnerMeta, listeOrdnerBaum } from "./drive-ordner.js";
import { frageGemini, schadenKuerzel } from "./gemini-lesen.js";
import { reifenFelder, rohAusModell } from "./lese-roh.js";

const PDF_GRENZE = 15 * 1024 * 1024;

function pdfAuftrag(art) {
  if (art === "vollmacht") {
    return [
      "Lies nur diese Vollmacht. Antworte als JSON. Unleserliches bleibt leer. Nichts schätzen.",
      "anwalt ist der Name der Kanzlei oder des Rechtsanwalts, der bevollmächtigt wird. Nicht der Name des Auftraggebers.",
      "{\"anwalt\":\"\"}",
    ].join("\n");
  }
  if (art === "bd") {
    return [
      "Lies nur dieses Besichtigungsblatt. Antworte als JSON. Unleserliches bleibt leer. Nichts schätzen.",
      "Fahrbereitschaft: Sind die Kästchen 'nicht fahrbereit' und 'nicht verkehrssicher' leer, ist der Wert verkehrssicher. Nur das gesetzte Kreuz ergibt nicht verkehrssicher oder nicht fahrbereit. Ein Kreuz in der Reifenzeile gehört nicht zur Fahrbereitschaft.",
      "Reifen: die Zahl bei V und bei H ist die Profiltiefe. Der Name darunter ist der Hersteller. Die Größe daneben ist die Dimension. Der obere Kreis ist Stahl, der untere Aluminium. Nur das gesetzte Kreuz.",
      "Beschädigt, zum Beispiel TVL, ist ein Vorschaden und steht in vorschadenAusserhalb. TVL heißt Tür vorne links beschädigt.",
      "Der aktuelle Anstoß steht im Feld Schadenbereich, in der Skizze und in der Handschrift daneben, nicht in der Zeile Beschädigt. PDC heißt Parkhilfe-Sensor. Ein N oder neu am Bauteil heißt erneuern.",
      "polizei true nur bei Kreuz 'Polizeilich aufgenommen'. scheckheft true nur bei Kreuz Scheckheftgepflegt.",
      "hergangGeparkt true nur bei Kreuz 'Geparkter Zustand'. hergangAuffahrunfall true nur bei Kreuz 'Auffahrunfall'. Sonst beide false.",
      "kilometerstand aus der Zeile KM. HU vom Blatt nicht übernehmen.",
      "Aktueller Anstoß zusätzlich als aktuell, zum Beispiel Stoßfänger hinten, Träger hinten, Parkhilfe-Sensor hinten. Ein einzelner Sensor ist nicht das Kürzel für alle Sensoren.",
      "beschaedigungKuerzel nur aus dieser Liste, sonst beschaedigungOhneKuerzel mit artikel Der, Die oder Das:",
      schadenKuerzel().join(", "),
      "vorschadenImBereich nur, wenn der neue Anstoß dasselbe Bauteil wieder trifft. Dieselbe Seite reicht nicht.",
      "Felder: fahrbereitschaft, airbagAusgeloest, scheckheft, polizei, hergangGeparkt, hergangAuffahrunfall, bereifung, beschaedigungKuerzel, beschaedigungOhneKuerzel, aktuell, vorschadenImBereich, vorschadenAusserhalb, kilometerstand.",
    ].join("\n");
  }
  return [
    "Lies nur diese Abtretung. Antworte als JSON. Unleserliches bleibt leer. Nichts schätzen.",
    "Auftraggeber ist die Person unter 'Auftraggeber / Anspruchsteller', mit Straße und Hausnummer, PLZ und Ort.",
    "kennzeichenAbtretung ist nur das amtliche Kennzeichen des Auftraggebers.",
    "kennzeichenUnfallgegner ist nur das Kennzeichen des Unfallgegners. Das Kennzeichen des Auftraggebers gehört dort nicht hinein.",
    "Den Namen der Versicherung nicht übernehmen. Sie wird über das Kennzeichen des Unfallgegners ermittelt.",
    "schadentag so, wie er dasteht, auch mit zweistelliger Jahreszahl. Ein Datum nach heute ist falsch gelesen. Ein Strich, der wie eine 7 aussieht und das Datum in die Zukunft schiebt, ist eine 1.",
    "schadennummer, versicherungsnummer, schadenort und schadenstrasse nur, wenn sie klar auf der Abtretung stehen.",
    "Felder: auftraggeber {anrede Herr oder Frau, name, strasse, plz, ort}, kennzeichenAbtretung, kennzeichenUnfallgegner, schadentag, schadennummer, versicherungsnummer, schadenort, schadenstrasse.",
  ].join("\n");
}

async function pdfSeiten(bytes) {
  const verzeichnis = path.join(tmpdir(), `gutachten-pdf-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const { mkdir } = await import("node:fs/promises");
  await mkdir(verzeichnis);
  const pdf = path.join(verzeichnis, "blatt.pdf");
  await writeFile(pdf, bytes);
  const code = await new Promise((fertig) => {
    const vorgang = spawn("pdftoppm", ["-png", "-r", "140", pdf, path.join(verzeichnis, "seite")], { stdio: "ignore" });
    vorgang.on("error", () => fertig(1));
    vorgang.on("close", fertig);
  });
  if (code !== 0) {
    await rm(verzeichnis, { recursive: true, force: true });
    return [];
  }
  const namen = (await readdir(verzeichnis)).filter((name) => name.endsWith(".png")).sort();
  const seiten = [];
  for (const name of namen) {
    seiten.push({ name, mimeType: "image/png", bytes: await readFile(path.join(verzeichnis, name)) });
  }
  await rm(verzeichnis, { recursive: true, force: true });
  return seiten;
}

const FOTO_ROLLEN = ["schein", "kennzeichen", "km", "getriebe", "vorneLinks", "vorneRechts", "hintenRechts", "hintenLinks"];
const FOTO_STAPEL = 8;

function fotoAuftrag() {
  return [
    "Sieh dir nur diese Fotos an. Antworte als JSON. Ein Dateiname nur, wenn das Foto klar dazu gehört, sonst leer.",
    "schein ist die Zulassungsbescheinigung Teil I auf Papier. Eine FIN-Plakette am Fahrzeug ist kein Schein. Ein Polizeiformular ist kein Schein.",
    "kennzeichen ist das Schild mit der Plakette. km ist der Tacho. getriebe ist der Wählhebel.",
    "vorneLinks, vorneRechts, hintenRechts und hintenLinks sind je eine Aufnahme des ganzen Fahrzeugs aus dieser Ecke. Nahaufnahmen, Dokumente und der Boden sind keine Übersicht.",
    "reifen sind Nahaufnahmen von Reifen oder Felgen, auf denen Profiltiefe, Hersteller, Dimension oder die Felge zu sehen ist. Mehrere Dateinamen als Liste.",
    "{\"schein\":\"\",\"kennzeichen\":\"\",\"km\":\"\",\"getriebe\":\"\",\"vorneLinks\":\"\",\"vorneRechts\":\"\",\"hintenRechts\":\"\",\"hintenLinks\":\"\",\"reifen\":[]}",
  ].join("\n");
}

const UEBERSICHTEN = ["vorneLinks", "vorneRechts", "hintenRechts", "hintenLinks"];

function reifenNamen(antwort) {
  const roh = antwort?.reifen;
  const liste = Array.isArray(roh) ? roh : String(roh || "").split(",");
  return liste.map((name) => String(name || "").trim()).filter(Boolean);
}

export async function sammleFotoRollen(fotos, lesen) {
  const treffer = Object.fromEntries(FOTO_ROLLEN.map((rolle) => [rolle, ""]));
  const reifen = [];
  const stapel = [];
  for (let index = 0; index < fotos.length; index += FOTO_STAPEL) {
    stapel.push(fotos.slice(index, index + FOTO_STAPEL));
  }
  const antworten = await Promise.all(stapel.map((teil) => lesen(fotoAuftrag(), teil)));
  antworten.forEach((antwort, index) => {
    const teil = stapel[index];
    for (const rolle of FOTO_ROLLEN) {
      if (treffer[rolle]) continue;
      const name = String(antwort?.[rolle] || "").trim();
      const foto = teil.find((eintrag) => gleicherDateiName(eintrag.name, name));
      if (foto) treffer[rolle] = foto.name;
    }
    for (const name of reifenNamen(antwort)) {
      const foto = teil.find((eintrag) => gleicherDateiName(eintrag.name, name));
      if (!foto || reifen.includes(foto.name)) continue;
      reifen.push(foto.name);
    }
  });
  if (reifen.length === 0) {
    const belegt = new Set(Object.values(treffer).filter(Boolean));
    const rest = fotos.filter((foto) => !belegt.has(foto.name));
    for (let index = 0; index < rest.length && reifen.length < 4; index += 4) {
      const teil = rest.slice(index, index + 4);
      const antwort = await lesen([
        "Welche dieser Fotos sind Nahaufnahmen von Reifen oder Felgen, auf denen Profiltiefe, Hersteller, Dimension oder die Felge zu sehen ist?",
        "Antworte als JSON. Nur Dateinamen aus dieser Gruppe, sonst eine leere Liste.",
        "{\"reifen\":[]}",
      ].join("\n"), teil);
      for (const name of reifenNamen(antwort)) {
        const foto = teil.find((eintrag) => gleicherDateiName(eintrag.name, name));
        if (foto && !reifen.includes(foto.name)) reifen.push(foto.name);
      }
    }
  }
  const uebersicht = new Set(UEBERSICHTEN.map((rolle) => treffer[rolle]).filter(Boolean));
  return { ...treffer, reifen: reifen.filter((name) => !uebersicht.has(name)).slice(0, 4) };
}

async function scheinFotoFinden(fotos, zuordnung, lesen) {
  const direkt = fotos.find((foto) => gleicherDateiName(foto.name, zuordnung?.schein));
  if (direkt) return direkt;
  const belegt = new Set(UEBERSICHTEN.map((rolle) => zuordnung?.[rolle]).filter(Boolean));
  const rest = fotos.filter((foto) => !belegt.has(foto.name));
  for (let index = 0; index < rest.length; index += 4) {
    const teil = rest.slice(index, index + 4);
    const antwort = await lesen([
      "Welche Datei ist die Zulassungsbescheinigung Teil I auf Papier?",
      "Eine FIN-Plakette am Fahrzeug ist kein Schein. Antworte als JSON. Sonst leer.",
      "{\"schein\":\"\"}",
    ].join("\n"), teil);
    const foto = teil.find((eintrag) => gleicherDateiName(eintrag.name, antwort?.schein));
    if (foto) return foto;
  }
  return null;
}

function reifenAuftrag() {
  return [
    "Lies nur diese Reifenfotos. Antworte als JSON. Unleserliches bleibt leer. Nichts schätzen.",
    "profiltiefe nur die Zahl in Millimetern, wenn sie am Messschieber oder aufgeschrieben steht.",
    "hersteller nur der Name auf der Flanke. dimension nur die Größe auf der Flanke, zum Beispiel 195/60 R16.",
    "felgen nur Stahl oder Aluminium, wenn die Felge klar zu sehen ist. Sonst leer.",
    "Reifentyp und Modell leer lassen.",
    "{\"profiltiefe\":\"\",\"hersteller\":\"\",\"dimension\":\"\",\"felgen\":\"\"}",
  ].join("\n");
}

function fahrzeugAuftrag() {
  return [
    "Lies nur diese Fotos. Unleserliches bleibt leer. Die FIN nicht korrigieren.",
    "fin exakt vom Fahrzeugschein, 17 Zeichen. erstzulassung ist Feld B, TT.MM.JJJJ, nicht das Jahr aus der Typgenehmigung.",
    "getriebe nur Automatik, wenn der Wählhebel P R N D zeigt, nur Schaltgetriebe bei sichtbaren Gängen.",
    "kennzeichenSchein vom Schein, kennzeichenBild vom Schild.",
    "huPlakette nur von der Plakette am Schild, Format MM.YYYY. Den Stempel im Schein nicht übernehmen.",
    "kilometerstand nur vom Tacho.",
    "halter vom Schein: name ist Vorname aus C.1.2 und Nachname aus C.1.1. strasse ist C.1.3 inklusive Hausnummer, auch wenn str. am Straßennamen hängt. plz und ort stehen darunter.",
    "{\"fin\":\"\",\"erstzulassung\":\"\",\"getriebe\":\"\",\"kennzeichenSchein\":\"\",\"kennzeichenBild\":\"\",\"huPlakette\":\"\",\"kilometerstand\":\"\",\"halter\":{\"name\":\"\",\"strasse\":\"\",\"plz\":\"\",\"ort\":\"\"}}",
  ].join("\n");
}

function scheinHalterAuftrag() {
  return [
    "Lies nur diese Zulassungsbescheinigung Teil I. Antworte als JSON. Unleserliches bleibt leer. Nichts schätzen. Die FIN nicht korrigieren.",
    "name ist Vorname aus C.1.2 und Nachname aus C.1.1.",
    "strasse ist C.1.3 inklusive Hausnummer. str. direkt am Straßennamen behalten.",
    "plz und ort stehen unter der Straße.",
    "fin ist Feld E, 17 Zeichen. erstzulassung ist Feld B als TT.MM.JJJJ, nicht das Jahr aus der Typgenehmigung.",
    "kennzeichenSchein ist das Kennzeichen auf dem Schein.",
    "{\"halter\":{\"name\":\"\",\"strasse\":\"\",\"plz\":\"\",\"ort\":\"\"},\"fin\":\"\",\"erstzulassung\":\"\",\"kennzeichenSchein\":\"\"}",
  ].join("\n");
}

async function vorschau(foto, verzeichnis) {
  const ziel = path.join(verzeichnis, `${foto.id}.jpg`);
  await ladeVorschau(foto.id, ziel);
  return { name: foto.name, mimeType: "image/jpeg", bytes: await readFile(ziel) };
}

function vergleich(wert) {
  return String(wert ?? "")
    .trim()
    .toLowerCase()
    .replace(/straße|strasse/g, "str")
    .replace(/\bstr\./g, "str")
    .replace(/[.\-/,]+/g, " ")
    .replace(/(\d)\s+(?=\d)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function datumVergleich(wert) {
  const roh = String(wert ?? "").trim();
  const kurz = roh.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2})$/);
  if (kurz) {
    const jahr = Number(kurz[3]) <= 50 ? 2000 + Number(kurz[3]) : 1900 + Number(kurz[3]);
    return `${kurz[1].padStart(2, "0")}.${kurz[2].padStart(2, "0")}.${jahr}`;
  }
  const lang = roh.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!lang) return "";
  return `${lang[1].padStart(2, "0")}.${lang[2].padStart(2, "0")}.${lang[3]}`;
}

function nimm(links, rechts) {
  const datum = datumVergleich(links);
  if (datum && datum === datumVergleich(rechts)) return datum;
  if (vergleich(links) && vergleich(links) === vergleich(rechts)) {
    const a = String(links).trim();
    const b = String(rechts).trim();
    const gewaehlt = a.length >= b.length ? a : b;
    return gewaehlt.replace(/(\d)\s+(?=\d)/g, "$1");
  }
  return "";
}

function gleicherDateiName(links, rechts) {
  const kern = (name) => String(name || "").trim().toLowerCase().replace(/^.*\//, "").replace(/\.[a-z0-9]+$/i, "");
  return kern(links) !== "" && kern(links) === kern(rechts);
}

export function gleicheFelder(links, rechts) {
  const a = links || {};
  const b = rechts || {};
  return {
    auftraggeber: {
      anrede: nimm(a.auftraggeber?.anrede, b.auftraggeber?.anrede),
      name: nimm(a.auftraggeber?.name, b.auftraggeber?.name),
      strasse: nimm(a.auftraggeber?.strasse, b.auftraggeber?.strasse),
      plz: nimm(a.auftraggeber?.plz, b.auftraggeber?.plz),
      ort: nimm(a.auftraggeber?.ort, b.auftraggeber?.ort),
    },
    kennzeichenAbtretung: nimm(a.kennzeichenAbtretung, b.kennzeichenAbtretung),
    kennzeichenUnfallgegner: nimm(a.kennzeichenUnfallgegner, b.kennzeichenUnfallgegner),
    schadentag: nimm(a.schadentag, b.schadentag),
    schadennummer: nimm(a.schadennummer, b.schadennummer),
    versicherungsnummer: nimm(a.versicherungsnummer, b.versicherungsnummer),
    schadenort: nimm(a.schadenort, b.schadenort),
    schadenstrasse: nimm(a.schadenstrasse, b.schadenstrasse),
  };
}

function abtretungLuecke(ae) {
  const person = ae?.auftraggeber || {};
  return ["name", "strasse", "plz", "ort"].some((key) => !person[key])
    || !ae?.schadentag
    || !ae?.schadenort;
}

function lueckeFuellen(bisher, links, rechts, neu) {
  const ausLinks = gleicheFelder(links, neu);
  const ausRechts = gleicheFelder(rechts, neu);
  const person = { ...(bisher.auftraggeber || {}) };
  for (const key of ["anrede", "name", "strasse", "plz", "ort"]) {
    if (!person[key]) person[key] = ausLinks.auftraggeber?.[key] || ausRechts.auftraggeber?.[key] || "";
  }
  const felder = { ...bisher, auftraggeber: person };
  for (const key of ["kennzeichenAbtretung", "kennzeichenUnfallgegner", "schadentag", "schadennummer", "versicherungsnummer", "schadenort", "schadenstrasse"]) {
    if (!felder[key]) felder[key] = ausLinks[key] || ausRechts[key] || "";
  }
  return felder;
}

export async function leseFallOrdner({ folderId, lesen = frageGemini } = {}) {
  const meta = await leseOrdnerMeta(folderId);
  const gruppen = ordneDateien(await listeOrdnerBaum(folderId));
  const dokumenteGefunden = gruppen.bd.length + gruppen.ae.length + gruppen.vollmacht.length + gruppen.fotos.length > 0;
  if (!dokumenteGefunden) {
    return { dokumenteGefunden: false, meta, bd: null, ae: null, schein: null, bilder: {} };
  }

  const dateien = [];
  const vollmachtPdf = gruppen.vollmacht.filter((datei) => datei.mimeType === "application/pdf" || /\.pdf$/i.test(datei.name || ""));
  for (const pdf of [...gruppen.bd, ...gruppen.ae, ...vollmachtPdf]) {
    const bytes = await ladeBytes(pdf.id);
    if (bytes.length > PDF_GRENZE) throw new Error(`Dokument zu groß: ${pdf.name}`);
    const art = gruppen.bd.includes(pdf) ? "bd" : gruppen.ae.includes(pdf) ? "ae" : "vollmacht";
    const seiten = await pdfSeiten(bytes);
    if (seiten.length === 0) {
      dateien.push({ name: pdf.name, mimeType: "application/pdf", bytes, art });
      continue;
    }
    seiten.forEach((seite, index) => {
      dateien.push({ name: `${pdf.name} Seite ${index + 1}`, mimeType: seite.mimeType, bytes: seite.bytes, art });
    });
  }

  const verzeichnis = await mkdtemp(path.join(tmpdir(), "gutachten-lese-"));
  let fotos = [];
  let vollmachtBilder = [];
  try {
    fotos = [];
    for (const foto of gruppen.fotos) fotos.push(await vorschau(foto, verzeichnis));
    vollmachtBilder = [];
    for (const datei of gruppen.vollmacht) {
      if (vollmachtPdf.includes(datei)) continue;
      vollmachtBilder.push(await vorschau(datei, verzeichnis));
    }
  } finally {
    await rm(verzeichnis, { recursive: true, force: true });
  }

  const bdPdf = dateien.filter((datei) => datei.art === "bd");
  const aePdf = dateien.filter((datei) => datei.art === "ae");
  const vollmachtSeiten = [...dateien.filter((datei) => datei.art === "vollmacht"), ...vollmachtBilder];
  const [bdAntwort, aeEins, aeZwei, vmEins, vmZwei, zuordnung] = await Promise.all([
    bdPdf.length ? lesen(pdfAuftrag("bd"), bdPdf) : {},
    aePdf.length ? lesen(pdfAuftrag("ae"), aePdf) : {},
    aePdf.length ? lesen(pdfAuftrag("ae"), aePdf) : {},
    vollmachtSeiten.length ? lesen(pdfAuftrag("vollmacht"), vollmachtSeiten) : {},
    vollmachtSeiten.length ? lesen(pdfAuftrag("vollmacht"), vollmachtSeiten) : {},
    fotos.length ? sammleFotoRollen(fotos, lesen) : {},
  ]);
  const anwalt = nimm(vmEins?.anwalt, vmZwei?.anwalt);
  let aeAntwort = gleicheFelder(aeEins, aeZwei);
  if (aePdf.length && abtretungLuecke(aeAntwort)) {
    const aeDrei = await lesen(pdfAuftrag("ae"), aePdf);
    aeAntwort = lueckeFuellen(aeAntwort, aeEins, aeZwei, aeDrei);
  }
  const uebersichten = {
    vorneLinks: zuordnung.vorneLinks || "",
    vorneRechts: zuordnung.vorneRechts || "",
    hintenRechts: zuordnung.hintenRechts || "",
    hintenLinks: zuordnung.hintenLinks || "",
  };
  const gesucht = ["schein", "kennzeichen", "km", "getriebe"]
    .map((rolle) => fotos.find((foto) => foto.name === zuordnung?.[rolle]))
    .filter(Boolean);
  const fahrzeug = gesucht.length ? await lesen(fahrzeugAuftrag(), gesucht) : {};
  const reifenFotos = (Array.isArray(zuordnung.reifen) ? zuordnung.reifen : [])
    .map((name) => fotos.find((foto) => foto.name === name))
    .filter(Boolean);
  let bereifungBild = {};
  if (reifenFotos.length && !reifenFelder(bdAntwort?.bereifung).lesbar) {
    const gelesen = await lesen(reifenAuftrag(), reifenFotos);
    bereifungBild = gelesen?.bereifung || gelesen || {};
  }
  fahrzeug.getriebe = "";
  const hebel = fotos.find((foto) => foto.name === zuordnung?.getriebe);
  if (hebel) {
    const hebelAntwort = await lesen(
      "Nur dieses Foto. Siehst du einen Wählhebel mit P R N D, ist das Getriebe Automatik. Siehst du die Gänge 1 2 3 4 5, ist es Schaltgetriebe. Sonst leer. JSON {\"getriebe\":\"\"}.",
      [hebel],
    );
    if (hebelAntwort?.getriebe === "Automatik" || hebelAntwort?.getriebe === "Schaltgetriebe") {
      fahrzeug.getriebe = hebelAntwort.getriebe;
    }
  }
  const scheinBild = await scheinFotoFinden(fotos, zuordnung, lesen);
  if (scheinBild) {
    const scheinGelesen = await lesen(scheinHalterAuftrag(), [scheinBild]);
    if (scheinGelesen?.halter && typeof scheinGelesen.halter === "object") fahrzeug.halter = scheinGelesen.halter;
    for (const feld of ["fin", "erstzulassung", "kennzeichenSchein"]) {
      if (String(scheinGelesen?.[feld] || "").trim()) fahrzeug[feld] = scheinGelesen[feld];
    }
  }
  const roh = rohAusModell(
    { ...bdAntwort, ...aeAntwort, anwalt },
    {
      fahrzeug,
      schaden: { ...bdAntwort, uebersichten },
      vollmacht: gruppen.vollmacht.length > 0,
      kuerzel: meta.kuerzel,
      bereifungBild,
      bdGelesen: bdPdf.length > 0,
    },
  );
  return { dokumenteGefunden: true, meta, ...roh };
}
