import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ordneDateien } from "./dateien-ordnen.js";
import { ladeBytes, ladeVorschau } from "./drive-foto.js";
import { leseOrdnerMeta, listeOrdnerBaum } from "./drive-ordner.js";
import { frageGemini, schadenKuerzel } from "./gemini-lesen.js";
import { rohAusModell } from "./lese-roh.js";

const PDF_GRENZE = 15 * 1024 * 1024;

function pdfAuftrag(art) {
  if (art === "bd") {
    return [
      "Lies nur dieses Besichtigungsblatt. Antworte als JSON. Unleserliches bleibt leer. Nichts schätzen.",
      "Fahrbereitschaft: Sind die Kästchen 'nicht fahrbereit' und 'nicht verkehrssicher' leer, ist sie verkehrssicher. Ein Kreuz in der Reifenzeile gehört nicht zur Fahrbereitschaft.",
      "Reifen: Profiltiefe aus V und H, Hersteller, Dimension. Zwei Kreuze neben der Dimension: oben Stahl, unten Aluminium. Nur das gesetzte Kreuz.",
      "Beschädigt, zum Beispiel TVL, ist ein Vorschaden und steht in vorschadenAusserhalb. TVL heißt Tür vorne links beschädigt.",
      "Der aktuelle Anstoß steht im Feld Schadenbereich und in der Skizze, nicht in der Zeile Beschädigt.",
      "Ein N oder neu am Bauteil heißt erneuern. PDC heißt Parkhilfe-Sensor.",
      "polizei true nur bei Kreuz 'Polizeilich aufgenommen'. scheckheft true nur bei Kreuz Scheckheftgepflegt.",
      "hergangGeparkt true bei Kreuz 'Geparkter Zustand'. kilometerstand aus der Zeile KM. HU vom Blatt nicht übernehmen.",
      "Aktueller Anstoß zusätzlich als aktuell, zum Beispiel Stoßfänger vorne, Blende VL, PDC VL. Ein einzelner Sensor ist nicht das Kürzel für alle Sensoren.",
      "beschaedigungKuerzel nur aus dieser Liste, sonst beschaedigungOhneKuerzel mit artikel Der, Die oder Das:",
      schadenKuerzel().join(", "),
      "vorschadenImBereich nur, wenn der neue Anstoß dasselbe Bauteil wieder trifft. Dieselbe Seite reicht nicht.",
      "Felder: fahrbereitschaft, airbagAusgeloest, scheckheft, polizei, hergangGeparkt, bereifung, beschaedigungKuerzel, beschaedigungOhneKuerzel, aktuell, vorschadenImBereich, vorschadenAusserhalb, kilometerstand.",
    ].join("\n");
  }
  return [
    "Lies nur diese Abtretung. Antworte als JSON. Unleserliches bleibt leer. Nichts schätzen.",
    "Auftraggeber ist die Person unter 'Auftraggeber / Ansprechsteller', mit Straße, PLZ und Ort.",
    "kennzeichenAbtretung ist nur das 'Amtliche Kennzeichen' des Auftraggebers. Das Kennzeichen des Unfallgegners ignorieren.",
    "versicherung ist die Zeile 'Versicherung', nicht der Unfallgegner.",
    "Felder: auftraggeber {anrede Herr oder Frau, name, strasse, plz, ort}, versicherung {name}, kennzeichenAbtretung.",
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
    "{\"schein\":\"\",\"kennzeichen\":\"\",\"km\":\"\",\"getriebe\":\"\",\"vorneLinks\":\"\",\"vorneRechts\":\"\",\"hintenRechts\":\"\",\"hintenLinks\":\"\"}",
  ].join("\n");
}

export async function sammleFotoRollen(fotos, lesen) {
  const treffer = Object.fromEntries(FOTO_ROLLEN.map((rolle) => [rolle, ""]));
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
      if (teil.some((foto) => foto.name === name)) treffer[rolle] = name;
    }
  });
  return treffer;
}

function fahrzeugAuftrag() {
  return [
    "Lies nur diese Fotos. Unleserliches bleibt leer. Die FIN nicht korrigieren.",
    "fin exakt vom Fahrzeugschein, 17 Zeichen. erstzulassung als TT.MM.JJJJ.",
    "getriebe nur Automatik, wenn der Wählhebel P R N D zeigt, nur Schaltgetriebe bei sichtbaren Gängen.",
    "kennzeichenSchein vom Schein, kennzeichenBild vom Schild.",
    "huPlakette nur von der Plakette am Schild, Format MM.YYYY. Den Stempel im Schein nicht übernehmen.",
    "kilometerstand nur vom Tacho. halter nur der Name auf dem Schein, mit strasse, plz, ort.",
    "Felder: fin, erstzulassung, getriebe, kennzeichenSchein, kennzeichenBild, huPlakette, kilometerstand, halter.",
  ].join("\n");
}

async function vorschau(foto, verzeichnis) {
  const ziel = path.join(verzeichnis, `${foto.id}.jpg`);
  await ladeVorschau(foto.id, ziel);
  return { name: foto.name, mimeType: "image/jpeg", bytes: await readFile(ziel) };
}

function norm(wert) {
  return String(wert ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function nimm(links, rechts) {
  if (norm(links) && norm(links) === norm(rechts)) return links;
  return "";
}

function gleicheFelder(links, rechts) {
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
    versicherung: { name: nimm(a.versicherung?.name, b.versicherung?.name) },
    kennzeichenAbtretung: nimm(a.kennzeichenAbtretung, b.kennzeichenAbtretung),
  };
}

export async function leseFallOrdner({ folderId, lesen = frageGemini } = {}) {
  const meta = await leseOrdnerMeta(folderId);
  const gruppen = ordneDateien(await listeOrdnerBaum(folderId));
  const dokumenteGefunden = gruppen.bd.length + gruppen.ae.length + gruppen.fotos.length > 0;
  if (!dokumenteGefunden) {
    return { dokumenteGefunden: false, meta, bd: null, ae: null, schein: null, bilder: {} };
  }

  const dateien = [];
  for (const pdf of [...gruppen.bd, ...gruppen.ae]) {
    const bytes = await ladeBytes(pdf.id);
    if (bytes.length > PDF_GRENZE) throw new Error(`Dokument zu groß: ${pdf.name}`);
    const art = gruppen.bd.includes(pdf) ? "bd" : "ae";
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
  try {
    fotos = [];
    for (const foto of gruppen.fotos) fotos.push(await vorschau(foto, verzeichnis));
  } finally {
    await rm(verzeichnis, { recursive: true, force: true });
  }

  const bdPdf = dateien.filter((datei) => datei.art === "bd");
  const aePdf = dateien.filter((datei) => datei.art === "ae");
  const [bdAntwort, aeEins, aeZwei, zuordnung] = await Promise.all([
    bdPdf.length ? lesen(pdfAuftrag("bd"), bdPdf) : {},
    aePdf.length ? lesen(pdfAuftrag("ae"), aePdf) : {},
    aePdf.length ? lesen(pdfAuftrag("ae"), aePdf) : {},
    fotos.length ? sammleFotoRollen(fotos, lesen) : {},
  ]);
  const aeAntwort = gleicheFelder(aeEins, aeZwei);
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
  const roh = rohAusModell(
    { ...bdAntwort, ...aeAntwort },
    {
      fahrzeug,
      schaden: { ...bdAntwort, uebersichten },
      vollmacht: gruppen.vollmacht.length > 0,
      kuerzel: meta.kuerzel,
    },
  );
  return { dokumenteGefunden: true, meta, ...roh };
}
