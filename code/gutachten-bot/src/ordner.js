export function leseOrdnerNamen(name) {
  const text = String(name || "").trim();
  const nummer = (text.match(/\b(\d{1,5}\/\d{2})\b/) || [])[1] || "";
  const kuerzel = (text.match(/\(([A-Za-z]{1,4})\)\s*$/) || [])[1] || "";
  return { nummer, kuerzel: kuerzel.toUpperCase() };
}
