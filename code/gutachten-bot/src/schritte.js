export const SCHRITTE = [
  { id: "dokumente-lesen", phase: "analyse", stand: "eingelesen" },
  { id: "fotos-auswerten", phase: "analyse", stand: "eingelesen" },
  { id: "pflichtfelder-pruefen", phase: "analyse", stand: "geprueft" },
  { id: "report-schreiben", phase: "analyse", stand: null },
  { id: "auftrag", phase: "eingabe", stand: "eingetippt" },
  { id: "beteiligte", phase: "eingabe", stand: "eingetippt" },
  { id: "besichtigung", phase: "eingabe", stand: "eingetippt" },
  { id: "fahrzeug", phase: "eingabe", stand: "eingetippt" },
  { id: "bereifung", phase: "eingabe", stand: "eingetippt" },
  { id: "vor-ort", phase: "eingabe", stand: "eingetippt" },
  { id: "vorschaeden", phase: "eingabe", stand: "eingetippt" },
  { id: "schadenfeststellung", phase: "eingabe", stand: "eingetippt" },
  { id: "dokumente-import", phase: "eingabe", stand: "eingetippt" },
  { id: "lichtbilder", phase: "eingabe", stand: "eingetippt" },
  { id: "abschluss", phase: "abschluss", stand: "abgeschlossen" },
];

const BY_ID = new Map(SCHRITTE.map((schritt) => [schritt.id, schritt]));

export function schrittById(id) {
  const schritt = BY_ID.get(id);
  if (!schritt) {
    throw new Error(`Unbekannter Schritt: ${id}`);
  }
  return schritt;
}

export function schritteDerPhase(phase) {
  return SCHRITTE.filter((schritt) => schritt.phase === phase);
}
