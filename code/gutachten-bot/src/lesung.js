import { datensatzAusBd } from "./bd-lesen.js";

function textFeld(wert, lesbar = true) {
  const inhalt = String(wert ?? "").trim();
  if (!inhalt || lesbar === false) return { wert: "", lesbar: false };
  return { wert: inhalt, lesbar: true };
}

function feldAusQuellen(...quellen) {
  for (const quelle of quellen) {
    if (!quelle) continue;
    if (typeof quelle === "object" && quelle.lesbar !== false && String(quelle.wert ?? "").trim()) {
      return { wert: String(quelle.wert).trim(), lesbar: true };
    }
    const text = String(quelle).trim();
    if (text && typeof quelle !== "object") return { wert: text, lesbar: true };
  }
  return { wert: "", lesbar: false };
}

function norm(wert) {
  return String(wert || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function huText(wert) {
  const text = String(wert || "").trim();
  const monatJahr = text.match(/^(\d{1,2})\s*[./]\s*(\d{4})$/);
  if (!monatJahr) return text;
  return `${monatJahr[1].padStart(2, "0")}.${monatJahr[2]}`;
}

function personVollstaendig(person) {
  if (!person || person.lesbar === false) return false;
  return ["name", "strasse", "plz", "ort"].every((feld) => String(person[feld] || "").trim());
}

function namenGleich(links, rechts) {
  const normiere = (wert) => String(wert || "").trim().toLowerCase().replace(/\s+/g, " ");
  return normiere(links) === normiere(rechts) && normiere(links) !== "";
}

function kennzeichenAus(ae, schein, bilder) {
  const abtretung = ae?.kennzeichen?.lesbar === false ? "" : String(ae?.kennzeichen?.wert || "").trim();
  const vomSchein = String(schein?.kennzeichenSchein || schein?.kennzeichen?.wert || "").trim();
  const vomBild = String(bilder?.kennzeichen || "").trim();
  if (vomSchein && vomBild && norm(vomSchein) === norm(vomBild)) {
    return {
      wert: vomSchein,
      lesbar: true,
      schreibfehlerAbtretung: abtretung && norm(abtretung) !== norm(vomSchein) ? abtretung : "",
    };
  }
  if (abtretung) return { wert: abtretung, lesbar: true };
  if (vomSchein) return { wert: vomSchein, lesbar: true };
  return { wert: "", lesbar: false };
}

export function werteLesung({ bd, ae, schein, ordnerName, bilder, kuerzel: kuerzelVorgabe } = {}) {
  const ausBd = datensatzAusBd(bd || {});
  const abtretung = ae || {};
  let auftraggeber = abtretung.auftraggeber && typeof abtretung.auftraggeber === "object"
    ? abtretung.auftraggeber
    : { lesbar: false };
  const halter = schein?.halter && typeof schein.halter === "object" ? schein.halter : null;
  const vomSchein = !personVollstaendig(auftraggeber) && personVollstaendig(halter);
  if (vomSchein) {
    auftraggeber = {
      anrede: halter.anrede === "Frau" ? "Frau" : "Herr",
      name: String(halter.name).trim(),
      strasse: String(halter.strasse).trim(),
      plz: String(halter.plz).trim(),
      ort: String(halter.ort).trim(),
      lesbar: true,
    };
  }
  const gleicherHalter = halter && namenGleich(halter.name, auftraggeber.name);
  const vollmacht = abtretung.vollmacht === true;
  const kuerzel = String(kuerzelVorgabe || ausBd.kuerzel || bd?.kuerzel || "").trim().toUpperCase()
    || String(ordnerName || "").match(/\(([A-Za-z]{1,4})\)\s*$/)?.[1]?.toUpperCase()
    || "";

  const datensatz = {
    ...ausBd,
    kuerzel,
    fahrzeugschein: {
      vorhanden: Boolean(schein?.fin?.wert || schein?.fin || bd?.fahrzeugscheinVorhanden),
      lesbar: schein?.fin?.lesbar !== false && bd?.fahrzeugscheinLesbar !== false,
    },
    kennzeichen: kennzeichenAus(abtretung, schein, bilder),
    schadenfotos: {
      vorneLinks: Boolean(bd?.uebersichten?.vorneLinks),
      vorneRechts: Boolean(bd?.uebersichten?.vorneRechts),
      hintenRechts: Boolean(bd?.uebersichten?.hintenRechts),
      hintenLinks: Boolean(bd?.uebersichten?.hintenLinks),
    },
    auftraggeber,
    versicherung: abtretung.versicherung,
    unfallgegnerKennzeichen: abtretung.unfallgegnerKennzeichen,
    schadentag: abtretung.schadentag,
    schadennummer: abtretung.schadennummer,
    versicherungsnummer: abtretung.versicherungsnummer,
    schadenort: abtretung.schadenort,
    schadenstrasse: abtretung.schadenstrasse,
    vollmacht,
    fin: feldAusQuellen(schein?.fin, textFeld(bd?.fin, bd?.finLesbar)),
    erstzulassung: feldAusQuellen(schein?.erstzulassung, textFeld(bd?.erstzulassung, bd?.erstzulassungLesbar)),
    getriebe: feldAusQuellen(
      typeof schein?.getriebe === "string" ? { wert: schein.getriebe, lesbar: true } : schein?.getriebe,
      textFeld(bd?.getriebe, bd?.getriebeLesbar),
    ),
    hu: feldAusQuellen(
      textFeld(huText(schein?.huPlakette || bd?.huPlakette)),
      textFeld(huText(ausBd.hu?.wert), ausBd.hu?.lesbar),
    ),
    beschaedigungen: Array.isArray(bd?.beschaedigungen) ? bd.beschaedigungen : [],
    fahrbereitschaft: ausBd.fahrbereitschaft,
    airbagAusgeloest: ausBd.airbagAusgeloest,
    schilderung: ausBd.schilderung,
    polizei: ausBd.polizei,
    bereifung: ausBd.bereifung,
    vorschaeden: ausBd.vorschaeden,
  };

  if (vollmacht && abtretung.anwalt?.name) datensatz.anwalt = abtretung.anwalt;
  if (halter && !gleicherHalter && halter.name) datensatz.fahrzeughalter = { ...halter, lesbar: true };
  return datensatz;
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
    unfallgegnerKennzeichen: quelle.unfallgegnerKennzeichen,
    schadentag: quelle.schadentag,
    schadennummer: quelle.schadennummer,
    versicherungsnummer: quelle.versicherungsnummer,
    schadenort: quelle.schadenort,
    schadenstrasse: quelle.schadenstrasse,
    vollmacht: quelle.vollmacht,
    fin: quelle.fin,
    erstzulassung: quelle.erstzulassung,
    getriebe: quelle.getriebe,
    fahrzeughalter: quelle.fahrzeughalter,
    beschaedigungen: quelle.beschaedigungen,
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
