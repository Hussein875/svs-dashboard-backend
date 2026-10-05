import { textFuerTrigger } from "./schaden-trigger.js";

const ARTIKEL = new Set(["Der", "Die", "Das"]);
const GETRIEBE = new Set(["Automatik", "Schaltgetriebe"]);
const FIN = /^[A-HJ-NPR-Z0-9]{17}$/;
const PLATTE = /^([A-ZÄÖÜ]{1,3})[-\s]+([A-ZÄÖÜ]{1,2})\s+(\d{1,4}[EH]?)$/;

function text(wert) {
  return String(wert ?? "").trim();
}

function kennzeichen(wert) {
  const roh = text(wert).toUpperCase().replace(/\s+/g, " ");
  const treffer = roh.match(PLATTE);
  if (!treffer) return "";
  return `${treffer[1]}-${treffer[2]} ${treffer[3]}`;
}

function feld(wert, muster) {
  const inhalt = text(wert);
  if (!inhalt || (muster && !muster.test(inhalt))) return { wert: "", lesbar: false };
  return { wert: inhalt, lesbar: true };
}

function strasseKlar(wert) {
  return /\d/.test(wert) && /\b(str\.?|straße|strasse|weg|platz|allee|damm|ring|gasse|chaussee|steig)\b/i.test(wert);
}

function vorschadenZeile(wert) {
  const roh = text(wert);
  const kuerzel = {
    tvl: "Tür vorne links beschädigt",
    tvr: "Tür vorne rechts beschädigt",
    thl: "Tür hinten links beschädigt",
    thr: "Tür hinten rechts beschädigt",
    sfv: "Stoßfänger vorne beschädigt",
    sfh: "Stoßfänger hinten beschädigt",
  };
  return kuerzel[roh.toLowerCase()] || roh;
}

function teilSatz(name) {
  const roh = text(name);
  const bekannt = [
    [/stoßfänger vorne/i, "Der", "Stoßfänger vorne"],
    [/blende\s+vl|blende vorne links/i, "Die", "Blende vorne links"],
    [/pdc\s+vl|parkhilfe.*vorne links/i, "Der", "Parkhilfe-Sensor vorne links"],
  ];
  for (const [muster, artikel, teil] of bekannt) {
    if (muster.test(roh)) return `${artikel} ${teil} ist beschädigt und muss erneuert werden.`;
  }
  return "";
}

function person(quelle) {
  const name = text(quelle?.name);
  const strasse = text(quelle?.strasse);
  const plz = text(quelle?.plz);
  const ort = text(quelle?.ort);
  if (!name || !strasseKlar(strasse) || !plz || !ort) return { lesbar: false };
  const anrede = quelle?.anrede === "Frau" ? "Frau" : "Herr";
  return { anrede, name, strasse, plz, ort, lesbar: true };
}

function gleicherName(links, rechts) {
  const token = (wert) => text(wert).toLowerCase().split(/\s+/).filter(Boolean);
  const a = token(links);
  const b = new Set(token(rechts));
  if (a.length === 0 || b.size === 0) return false;
  return a.every((teil) => b.has(teil)) || token(rechts).every((teil) => new Set(a).has(teil));
}

function satzOhneKuerzel(eintrag) {
  const artikel = text(eintrag?.artikel);
  const teil = text(eintrag?.teil).replace(/[.]+$/g, "");
  if (!ARTIKEL.has(artikel) || !teil || teil.length > 80) return "";
  return `${artikel} ${teil} ist beschädigt und muss erneuert werden.`;
}

function profiltiefe(wert) {
  const roh = text(wert).toLowerCase().replace(/\s*mm\b/g, "").replace(",", ".").trim();
  const treffer = roh.match(/^(\d{1,2})(?:\.(\d))?$/);
  if (!treffer) return "";
  const zahl = Number(`${treffer[1]}.${treffer[2] || "0"}`);
  if (zahl < 1 || zahl > 12) return "";
  if (!treffer[2] || treffer[2] === "0") return String(Number(treffer[1]));
  return `${treffer[1]},${treffer[2]}`;
}

function herstellerName(wert) {
  const roh = text(wert);
  if (!roh || roh.length < 2 || roh.length > 40) return "";
  if (!/^[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß0-9 .&+-]{1,39}$/.test(roh)) return "";
  if (/unleser|unklar|nicht erkennbar|geschätzt|geschaetzt/i.test(roh)) return "";
  return roh;
}

function dimensionNorm(wert) {
  const treffer = text(wert).match(/(\d{3})\s*\/\s*(\d{2})\s*[Rr]\s*(\d{2})/);
  if (!treffer) return "";
  const breite = Number(treffer[1]);
  const hoehe = Number(treffer[2]);
  const zoll = Number(treffer[3]);
  if (breite < 125 || breite > 355 || hoehe < 25 || hoehe > 85 || zoll < 12 || zoll > 24) return "";
  return `${treffer[1]}/${treffer[2]} R${treffer[3]}`;
}

