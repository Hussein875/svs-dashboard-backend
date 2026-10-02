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

export function baueDatensatz({ ae, bd, kuerzel }) {
  const ausBd = datensatzAusBd(bd || {});
  const abtretung = ae || {};
  const rohBd = bd || {};

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
    fin: textFeld(rohBd.fin, rohBd.finLesbar),
    erstzulassung: textFeld(rohBd.erstzulassung, rohBd.erstzulassungLesbar),
    getriebe: textFeld(rohBd.getriebe, rohBd.getriebeLesbar),
    farbe: textFeld(rohBd.farbe, rohBd.farbeLesbar),
    fahrzeughalter: rohBd.fahrzeughalter,
    beschaedigungen: Array.isArray(rohBd.beschaedigungen) ? rohBd.beschaedigungen : [],
    schadenregionen: String(rohBd.schadenregionen || "").trim(),
    hu: ausBd.hu,
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
