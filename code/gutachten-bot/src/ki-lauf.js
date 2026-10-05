import { mkdirSync } from "node:fs";
import path from "node:path";
import { createUltraExpertAdapter } from "./adapter-ultraexpert.js";
import { teileAnalyseQuellen, werteLesung } from "./lesung.js";
import { leseExtraktionen } from "./drive-ordner.js";
import { leseFallOrdner } from "./ordner-lesen.js";
import { pruefePflichtfelder } from "./pflichtfelder.js";
import { createPlaywrightSeite } from "./ultraexpert-seite.js";
import { starteAkte } from "./start-akte.js";
import { closeState, openState } from "./state.js";

export const LESUNG_VERSUCHE = 3;

function istGefuellt(wert) {
  if (wert === true) return true;
  if (wert === false || wert == null) return false;
  if (typeof wert === "string") return wert.trim().length > 0;
  if (Array.isArray(wert)) return wert.length > 0;
  if (typeof wert === "object") {
    if (wert.lesbar === false) return false;
    if ("wert" in wert) return String(wert.wert ?? "").trim().length > 0;
    if ("vorhanden" in wert) return wert.vorhanden === true;
    if ("name" in wert) return String(wert.name ?? "").trim().length > 0;
    if ("profiltiefe" in wert) return String(wert.profiltiefe ?? "").trim().length > 0;
    return Object.values(wert).some((teil) => istGefuellt(teil));
  }
  return false;
}

function feldZusammen(links, rechts) {
  if (rechts && typeof rechts === "object" && !Array.isArray(rechts)) {
    const nurWahrheitswerte = Object.values(rechts).every((teil) => typeof teil === "boolean");
    if (nurWahrheitswerte && links && typeof links === "object" && !Array.isArray(links)) {
      const zusammen = { ...links };
      for (const [key, wert] of Object.entries(rechts)) {
        zusammen[key] = links[key] === true || wert === true;
      }
      return zusammen;
    }
  }
  if (!istGefuellt(links) && istGefuellt(rechts)) return rechts;
  return links !== undefined ? links : rechts;
}

export function fuehreDatensatzZusammen(bisher, neu) {
  if (!bisher) return neu || null;
  if (!neu) return bisher;
  const ergebnis = { ...bisher };
  for (const [key, wert] of Object.entries(neu)) {
    ergebnis[key] = feldZusammen(bisher[key], wert);
  }
  return ergebnis;
}

export function lesungOffen(datensatz) {
  const namen = [];
  for (const feld of pruefePflichtfelder(datensatz).fehlend) {
    const grund = feld.grund === "unleserlich" ? "unleserlich" : "fehlt";
    namen.push(`${feld.label} (${grund})`);
  }
  if (!String(datensatz?.erstzulassung?.wert || "").trim()) namen.push("Erstzulassung (fehlt)");
  if (!String(datensatz?.getriebe?.wert || "").trim()) namen.push("Getriebe (fehlt)");
  if (!String(datensatz?.fahrbereitschaft || "").trim()) namen.push("Fahrbereitschaft (fehlt)");
  if (!datensatz?.bereifung || datensatz.bereifung.lesbar === false) namen.push("Bereifung (fehlt)");
  if (!String(datensatz?.unfallgegnerKennzeichen?.wert || "").trim()) namen.push("Unfallgegner-Kennzeichen (fehlt)");
  if (datensatz?.vollmacht === true && !String(datensatz?.anwalt?.name || "").trim()) namen.push("Anwalt (unleserlich)");
  if (!String(datensatz?.schilderung || "").trim()) namen.push("Schilderung (fehlt)");
  return namen;
}

function lesbareLogzeile(zeile) {
  const text = String(zeile || "").trim();
  if (!text.startsWith("{")) return text;
  try {
    const eintrag = JSON.parse(text);
    const namen = {
      auftrag: "Auftrag",
      beteiligte: "Beteiligte",
      besichtigung: "Besichtigung",
      fahrzeug: "Fahrzeug",
      bereifung: "Bereifung",
      "vor-ort": "Vor Ort",
      vorschaeden: "Vorschäden",
      schadenfeststellung: "Schadenfeststellung",
      "dokumente-import": "Dokumente",
      lichtbilder: "Lichtbilder",
      eingabe: "Eingabe",
    };
    const staende = {
      laeuft: "läuft",
      erledigt: "fertig",
      offen: "übersprungen",
      fehler: "Fehler",
      wartet: "wartet",
    };
    const schritt = namen[eintrag?.schritt] || String(eintrag?.schritt || "").trim();
    const status = staende[eintrag?.status] || String(eintrag?.status || "").trim();
    if (schritt && status) return `${schritt}: ${status}`;
    return schritt || text;
  } catch {
    return text;
  }
}

function zustandPfad(nummer) {
  const basis = process.env.GUTACHTEN_STATE_DIR || path.join("/tmp", "gutachten-ki-state");
  mkdirSync(basis, { recursive: true });
  const datei = String(nummer).replace(/[^\dA-Za-z]+/g, "-");
  return path.join(basis, `${datei}.sqlite`);
}

export function mapKiUmgebung() {
  if (!process.env.UX_USERNAME && process.env.UX_CUSTOMER_NR) {
    process.env.UX_USERNAME = process.env.UX_CUSTOMER_NR;
  }
  if (!process.env.GUTACHTEN_DRIVE_CREDENTIALS && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    process.env.GUTACHTEN_DRIVE_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }
}

