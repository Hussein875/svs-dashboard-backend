import { pruefePflichtfelder } from "./pflichtfelder.js";

const UX_SCHRITTE = [
  { id: "auftrag", label: "Auftrag" },
  { id: "beteiligte", label: "Beteiligte" },
  { id: "besichtigung", label: "Besichtigung" },
  { id: "fahrzeug", label: "Fahrzeug" },
  { id: "bereifung", label: "Bereifung" },
  { id: "vor-ort", label: "Vor Ort" },
  { id: "vorschaeden", label: "Vorschäden" },
  { id: "schadenfeststellung", label: "Schadenfeststellung" },
  { id: "dokumente-import", label: "Dokumente import" },
  { id: "lichtbilder", label: "Lichtbilder" },
];

function zeige(wert) {
  if (wert == null) return "";
  return String(wert).replace(/\s+/g, " ").trim();
}

function statusAus(eintrag, textVorhanden) {
  if (!eintrag) return textVorhanden ? "ok" : "fehlt";
  if (eintrag.lesbar === false) return "unleserlich";
  if (eintrag.vorhanden === false) return "fehlt";
  return textVorhanden ? "ok" : "fehlt";
}

function zeile(id, label, wert, status) {
  return {
    id,
    label,
    wert: wert || "",
    status: status === "ok" ? "ok" : status === "unleserlich" ? "unleserlich" : "fehlt",
  };
}