function felgenNorm(wert) {
  const roh = text(wert).toLowerCase();
  if (/^stahl(felge)?$/.test(roh)) return "Stahl";
  if (/^(aluminium|alu|alufelge|leichtmetallfelge)$/.test(roh)) return "Aluminium";
  return "";
}

export function reifenFelder(bd, bild) {
  const links = bd || {};
  const rechts = bild || {};
  const profil = profiltiefe(links.profiltiefe) || profiltiefe(rechts.profiltiefe);
  const hersteller = herstellerName(links.hersteller) || herstellerName(rechts.hersteller);
  const dimension = dimensionNorm(links.dimension) || dimensionNorm(rechts.dimension);
  const felgen = felgenNorm(links.felgen) || felgenNorm(rechts.felgen);
  return { profiltiefe: profil, hersteller, dimension, felgen, lesbar: Boolean(profil && hersteller && dimension && felgen) };
}

function fahrbereitschaftAus(wert, bdGelesen) {
  const roh = text(wert).toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (roh === "nicht verkehrssicher" || roh === "nicht fahrbereit" || roh === "verkehrssicher") return roh;
  const leer = roh === "" || ["leer", "keine", "keins", "kein", "false", "null", "nein", "nicht angekreuzt", "kein kreuz", "nichts"].includes(roh);
  if (bdGelesen && leer) return "verkehrssicher";
  return "";
}

function tagesdatum(wert) {
  const treffer = text(wert).match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!treffer) return "";
  const tag = Number(treffer[1]);
  const monat = Number(treffer[2]);
  const jahr = Number(treffer[3]);
  const datum = new Date(jahr, monat - 1, tag);
  if (datum.getFullYear() !== jahr || datum.getMonth() !== monat - 1 || datum.getDate() !== tag) return "";
  const heute = new Date();
  heute.setHours(23, 59, 59, 999);
  if (datum > heute || jahr < heute.getFullYear() - 3) return "";
  return `${String(tag).padStart(2, "0")}.${String(monat).padStart(2, "0")}.${jahr}`;
}

function nummerFeld(wert) {
  const inhalt = text(wert);
  if (!/\d/.test(inhalt) || inhalt.length < 3 || inhalt.length > 40) return "";
  return inhalt;
}

function kurztext(wert) {
  const inhalt = text(wert);
  if (inhalt.length < 2 || inhalt.length > 80) return "";
  return inhalt;
}

function huPlakette(wert) {
  const textWert = text(wert);
  const treffer = textWert.match(/^(\d{1,2})\s*[./]\s*(\d{4})$/);
  if (!treffer) return "";
  const monat = Number(treffer[1]);
  const jahr = Number(treffer[2]);
  const jetzt = new Date().getFullYear();
  if (monat < 1 || monat > 12 || jahr < jetzt) return "";
  return `${String(monat).padStart(2, "0")}.${jahr}`;
}

function schadenSaetze(quelle) {
  const beschaedigungen = [];
  for (const kuerzel of Array.isArray(quelle?.beschaedigungKuerzel) ? quelle.beschaedigungKuerzel : []) {
    const satz = textFuerTrigger(kuerzel);
    if (satz && kuerzel !== "div") beschaedigungen.push(satz.endsWith(".") ? satz : `${satz}.`);
  }
  for (const eintrag of Array.isArray(quelle?.beschaedigungOhneKuerzel) ? quelle.beschaedigungOhneKuerzel : []) {
    const satz = satzOhneKuerzel(eintrag);
    if (satz && !beschaedigungen.includes(satz)) beschaedigungen.push(satz);
  }
  for (const name of Array.isArray(quelle?.aktuell) ? quelle.aktuell : []) {
    const satz = teilSatz(name);
    if (satz && !beschaedigungen.includes(satz)) beschaedigungen.push(satz);
  }
  return beschaedigungen;
}

