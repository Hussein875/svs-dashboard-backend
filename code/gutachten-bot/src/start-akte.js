import { aktenzeichenPasst, leseOrdnerNamen, loeseVorgangsNummer } from "./ordner.js";
import { eingeben } from "./phase2.js";
import { analysiere, stelleEingabeBereit } from "./pipeline.js";

export async function starteAkte(db, auftrag, adapter, options = {}) {
  const sheetAkte = String(auftrag?.nummer || "").trim();
  const ordner = leseOrdnerNamen(auftrag?.ordnerName || "");
  const immerWeiter = options.trotzLuecken === true;
  if (!sheetAkte) return { gestartet: false, grund: "nummer" };
  if (!aktenzeichenPasst(sheetAkte, ordner.nummer) && !immerWeiter) {
    return { gestartet: false, nummer: sheetAkte, grund: "ordner" };
  }
  const nummer = ordner.nummer
    ? loeseVorgangsNummer(sheetAkte, ordner.nummer)
    : sheetAkte;

  const kuerzel = String(auftrag?.kuerzel || ordner.kuerzel || "").trim().toUpperCase();

  const analyse = await analysiere(db, {
    nummer,
    owner: options.owner,
    trotzLuecken: options.trotzLuecken === true,
    dokumente: async () => ({ ...(await auftrag.dokumente()), kuerzel }),
    fotos: auftrag.fotos,
  });
  if (!analyse.angenommen) {
    if (!immerWeiter) {
      return {
        gestartet: false,
        nummer,
        grund: "pflichtfelder",
        fehlend: analyse.fehlend,
      };
    }
    const dokumente = { ...(await auftrag.dokumente()), kuerzel };
    const fotos = await auftrag.fotos();
    stelleEingabeBereit(db, nummer, {
      ...dokumente,
      ...fotos,
      schadenfotos: fotos.schadenfotos ?? dokumente.schadenfotos,
    }, analyse.bericht || "");
  }

  const eingabe = await eingeben(db, adapter, { ...options, nummer, fortsetzen: true });
  return { ...eingabe, fehlend: analyse.fehlend || [] };
}