export async function bereiteKiDatensatz({ akte, driveFolderId, onStep, lesen }) {
  mapKiUmgebung();
  const nummer = String(akte || "").trim();
  const folderId = String(driveFolderId || "").trim();
  if (!nummer) throw new Error("Aktenzeichen fehlt.");
  if (!folderId) throw new Error("Drive-Ordner-ID fehlt.");

  let meta = null;
  let datensatz = null;
  let luecken = [];
  for (let versuch = 1; versuch <= LESUNG_VERSUCHE; versuch += 1) {
    onStep?.(versuch === 1
      ? "Dokumente und Fotos lesen"
      : `Lesung erneut, Versuch ${versuch} von ${LESUNG_VERSUCHE}`);
    const fall = await leseFallOrdner({ folderId, lesen });
    if (!fall.dokumenteGefunden) {
      if (!datensatz) {
        const json = await leseExtraktionen({ folderId, nummer });
        meta = json.meta;
        const kuerzel = meta?.kuerzel || json.bd?.kuerzel || json.ae?.kuerzel || "";
        datensatz = werteLesung({
          ae: json.ae,
          bd: json.bd,
          schein: json.schein,
          bilder: {},
          ordnerName: meta?.name,
          kuerzel,
        });
      }
      break;
    }
    meta = meta || fall.meta;
    const kuerzel = meta?.kuerzel || fall.bd?.kuerzel || fall.ae?.kuerzel || "";
    const gelesen = werteLesung({
      ae: fall.ae,
      bd: fall.bd,
      schein: fall.schein,
      bilder: fall.bilder,
      ordnerName: meta?.name,
      kuerzel,
    });
    datensatz = fuehreDatensatzZusammen(datensatz, gelesen);
    luecken = lesungOffen(datensatz);
    if (luecken.length === 0) break;
    if (versuch < LESUNG_VERSUCHE) onStep?.(`Noch offen: ${luecken.join(", ")}`);
  }

  luecken = lesungOffen(datensatz || {});
  const kuerzel = meta?.kuerzel || datensatz?.kuerzel || "";
  const { dokumente, fotos } = teileAnalyseQuellen(datensatz || {});
  return { nummer, folderId, meta: meta || { name: "" }, kuerzel, dokumente, fotos, luecken };
}

export async function runKiGutachten({
  akte,
  driveFolderId,
  page,
  onStep,
  control,
  vorbereitet,
}) {
  mapKiUmgebung();

  const nummer = String(akte || "").trim();
  const folderId = String(driveFolderId || "").trim();
  if (!nummer) throw new Error("Aktenzeichen fehlt.");
  if (!folderId) throw new Error("Drive-Ordner-ID fehlt.");
  if (!page) throw new Error("Playwright-Seite fehlt.");

  if (control?.isStopped?.()) {
    const err = new Error("Gestoppt");
    err.code = "BOT_STOPPED";
    throw err;
  }

  const quelle = vorbereitet || await bereiteKiDatensatz({ akte: nummer, driveFolderId: folderId });
  const meta = quelle.meta;
  const kuerzel = quelle.kuerzel;
  const dokumente = quelle.dokumente;
  const fotos = quelle.fotos;

  const db = openState(zustandPfad(nummer));

  const log = (zeile) => {
    if (typeof zeile === "string") onStep?.(lesbareLogzeile(zeile));
    else if (zeile?.schritt) onStep?.(`${zeile.schritt}: ${zeile.status}`);
  };

  try {
    onStep?.("Gutachten-Bot: Pflichtfelder und Eingabe");
    const adapter = createUltraExpertAdapter({
      seite: createPlaywrightSeite(page),
    });
    const ergebnis = await starteAkte(db, {
      nummer,
      ordnerName: meta.name,
      kuerzel,
      dokumente: async () => dokumente,
      fotos: async () => fotos,
    }, adapter, {
      owner: `ki-${process.pid}`,
      log,
      maxVersuche: 3,
      nacheinander: true,
      trotzLuecken: true,
    });

    if (!ergebnis.gestartet) {
      throw new Error(`Gutachten-Bot nicht gestartet (${ergebnis.grund || "unbekannt"}).`);
    }

    const stand = ergebnis.stand || "unbekannt";
    const manuell = quelle.luecken || [];
    const uebersprungen = Array.isArray(ergebnis.offen) ? ergebnis.offen : [];
    const gespeichert = Array.isArray(ergebnis.gespeichert) ? ergebnis.gespeichert : [];
    let message;
    if (gespeichert.length || uebersprungen.length || manuell.length || stand === "pausiert" || stand === "teilweise") {
      message = gespeichert.length
        ? `Akte ${nummer}: gespeichert: ${gespeichert.join(", ")}.`
        : `Akte ${nummer}: nichts gespeichert.`;
      if (manuell.length) message += ` Manuell nachtragen: ${manuell.join(", ")}.`;
      if (uebersprungen.length) message += ` Nicht geschafft: ${uebersprungen.join(", ")}.`;
    } else if (stand === "wartet_auf_eingabe") {
      const wo = ergebnis.schritt ? ` bei ${ergebnis.schritt}` : "";
      message = `Akte ${nummer}: Eingabe wartet${wo}: ${ergebnis.detail || "Pflichtfeld/UX"}`;
    } else if (stand === "fehler") {
      const wo = ergebnis.schritt ? `Schritt ${ergebnis.schritt}` : "Eingabe";
      message = `Akte ${nummer}: ${wo} fehlgeschlagen – ${ergebnis.detail || "technischer Fehler"}`;
      console.error(`❌ KI Gutachten (${nummer}): ${message}`);
    } else {
      message = `Akte ${nummer}: Gutachten-Bot (${stand}).`;
    }

    return {
      akte: nummer,
      driveFolderId: folderId,
      dossierUrl: page.url(),
      stand,
      message,
    };
  } finally {
    closeState(db);
  }
}
