const NAMEN = {
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
};

function kuerzeDetail(teil) {
  let text = String(teil || "").split("Call log")[0].split("\n")[0].trim();
  if (!text) return "";
  text = text.replace(/^Feld nicht klickbar:\s*/i, "");
  if (/^bereifung$/i.test(text)) return "";
  if (/timeout|locator\.|waiting for/i.test(text)) return "Klick nicht möglich";
  if (text.length > 48) return `${text.slice(0, 48)}…`;
  return text;
}

function splitDetails(inhalt) {
  const teile = String(inhalt || "")
    .split(";")
    .map((teil) => kuerzeDetail(teil))
    .filter(Boolean);
  return [...new Set(teile)];
}

function parseEintrag(eintrag) {
  const roh = String(eintrag || "").split("Call log")[0].replace(/\s+/g, " ").trim();
  if (!roh) return null;

  const klammer = roh.indexOf("(");
  if (klammer > 0) {
    const key = roh.slice(0, klammer).trim();
    const inner = roh.slice(klammer + 1).replace(/\)\s*$/, "");
    if (NAMEN[key] || key.includes("-")) {
      return {
        key,
        label: NAMEN[key] || key,
        details: splitDetails(inner),
      };
    }
  }

  const mitLabel = roh.match(/^(.+?)\s*\((.+)\)$/);
  if (mitLabel) {
    const label = mitLabel[1].trim();
    const key = label.toLowerCase();
    return { key, label, details: splitDetails(mitLabel[2]) };
  }

  const key = NAMEN[roh] ? roh : roh.toLowerCase();
  return { key, label: NAMEN[roh] || roh, details: [] };
}

function mergeOffen(eintraege) {
  const map = new Map();
  for (const eintrag of eintraege) {
    const parsed = parseEintrag(eintrag);
    if (!parsed) continue;
    const vorhanden = map.get(parsed.key) || { label: parsed.label, details: new Set() };
    for (const detail of parsed.details) vorhanden.details.add(detail);
    map.set(parsed.key, vorhanden);
  }
  return [...map.values()].map((gruppe) => ({
    label: gruppe.label,
    details: [...gruppe.details],
  }));
}

export function abschlussMeldung(nummer, { gespeichert = [], manuell = [], uebersprungen = [] } = {}) {
  const zeilen = [`Akte ${nummer}`];
  const gespeichertNamen = gespeichert.map((id) => NAMEN[id] || id);
  zeilen.push(
    gespeichertNamen.length
      ? `Gespeichert: ${gespeichertNamen.join(", ")}`
      : "Gespeichert: —",
  );

  const offen = mergeOffen([...manuell, ...uebersprungen]);
  if (!offen.length) {
    zeilen.push("Alles erledigt.");
    return zeilen.join("\n");
  }

  zeilen.push("Offen:");
  for (const { label, details } of offen) {
    zeilen.push(details.length ? `• ${label}: ${details.join(", ")}` : `• ${label}`);
  }
  return zeilen.join("\n");
}
