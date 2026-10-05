import { textFuerTrigger } from "./schaden-trigger.js";

const ARTIKEL = new Set(["Der", "Die", "Das"]);
const FAHRBEREIT = new Set(["verkehrssicher", "nicht verkehrssicher", "nicht fahrbereit"]);
const FELGEN = new Set(["Stahl", "Aluminium"]);
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
  const felgen = FELGEN.has(quelle.bereifung?.felgen) ? quelle.bereifung.felgen : "";
  const profil = text(quelle.bereifung?.profiltiefe);
  const hersteller = text(quelle.bereifung?.hersteller);
  const dimension = text(quelle.bereifung?.dimension);
  const reifenKlar = Boolean(profil && hersteller && dimension && felgen);
  const fahrbereitschaft = text(quelle.fahrbereitschaft).toLowerCase();
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
    fahrbereitschaft: FAHRBEREIT.has(fahrbereitschaft) ? fahrbereitschaft : "",
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

  const versicherungName = text(quelle.versicherung?.name);
  const ae = {
    vollmacht: optionen.vollmacht === true,
    auftraggeber,
    kennzeichen: { wert: kennzeichen(quelle.kennzeichenAbtretung), lesbar: Boolean(kennzeichen(quelle.kennzeichenAbtretung)) },
    versicherung: versicherungName ? { name: versicherungName, lesbar: true } : { lesbar: false },
  };
  if (!ae.kennzeichen.wert) ae.kennzeichen.lesbar = false;
  if (optionen.vollmacht === true && text(quelle.anwalt)) {
    ae.anwalt = { name: text(quelle.anwalt), lesbar: true };
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