export function rohAusModell(modell, optionen = {}) {
  const quelle = modell || {};
  const fahrzeug = optionen.fahrzeug || {};
  const schaden = optionen.schaden || quelle;
  const reifen = reifenFelder(quelle.bereifung, optionen.bereifungBild);
  const profil = reifen.profiltiefe;
  const hersteller = reifen.hersteller;
  const dimension = reifen.dimension;
  const felgen = reifen.felgen;
  const reifenKlar = reifen.lesbar;
  const fahrbereitschaft = fahrbereitschaftAus(quelle.fahrbereitschaft, optionen.bdGelesen === true);
  const uebersichten = schaden.uebersichten || quelle.uebersichten || {};
  const auftraggeber = person(quelle.auftraggeber);
  const halter = person(fahrzeug.halter || quelle.halter);
  const halterGleich = halter.lesbar && auftraggeber.lesbar && gleicherName(halter.name, auftraggeber.name);
  const fin = text(fahrzeug.fin || quelle.fin).toUpperCase();
  const getriebe = text(fahrzeug.getriebe || quelle.getriebe);
  const hu = huPlakette(fahrzeug.huPlakette || quelle.huPlakette);
  const scheinPlatte = kennzeichen(fahrzeug.kennzeichenSchein || quelle.kennzeichenSchein);
  const bildPlatte = kennzeichen(fahrzeug.kennzeichenBild || quelle.kennzeichenBild);

  const bd = {
    kuerzel: text(optionen.kuerzel).toUpperCase(),
    kilometerstand: text(fahrzeug.kilometerstand || quelle.kilometerstand),
    kilometerstandLesbar: Boolean(text(fahrzeug.kilometerstand || quelle.kilometerstand)),
    hu,
    huLesbar: Boolean(hu),
    fahrbereitschaft,
    airbagAusgeloest: quelle.airbagAusgeloest === true,
    scheckheft: quelle.scheckheft === true,
    polizei: quelle.polizei === true,
    hergang: quelle.hergangGeparkt === true ? ["geparkt"] : [],
    bereifung: reifenKlar
      ? { profiltiefe: profil, hersteller, herstellerLesbar: true, dimension, dimensionLesbar: true, felgen }
      : { lesbar: false },
    beschaedigungen: schadenSaetze(schaden),
    vorschaedenAngegeben: true,
    vorschaedenLesbar: true,
    vorschadenImBereich: (schaden.vorschadenImBereich || []).map(vorschadenZeile).filter(Boolean),
    vorschadenAusserhalb: (schaden.vorschadenAusserhalb || []).map(vorschadenZeile).filter(Boolean),
    uebersichten: {
      vorneLinks: text(uebersichten.vorneLinks),
      vorneRechts: text(uebersichten.vorneRechts),
      hintenRechts: text(uebersichten.hintenRechts),
      hintenLinks: text(uebersichten.hintenLinks),
    },
  };

  const eigenesKennzeichen = kennzeichen(quelle.kennzeichenAbtretung) || scheinPlatte || bildPlatte;
  const unfallgegner = kennzeichen(quelle.kennzeichenUnfallgegner);
  const unfallgegnerKlar = unfallgegner && unfallgegner !== eigenesKennzeichen ? unfallgegner : "";
  const ae = {
    vollmacht: optionen.vollmacht === true,
    auftraggeber,
    kennzeichen: { wert: kennzeichen(quelle.kennzeichenAbtretung), lesbar: Boolean(kennzeichen(quelle.kennzeichenAbtretung)) },
    unfallgegnerKennzeichen: { wert: unfallgegnerKlar, lesbar: Boolean(unfallgegnerKlar) },
    schadentag: { wert: tagesdatum(quelle.schadentag), lesbar: Boolean(tagesdatum(quelle.schadentag)) },
    schadennummer: { wert: nummerFeld(quelle.schadennummer), lesbar: Boolean(nummerFeld(quelle.schadennummer)) },
    versicherungsnummer: { wert: nummerFeld(quelle.versicherungsnummer), lesbar: Boolean(nummerFeld(quelle.versicherungsnummer)) },
    schadenort: { wert: kurztext(quelle.schadenort), lesbar: Boolean(kurztext(quelle.schadenort)) },
    schadenstrasse: { wert: kurztext(quelle.schadenstrasse), lesbar: Boolean(kurztext(quelle.schadenstrasse)) },
    versicherung: { lesbar: false },
  };
  if (!ae.kennzeichen.wert) ae.kennzeichen.lesbar = false;
  const anwaltName = text(quelle.anwalt);
  const anwaltIstAuftraggeber = auftraggeber.lesbar && gleicherName(anwaltName, auftraggeber.name);
  if (optionen.vollmacht === true && anwaltName && !anwaltIstAuftraggeber) {
    ae.anwalt = { name: anwaltName, lesbar: true };
  }

  return {
    bd,
    ae,
    schein: {
      fin: feld(fin, FIN),
      erstzulassung: feld(fahrzeug.erstzulassung || quelle.erstzulassung, /^\d{2}\.\d{2}\.\d{4}$/),
      getriebe: GETRIEBE.has(getriebe) ? getriebe : "",
      kennzeichenSchein: scheinPlatte,
      huPlakette: hu,
      halter: halter.lesbar && !halterGleich ? halter : undefined,
    },
    bilder: { kennzeichen: bildPlatte },
  };
}
