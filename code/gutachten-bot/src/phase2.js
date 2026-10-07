import { akteGesperrt } from "./eingabe-plan.js";
import { FachlichError, istTechnisch } from "./fehler.js";
import { schreibeLog } from "./log.js";
import { pruefePflichtfelder } from "./pflichtfelder.js";
import { holeEingabeAuftrag, setzeQueueStatus } from "./pipeline.js";
import { getVorgang, setWartetAufEingabe, withVorgang } from "./state.js";
import { schritteDerPhase } from "./schritte.js";

const EINGABE = schritteDerPhase("eingabe").map((schritt) => schritt.id);

function warte(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mitWiederholung(fn, { maxVersuche, sleep }) {
  let letzter = null;
  for (let versuch = 1; versuch <= maxVersuche; versuch += 1) {
    try {
      return await fn();
    } catch (error) {
      if (error?.code === "FACHLICH" || !istTechnisch(error)) throw error;
      letzter = error;
      if (versuch === maxVersuche) throw error;
      await sleep(200 * (2 ** (versuch - 1)));
    }
  }
  throw letzter;
}

export async function eingeben(db, adapter, options = {}) {
  const auftrag = holeEingabeAuftrag(db, {
    fortsetzen: options.fortsetzen === true,
    nummer: options.nummer || "",
  });
  if (!auftrag) return { gestartet: false };

  const log = (ereignis) => schreibeLog(options.log, { nummer: auftrag.nummer, ...ereignis });
  if (akteGesperrt(auftrag.nummer)) {
    setzeQueueStatus(db, auftrag.id, "uebersprungen");
    log({ schritt: "eingabe", status: "fehler" });
    return { gestartet: false, nummer: auftrag.nummer, stand: "uebersprungen" };
  }

  const maxVersuche = options.maxVersuche ?? 3;
  const sleep = options.sleep || warte;
  const owner = options.owner || `phase2-${process.pid}`;
  let letzterSchritt = "";

  try {
    const innen = await withVorgang(db, auftrag.nummer, owner, async (akte) => {
      const pruefung = pruefePflichtfelder(auftrag.datensatz);
      if (!pruefung.vollstaendig && options.nacheinander !== true) {
        throw new FachlichError("Pflichtfelder unvollständig");
      }

      if (adapter.vorbereiten) await adapter.vorbereiten(auftrag.nummer);
      const offen = [];
      const gespeichert = [];
      for (const schrittId of EINGABE) {
        letzterSchritt = schrittId;
        log({ schritt: schrittId, status: "laeuft" });
        try {
          let lauf = null;
          await akte.runSchritt(schrittId, async () => {
            const methode = adapter[schrittId];
            if (typeof methode !== "function") {
              throw new FachlichError("Schritt fehlt");
            }
            lauf = await mitWiederholung(() => methode(auftrag.datensatz), { maxVersuche, sleep });
          });
          if (lauf?.gespeichert) gespeichert.push(schrittId);
          if (Array.isArray(lauf?.hinweis) && lauf.hinweis.length) {
            offen.push(`${schrittId} (${lauf.hinweis.join("; ")})`);
          }
        } catch (error) {
          if (options.nacheinander === true && error?.code !== "BOT_STOPPED") {
            const grund = String(error?.message || schrittId).trim();
            offen.push(grund && grund !== schrittId ? `${schrittId} (${grund})` : schrittId);
            log({ schritt: schrittId, status: "offen" });
            continue;
          }
          log({ schritt: schrittId, status: error?.code === "FACHLICH" ? "wartet" : "fehler" });
          throw error;
        }
        log({ schritt: schrittId, status: "erledigt" });
      }
      if (options.nacheinander === true && offen.length > 0) {
        setzeQueueStatus(db, auftrag.id, "pausiert");
        return { gestartet: true, nummer: auftrag.nummer, stand: "teilweise", offen, gespeichert };
      }
      return { gespeichert };
    });

    if (innen?.stand === "teilweise") return innen;
    const gespeichert = innen?.gespeichert || [];

    setzeQueueStatus(db, auftrag.id, "erledigt");
    log({ schritt: "eingabe", status: "erledigt" });
    return {
      gestartet: true,
      nummer: auftrag.nummer,
      stand: getVorgang(db, auftrag.nummer).stand,
      gespeichert,
    };
  } catch (error) {
    if (error?.code === "NICHT_UMGESETZT") {
      setzeQueueStatus(db, auftrag.id, "pausiert");
      return { gestartet: true, nummer: auftrag.nummer, stand: "pausiert" };
    }
    if (error?.code === "FACHLICH") {
      setWartetAufEingabe(db, auftrag.nummer);
      setzeQueueStatus(db, auftrag.id, "wartet");
      return {
        gestartet: true,
        nummer: auftrag.nummer,
        stand: "wartet_auf_eingabe",
        schritt: letzterSchritt,
        detail: error.message,
      };
    }
    setzeQueueStatus(db, auftrag.id, istTechnisch(error) ? "fehler" : "in_arbeit");
    log({ schritt: "eingabe", status: "fehler" });
    return {
      gestartet: true,
      nummer: auftrag.nummer,
      stand: "fehler",
      schritt: letzterSchritt,
      detail: error?.message || String(error),
    };
  } finally {
    if (adapter.abschliessen) {
      await adapter.abschliessen().catch(() => {});
    }
  }
}

export { EINGABE };
