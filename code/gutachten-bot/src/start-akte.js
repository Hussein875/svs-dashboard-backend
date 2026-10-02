import { sachverstaendigerName } from "./eingabe-plan.js";
import { aktenzeichenPasst, leseOrdnerNamen, loeseVorgangsNummer } from "./ordner.js";
import { eingeben } from "./phase2.js";
import { analysiere } from "./pipeline.js";

export async function starteAkte(db, auftrag, adapter, options = {}) {
  const sheetAkte = String(auftrag?.nummer || "").trim();
  const ordner = leseOrdnerNamen(auftrag?.ordnerName || "");
  if (!sheetAkte) return { gestartet: false, grund: "nummer" };
  if (!aktenzeichenPasst(sheetAkte, ordner.nummer)) {
    return { gestartet: false, nummer: sheetAkte, grund: "ordner" };
  }
  const nummer = loeseVorgangsNummer(sheetAkte, ordner.nummer);

  const kuerzel = String(auftrag?.kuerzel || ordner.kuerzel || "").trim().toUpperCase();
  if (!sachverstaendigerName(kuerzel)) {
    return { gestartet: false, nummer, grund: "sachverstaendiger", kuerzel };
  }

  const analyse = await analysiere(db, {
    nummer,
    owner: options.owner,
    dokumente: async () => ({ ...(await auftrag.dokumente()), kuerzel }),
    fotos: auftrag.fotos,
  });
  if (!analyse.angenommen) {
    return {
      gestartet: false,
      nummer,
      grund: "pflichtfelder",
      fehlend: analyse.fehlend.map((feld) => feld.id),
    };
  }

  return eingeben(db, adapter, { ...options, nummer, fortsetzen: true });
}
