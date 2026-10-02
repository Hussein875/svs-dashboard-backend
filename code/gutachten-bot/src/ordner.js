export function leseOrdnerNamen(name) {
  const text = String(name || "").trim();
  const nummer = (text.match(/\b(\d{1,5}\/\d{2})\b/) || [])[1] || "";
  const kuerzel = (text.match(/\(([A-Za-z]{1,4})\)\s*$/) || [])[1] || "";
  return { nummer, kuerzel: kuerzel.toUpperCase() };
}

function nurZiffern(wert) {
  return String(wert || "").replace(/[^0-9]/g, "");
}

export function aktenzeichenPasst(sheetAkte, ordnerNummer) {
  const sheet = String(sheetAkte || "").trim();
  const ordner = String(ordnerNummer || "").trim();
  if (!ordner) return true;
  if (!sheet) return false;
  if (sheet === ordner) return true;
  if (nurZiffern(sheet) === nurZiffern(ordner)) return true;
  const teile = ordner.match(/^(\d{1,5})\/(\d{2})$/);
  if (!teile) return false;
  if (sheet === teile[1]) return true;
  if (nurZiffern(sheet) === `${teile[1]}${teile[2]}`) return true;
  return false;
}

export function loeseVorgangsNummer(sheetAkte, ordnerNummer) {
  const ordner = String(ordnerNummer || "").trim();
  if (ordner && aktenzeichenPasst(sheetAkte, ordner)) return ordner;
  return String(sheetAkte || "").trim();
}
