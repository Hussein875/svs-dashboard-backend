import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createUltraExpertAdapter } from "./adapter-ultraexpert.js";
import { baueDatensatz, teileAnalyseQuellen } from "./datensatz-bauen.js";
import { leseExtraktionen } from "./drive-ordner.js";
import { createPlaywrightSeite } from "./ultraexpert-seite.js";
import { starteAkte } from "./start-akte.js";
import { closeState, openState } from "./state.js";

export function mapKiUmgebung() {
  if (!process.env.UX_USERNAME && process.env.UX_CUSTOMER_NR) {
    process.env.UX_USERNAME = process.env.UX_CUSTOMER_NR;
  }
  if (!process.env.GUTACHTEN_DRIVE_CREDENTIALS && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    process.env.GUTACHTEN_DRIVE_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }
}

export async function runKiGutachten({
  akte,
  driveFolderId,
  page,
  onStep,
  control,
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

  onStep?.("Drive-Ordner lesen");
  const { meta, bd, ae, schein, vorgangsNummer } = await leseExtraktionen({ folderId, nummer });
  const kuerzel = meta.kuerzel || bd?.kuerzel || ae?.kuerzel || "";
  const datensatz = baueDatensatz({ ae, bd, schein, kuerzel });
  const { dokumente, fotos } = teileAnalyseQuellen(datensatz);

  const dbDir = mkdtempSync(path.join(tmpdir(), "gutachten-ki-"));
  const dbPath = path.join(dbDir, "state.sqlite");
  const db = openState(dbPath);

  const log = (zeile) => {
    if (typeof zeile === "string") onStep?.(zeile);
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
    });

    if (!ergebnis.gestartet) {
      if (ergebnis.grund === "pflichtfelder") {
        throw new Error(
          `Pflichtfelder unvollständig (${(ergebnis.fehlend || []).join(", ") || "unbekannt"}).`,
        );
      }
      throw new Error(`Gutachten-Bot nicht gestartet (${ergebnis.grund || "unbekannt"}).`);
    }

    const stand = ergebnis.stand || "unbekannt";
    let message;
    if (stand === "pausiert") {
      message = `Akte ${nummer}: Besichtigung, Beteiligte und Fahrzeug eingetragen (Stopp vor Bereifung).`;
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
    rmSync(dbDir, { recursive: true, force: true });
  }
}