/** Felder für Dashboard-Checkliste (Lesung aus Drive). */
export function lesungCheckliste(datensatz) {
  const d = datensatz || {};
  const fehlend = new Map(
    pruefePflichtfelder(d).fehlend.map((feld) => [feld.id, feld.grund]),
  );
  const grund = (id) => fehlend.get(id) || null;

  const rows = [];

  const knz = d.kennzeichen;
  rows.push(zeile(
    "kennzeichen",
    "Kennzeichen",
    zeige(knz?.wert),
    grund("kennzeichen") || statusAus(knz, zeige(knz?.wert)),
  ));

  const ag = d.auftraggeber || {};
  rows.push(zeile(
    "auftraggeber-anrede",
    "Anrede",
    zeige(ag.anrede),
    grund("auftraggeber-anrede") || (ag.lesbar === false ? "unleserlich" : zeige(ag.anrede) ? "ok" : "fehlt"),
  ));
  rows.push(zeile(
    "auftraggeber-name",
    "Auftraggeber Name",
    zeige(ag.name),
    grund("auftraggeber-name") || statusAus(ag, zeige(ag.name)),
  ));
  rows.push(zeile(
    "auftraggeber-strasse",
    "Straße",
    zeige(ag.strasse),
    grund("auftraggeber-strasse") || (ag.lesbar === false ? "unleserlich" : zeige(ag.strasse) ? "ok" : "fehlt"),
  ));
  rows.push(zeile(
    "auftraggeber-plz",
    "PLZ",
    zeige(ag.plz),
    grund("auftraggeber-plz") || (ag.lesbar === false ? "unleserlich" : zeige(ag.plz) ? "ok" : "fehlt"),
  ));
  rows.push(zeile(
    "auftraggeber-ort",
    "Ort",
    zeige(ag.ort),
    grund("auftraggeber-ort") || (ag.lesbar === false ? "unleserlich" : zeige(ag.ort) ? "ok" : "fehlt"),
  ));

  rows.push(zeile(
    "fin",
    "FIN",
    zeige(d.fin?.wert),
    d.fin?.lesbar === false ? "unleserlich" : zeige(d.fin?.wert) ? "ok" : "fehlt",
  ));
  rows.push(zeile(
    "kilometerstand",
    "Kilometerstand",
    zeige(d.kilometerstand?.wert),
    grund("kilometerstand") || statusAus(d.kilometerstand, zeige(d.kilometerstand?.wert)),
  ));
  rows.push(zeile(
    "erstzulassung",
    "Erstzulassung",
    zeige(d.erstzulassung?.wert),
    zeige(d.erstzulassung?.wert) ? "ok" : "fehlt",
  ));
  rows.push(zeile(
    "getriebe",
    "Getriebe",
    zeige(d.getriebe?.wert),
    zeige(d.getriebe?.wert) ? "ok" : "fehlt",
  ));
  rows.push(zeile(
    "schadentag",
    "Schadentag",
    zeige(d.schadentag?.wert),
    d.schadentag?.lesbar === false ? "unleserlich" : zeige(d.schadentag?.wert) ? "ok" : "fehlt",
  ));
  rows.push(zeile(
    "schadenort",
    "Schadenort",
    [zeige(d.schadenort?.wert), zeige(d.schadenstrasse?.wert)].filter(Boolean).join(", "),
    zeige(d.schadenort?.wert) || zeige(d.schadenstrasse?.wert) ? "ok" : "fehlt",
  ));
  rows.push(zeile(
    "unfallgegner-kennzeichen",
    "Gegner-Kennzeichen",
    zeige(d.unfallgegnerKennzeichen?.wert),
    zeige(d.unfallgegnerKennzeichen?.wert) ? "ok" : "fehlt",
  ));

  const reifen = d.bereifung || {};
  const bereifungText = [
    reifen.profiltiefe ? `${reifen.profiltiefe} mm` : "",
    reifen.hersteller,
    reifen.dimension,
    reifen.felgen,
  ].filter(Boolean).join(" · ");
  rows.push(zeile(
    "bereifung",
    "Bereifung",
    bereifungText,
    reifen.lesbar === true ? "ok" : bereifungText ? "ok" : "fehlt",
  ));

  rows.push(zeile(
    "fahrbereitschaft",
    "Fahrbereitschaft",
    zeige(d.fahrbereitschaft),
    zeige(d.fahrbereitschaft) ? "ok" : "fehlt",
  ));
  rows.push(zeile(
    "schilderung",
    "Schilderung",
    (() => {
      const t = zeige(d.schilderung);
      return t.length > 80 ? `${t.slice(0, 80)}…` : t;
    })(),
    zeige(d.schilderung) ? "ok" : "fehlt",
  ));

  if (d.vollmacht === true) {
    rows.push(zeile(
      "anwalt",
      "Anwalt",
      zeige(d.anwalt?.name),
      zeige(d.anwalt?.name) ? "ok" : "unleserlich",
    ));
  }

  const fotos = d.schadenfotos || {};
  for (const [key, id, titel] of [
    ["vorneLinks", "schadenfoto-vorne-links", "Foto vorne links"],
    ["vorneRechts", "schadenfoto-vorne-rechts", "Foto vorne rechts"],
    ["hintenRechts", "schadenfoto-hinten-rechts", "Foto hinten rechts"],
    ["hintenLinks", "schadenfoto-hinten-links", "Foto hinten links"],
  ]) {
    const f = fotos[key];
    const da = f === true || f?.vorhanden === true;
    rows.push(zeile(
      id,
      titel,
      da ? "vorhanden" : "",
      grund(id) || (f?.lesbar === false ? "unleserlich" : da ? "ok" : "fehlt"),
    ));
  }

  rows.push(zeile(
    "fahrzeugschein",
    "Fahrzeugschein",
    d.fahrzeugschein?.vorhanden ? "PDF/Foto" : "",
    grund("fahrzeugschein") || (d.fahrzeugschein?.vorhanden ? "ok" : "fehlt"),
  ));

  return rows;
}

export function uxSchrittCheckliste(schritte, laufendId) {
  const map = schritte || {};
  return UX_SCHRITTE.map(({ id, label }) => {
    let status = map[id] || "offen";
    if (id === laufendId) status = "laeuft";
    if (status === "erledigt") status = "ok";
    if (status === "fehler" || status === "wartet") status = "offen";
    return { id, label, status };
  });
}

