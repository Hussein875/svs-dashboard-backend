import { sachverstaendigerName } from "./eingabe-plan.js";
import { leseOrdnerNamen } from "./ordner.js";
import { eingeben } from "./phase2.js";
import { analysiere } from "./pipeline.js";

export async function starteAkte(db, auftrag, adapter, options = {}) {
  const nummer = String(auftrag?.nummer || "").trim();
  const ordner = leseOrdnerNamen(auftrag?.ordnerName || "");
  if (!nummer) return { gestartet: false, grund: "nummer" };
  if (ordner.nummer && ordner.nummer !== nummer) {
    return { gestartet: false, nummer, grund: "ordner" };
  }

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
