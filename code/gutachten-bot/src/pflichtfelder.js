import pflichtfelder from "../regeln/pflichtfelder.json" with { type: "json" };

const FOTO_IDS = {
  vorneLinks: "schadenfoto-vorne-links",
  vorneRechts: "schadenfoto-vorne-rechts",
  hintenRechts: "schadenfoto-hinten-rechts",
  hintenLinks: "schadenfoto-hinten-links",
};

const AUFTRAGGEBER_IDS = {
  anrede: "auftraggeber-anrede",
  name: "auftraggeber-name",
  strasse: "auftraggeber-strasse",
  plz: "auftraggeber-plz",
  ort: "auftraggeber-ort",
};

export function pflichtfeldListe() {
  return pflichtfelder.felder.map((feld) => ({ ...feld }));
}

function labelFor(id) {
  return pflichtfelder.felder.find((feld) => feld.id === id)?.label || id;
}

function befund(id, grund) {
  return { id, label: labelFor(id), grund };
}

function textVorhanden(value) {
  return String(value ?? "").trim().length > 0;
}

function dokumentPruefen(id, eintrag) {
  if (!eintrag || eintrag.vorhanden !== true) {
    return befund(id, "fehlt");
  }
  if (eintrag.lesbar === false) {
    return befund(id, "unleserlich");
  }
  return null;
}

function wertPruefen(id, eintrag) {
  if (!eintrag || eintrag.lesbar === false) {
    return befund(id, eintrag ? "unleserlich" : "fehlt");
  }
  if (!textVorhanden(eintrag.wert)) {
    return befund(id, "fehlt");
  }
  return null;
}

function fotoPruefen(id, eintrag) {
  if (eintrag === true) return null;
  if (eintrag && typeof eintrag === "object") {
    if (eintrag.lesbar === false) return befund(id, "unleserlich");
    if (eintrag.vorhanden === true) return null;
  }
  return befund(id, "fehlt");
}

function auftraggeberPruefen(eintrag) {
  if (!eintrag || eintrag.lesbar === false) {
    const grund = eintrag ? "unleserlich" : "fehlt";
    return Object.values(AUFTRAGGEBER_IDS).map((id) => befund(id, grund));
  }
  return Object.entries(AUFTRAGGEBER_IDS).flatMap(([key, id]) => {
    if (key === "anrede") return [];
    if (!textVorhanden(eintrag[key])) return [befund(id, "fehlt")];
    return [];
  });
}

export function pruefePflichtfelder(datensatz) {
  const quelle = datensatz || {};
  const fehlend = [
    dokumentPruefen("fahrzeugschein", quelle.fahrzeugschein),
    wertPruefen("kennzeichen", quelle.kennzeichen),
    wertPruefen("kilometerstand", quelle.kilometerstand),
    ...Object.entries(FOTO_IDS).map(([key, id]) => fotoPruefen(id, quelle.schadenfotos?.[key])),
    dokumentPruefen("vorschaeden", {
      vorhanden: quelle.vorschaeden?.angegeben === true,
      lesbar: quelle.vorschaeden?.lesbar,
    }),
    ...auftraggeberPruefen(quelle.auftraggeber),
  ].filter(Boolean);

  return {
    vollstaendig: fehlend.length === 0,
    fehlend,
  };
}

export function berichtText(vorgang, ergebnis) {
  const nummer = String(vorgang || "").trim() || "ohne Nummer";
  const zeilen = [
    `Vorgang ${nummer}`,
    ergebnis.vollstaendig
      ? "Pflichtfelder vollständig."
      : "Pflichtfelder unvollständig. Eingabe startet nicht.",
    "",
  ];

  if (ergebnis.fehlend.length === 0) {
    zeilen.push("Nichts fehlt. Unleserliche Felder wurden nicht ergänzt.");
  } else {
    zeilen.push("Offen:");
    for (const feld of ergebnis.fehlend) {
      const grund = feld.grund === "unleserlich"
        ? "unleserlich, Feld bleibt leer"
        : "fehlt";
      zeilen.push(`- ${feld.label}: ${grund}`);
    }
  }

  return `${zeilen.join("\n")}\n`;
}