const OVERRIDE_SETTER = {
  kennzeichen: (d, v) => {
    d.kennzeichen = { ...(d.kennzeichen || {}), wert: v, lesbar: true };
  },
  "auftraggeber-anrede": (d, v) => {
    d.auftraggeber = { ...(d.auftraggeber || {}), anrede: v, lesbar: true };
  },
  "auftraggeber-name": (d, v) => {
    d.auftraggeber = { ...(d.auftraggeber || {}), name: v, lesbar: true };
  },
  "auftraggeber-strasse": (d, v) => {
    d.auftraggeber = { ...(d.auftraggeber || {}), strasse: v, lesbar: true };
  },
  "auftraggeber-plz": (d, v) => {
    d.auftraggeber = { ...(d.auftraggeber || {}), plz: v, lesbar: true };
  },
  "auftraggeber-ort": (d, v) => {
    d.auftraggeber = { ...(d.auftraggeber || {}), ort: v, lesbar: true };
  },
  fin: (d, v) => {
    d.fin = { ...(d.fin || {}), wert: v, lesbar: true };
  },
  kilometerstand: (d, v) => {
    d.kilometerstand = { ...(d.kilometerstand || {}), wert: v, lesbar: true };
  },
  erstzulassung: (d, v) => {
    d.erstzulassung = { ...(d.erstzulassung || {}), wert: v, lesbar: true };
  },
  getriebe: (d, v) => {
    d.getriebe = { ...(d.getriebe || {}), wert: v, lesbar: true };
  },
  schadentag: (d, v) => {
    d.schadentag = { ...(d.schadentag || {}), wert: v, lesbar: true };
  },
  schadenort: (d, v) => {
    d.schadenort = { ...(d.schadenort || {}), wert: v, lesbar: true };
  },
  "unfallgegner-kennzeichen": (d, v) => {
    d.unfallgegnerKennzeichen = { ...(d.unfallgegnerKennzeichen || {}), wert: v, lesbar: true };
  },
  bereifung: (d, v) => {
    const teile = String(v).split("|").map((s) => s.trim());
    d.bereifung = {
      ...(d.bereifung || {}),
      profiltiefe: teile[0] || d.bereifung?.profiltiefe,
      hersteller: teile[1] || d.bereifung?.hersteller,
      dimension: teile[2] || d.bereifung?.dimension,
      felgen: teile[3] || d.bereifung?.felgen,
      lesbar: true,
    };
  },
  fahrbereitschaft: (d, v) => {
    d.fahrbereitschaft = v;
  },
  schilderung: (d, v) => {
    d.schilderung = v;
  },
  anwalt: (d, v) => {
    d.anwalt = { ...(d.anwalt || {}), name: v };
    d.vollmacht = true;
  },
};

export function applyLesungOverrides(datensatz, overrides) {
  const d = { ...(datensatz || {}) };
  const quelle = overrides && typeof overrides === "object" ? overrides : {};
  for (const [id, wert] of Object.entries(quelle)) {
    const text = zeige(wert);
    if (!text) continue;
    const setzen = OVERRIDE_SETTER[id];
    if (setzen) setzen(d, text);
  }
  return d;
}

export function mergeChecklistOverrides(checkliste, overrides) {
  const map = overrides && typeof overrides === "object" ? overrides : {};
  return (checkliste || []).map((zeile) => {
    if (!(zeile.id in map)) return zeile;
    const wert = zeige(map[zeile.id]);
    return { ...zeile, wert, status: wert ? "ok" : zeile.status };
  });
}

export function kiFortschrittPayload({
  message,
  phase,
  datensatz,
  uxSchritte,
  laufendSchritt,
  overrides,
}) {
  const basis = lesungCheckliste(datensatz || {});
  const lesungChecklisteOut = mergeChecklistOverrides(basis, overrides);
  const payload = {
    message: String(message || "").trim(),
    phase: phase || "lesen",
    lesungCheckliste: lesungChecklisteOut,
  };
  if (uxSchritte) {
    payload.uxCheckliste = uxSchrittCheckliste(uxSchritte, laufendSchritt);
  }
  return payload;
}
