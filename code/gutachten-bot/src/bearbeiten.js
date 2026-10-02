import path from "node:path";
import { fileURLToPath } from "node:url";
import { createUltraExpertAdapter } from "./adapter-ultraexpert.js";
import { eingeben } from "./phase2.js";
import { openState } from "./state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function bearbeiteAkte(db, adapter, nummer, options = {}) {
  const ziel = String(nummer || "").trim();
  if (!ziel) return { gestartet: false, grund: "nummer" };
  if (!options.hatAnmeldung) return { gestartet: false, grund: "anmeldung" };
  return eingeben(db, adapter, {
    fortsetzen: true,
    nummer: ziel,
    owner: options.owner,
    log: options.log,
    maxVersuche: options.maxVersuche,
    sleep: options.sleep,
  });
}

async function main() {
  const nummer = process.argv[2];
  const hatAnmeldung = Boolean(process.env.UX_USERNAME && process.env.UX_PASSWORD);
  const dbPath = process.env.GUTACHTEN_DB || path.join(__dirname, "../data/gutachten.sqlite");
  const db = openState(dbPath);
  const ergebnis = await bearbeiteAkte(db, createUltraExpertAdapter(), nummer, {
    hatAnmeldung,
    log: (zeile) => {
      process.stdout.write(`${zeile}\n`);
    },
  });
  const stand = ergebnis.stand || ergebnis.grund || "nicht gestartet";
  process.stdout.write(`${ergebnis.nummer || nummer || ""} ${stand}\n`);
  process.exitCode = ergebnis.gestartet && ergebnis.stand !== "fehler" ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
