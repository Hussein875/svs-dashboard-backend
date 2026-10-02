import trigger from "../regeln/schaden-trigger.json" with { type: "json" };

const NACH_KUERZEL = new Map(
  trigger.filter((eintrag) => eintrag.kuerzel).map((eintrag) => [eintrag.kuerzel, eintrag.text]),
);

export function textFuerTrigger(kuerzel) {
  const schluessel = String(kuerzel || "").trim().replace(/^</, "");
  return NACH_KUERZEL.get(schluessel) || "";
}

export function schadenbausteine() {
  return trigger.map((eintrag) => ({ ...eintrag }));
}
