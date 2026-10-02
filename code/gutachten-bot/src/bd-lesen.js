function text(wert, lesbar) {
  const inhalt = String(wert || "").trim();
  if (lesbar === false || !inhalt) return { wert: "", lesbar: false };
  return { wert: inhalt, lesbar: true };
}

export function datensatzAusBd(lesung) {
  const quelle = lesung || {};
  const reifen = quelle.bereifung || {};
  const profil = String(reifen.profiltiefe || "").trim();
  const hersteller = String(reifen.hersteller || "").trim();
  const dimension = String(reifen.dimension || "").trim();
  const felgen = reifen.felgen === "Stahl" || reifen.felgen === "Aluminium" ? reifen.felgen : "";
  const reifenVollstaendig = Boolean(
    profil && hersteller && dimension && felgen
    && reifen.herstellerLesbar !== false
    && reifen.dimensionLesbar !== false,
  );

  const hergang = Array.isArray(quelle.hergang) ? quelle.hergang : [];
  const nurGeparkt = hergang.length === 1 && hergang[0] === "geparkt";

  return {
    kuerzel: String(quelle.kuerzel || "").trim().toUpperCase(),
    kilometerstand: text(quelle.kilometerstand, quelle.kilometerstandLesbar),
    hu: text(quelle.hu, quelle.huLesbar),
    fahrbereitschaft: String(quelle.fahrbereitschaft || "").trim().toLowerCase(),
    airbagAusgeloest: quelle.airbagAusgeloest === true,
    scheckheft: quelle.scheckheft === true,
    polizei: { angegeben: quelle.polizei === true },
    schilderung: nurGeparkt
      ? { wert: "Parkplatzunfall", lesbar: true }
      : { wert: "", lesbar: false },
    bereifung: reifenVollstaendig
      ? { profiltiefe: profil, hersteller, dimension, felgen, lesbar: true }
      : { lesbar: false },
    vorschaeden: {
      angegeben: quelle.vorschaedenAngegeben === true,
      lesbar: quelle.vorschaedenLesbar !== false,
      imSchadenbereich: Array.isArray(quelle.vorschadenImBereich) ? quelle.vorschadenImBereich : [],
      ausserhalb: Array.isArray(quelle.vorschadenAusserhalb) ? quelle.vorschadenAusserhalb : [],
      repariert: [],
    },
  };
}
