import { datensatzAusBd } from "./bd-lesen.js";

function textFeld(wert, lesbar = true) {
  const inhalt = String(wert ?? "").trim();
  if (!inhalt || lesbar === false) return { wert: "", lesbar: false };
  return { wert: inhalt, lesbar: true };
}

function schadenfotosAusUebersichten(uebersichten) {
  const quelle = uebersichten || {};
  return {
    vorneLinks: Boolean(quelle.vorneLinks),
    vorneRechts: Boolean(quelle.vorneRechts),
    hintenRechts: Boolean(quelle.hintenRechts),
    hintenLinks: Boolean(quelle.hintenLinks),
  };
}

function feldAusQuellen(...quellen) {
  for (const quelle of quellen) {
    if (!quelle) continue;
    if (typeof quelle === "object" && quelle.lesbar !== false && String(quelle.wert ?? "").trim()) {
      return quelle;
    }
    const text = String(quelle).trim();
    if (text) return { wert: text, lesbar: true };
  }
  return { wert: "", lesbar: false };
}

export function baueDatensatz({ ae, bd, schein, kuerzel }) {
  const ausBd = datensatzAusBd(bd || {});
  const abtretung = ae || {};
  const rohBd = bd || {};
  const rohSchein = schein || {};

  const auftraggeber = abtretung.auftraggeber && typeof abtretung.auftraggeber === "object"
    ? abtretung.auftraggeber
    : { lesbar: false };

  const kennzeichen = abtretung.kennzeichen && typeof abtretung.kennzeichen === "object"
    ? abtretung.kennzeichen
    : textFeld("", false);

  const schadenfotos = schadenfotosAusUebersichten(rohBd.uebersichten);

  return {
    ...ausBd,
    kuerzel: String(kuerzel || ausBd.kuerzel || rohBd.kuerzel || "").trim().toUpperCase(),
    fahrzeugschein: {
      vorhanden: Boolean(rohBd.fahrzeugscheinVorhanden ?? true),
      lesbar: rohBd.fahrzeugscheinLesbar !== false,
    },
    kennzeichen,
    kilometerstand: ausBd.kilometerstand?.lesbar
      ? ausBd.kilometerstand
      : textFeld(rohBd.kilometerstand, rohBd.kilometerstandLesbar),
    schadenfotos,
    vorschaeden: ausBd.vorschaeden,
    auftraggeber,
    anwalt: abtretung.anwalt,
    versicherung: abtretung.versicherung,
    vollmacht: abtretung.vollmacht === true,
    fin: feldAusQuellen(rohSchein.fin, textFeld(rohBd.fin, rohBd.finLesbar)),
    erstzulassung: feldAusQuellen(
      rohSchein.erstzulassung,
      textFeld(rohBd.erstzulassung, rohBd.erstzulassungLesbar),
    ),
    getriebe: feldAusQuellen(
      rohSchein.getriebe,
      textFeld(rohBd.getriebe, rohBd.getriebeLesbar),
    ),
    farbe: textFeld(rohBd.farbe, rohBd.farbeLesbar),
    fahrzeughalter: rohBd.fahrzeughalter || (rohSchein.halter
      ? { ...rohSchein.halter, lesbar: true }
      : undefined),
    hu: feldAusQuellen(rohSchein.huPlakette, ausBd.hu),
    beschaedigungen: Array.isArray(rohBd.beschaedigungen) ? rohBd.beschaedigungen : [],
    schadenregionen: String(rohBd.schadenregionen || "").trim(),
    schilderung: ausBd.schilderung,
    fahrbereitschaft: ausBd.fahrbereitschaft,
    airbagAusgeloest: ausBd.airbagAusgeloest,
    scheckheft: ausBd.scheckheft,
    polizei: ausBd.polizei,
    bereifung: ausBd.bereifung,
  };
}

export function teileAnalyseQuellen(datensatz) {
  const quelle = datensatz || {};
  const dokumente = {
    fahrzeugschein: quelle.fahrzeugschein,
    kennzeichen: quelle.kennzeichen,
    vorschaeden: quelle.vorschaeden,
    auftraggeber: quelle.auftraggeber,
    anwalt: quelle.anwalt,
    versicherung: quelle.versicherung,
    vollmacht: quelle.vollmacht,
    fin: quelle.fin,
    erstzulassung: quelle.erstzulassung,
    getriebe: quelle.getriebe,
    farbe: quelle.farbe,
    fahrzeughalter: quelle.fahrzeughalter,
    beschaedigungen: quelle.beschaedigungen,
    schadenregionen: quelle.schadenregionen,
    kuerzel: quelle.kuerzel,
    schilderung: quelle.schilderung,
    fahrbereitschaft: quelle.fahrbereitschaft,
    airbagAusgeloest: quelle.airbagAusgeloest,
    scheckheft: quelle.scheckheft,
    polizei: quelle.polizei,
    bereifung: quelle.bereifung,
    hu: quelle.hu,
  };
  const fotos = {
    kilometerstand: quelle.kilometerstand,
    schadenfotos: quelle.schadenfotos,
  };
  return { dokumente, fotos };
}
