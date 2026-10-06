import { textFuerTrigger } from "./schaden-trigger.js";

const GESPERRTE_AKTEN = new Set(["2037/26", "2083/26"]);

const EXPERTEN = {
  HU: "Hussein Souleiman",
  H: "Hussein Jaber",
  HJ: "Hussein Jaber",
  B: "Hussein Selman",
  OS: "Osama Sleiman",
  HK: "Hassan Khodr",
};

const FAHRBEREIT = new Set(["verkehrssicher", "nicht verkehrssicher", "nicht fahrbereit"]);

export function akteGesperrt(nummer) {
  const text = String(nummer || "").trim();
  if (/-test$/i.test(text)) return true;
  return GESPERRTE_AKTEN.has(text);
}

export function sachverstaendigerName(kuerzel) {
  return EXPERTEN[String(kuerzel || "").trim().toUpperCase()] || "";
}

export function waehleOption(optionen, gesucht) {
  const liste = (optionen || []).map((eintrag) => String(eintrag).trim()).filter(Boolean);
  const ziel = String(gesucht || "").trim().toLowerCase();
  if (!ziel) return null;
  if (ziel === "verkehrssicher") {
    return liste.find((eintrag) => {
      const text = eintrag.toLowerCase();
      return text.includes("verkehrssicher") && !text.includes("nicht");
    }) || null;
  }
  if (ziel === "nicht verkehrssicher") {
    return liste.find((eintrag) => eintrag.toLowerCase().includes("nicht verkehrssicher")) || null;
  }
  const genau = liste.find((eintrag) => eintrag.toLowerCase() === ziel);
  if (genau) return genau;
  return liste.find((eintrag) => eintrag.toLowerCase().includes(ziel)) || null;
}

export function waehleModell(optionen, { erstzulassung, getriebe } = {}) {
  const art = String(getriebe || "").trim().toLowerCase();
  const jahr = (String(erstzulassung || "").match(/(19|20)\d{2}/) || [])[0] || "";
  if (!art) return null;
  const liste = (optionen || []).map((eintrag) => String(eintrag).trim()).filter(Boolean);
  const mitGetriebe = liste.filter((text) => text.toLowerCase().includes(art));
  if (mitGetriebe.length === 0) return null;
  if (!jahr) return mitGetriebe.length === 1 ? mitGetriebe[0] : null;
  const mitJahr = mitGetriebe.filter((text) => text.includes(jahr));
  if (mitJahr.length === 1) return mitJahr[0];
  if (mitJahr.length === 0 && mitGetriebe.length === 1) return mitGetriebe[0];
  return null;
}

export function schadenText(teile) {
  const punkte = (teile || []).map((teil) => String(teil).replace(/^\s*[-•]\s*/, "").trim()).filter(Boolean);
  return [
    "Im Zusammenhang mit dem Schadenfall wurden am Fahrzeug folgende Beschädigungen festgestellt:",
    ...punkte.map((punkt) => `• ${punkt}`),
    `• ${textFuerTrigger("div")}`,
    "Zum Schadenumfang wird neben der Schadenbeschreibung auf die beigefügten Lichtbilder verwiesen. Eine detaillierte Aufstellung des Schadenumfangs wird aus der Kalkulation ersichtlich.",
  ].join("\n");
}

function wert(eintrag) {
  if (!eintrag || typeof eintrag !== "object" || eintrag.lesbar === false) return "";
  return String(eintrag.wert ?? "").trim();
}

function adresse(person) {
  if (!person || person.lesbar === false) return "";
  const strasse = String(person.strasse || "").trim();
  const plz = String(person.plz || "").trim();
  const ort = String(person.ort || "").trim();
  if (!strasse || !plz || !ort) return "";
  return `${strasse}, ${plz} ${ort}`;
}

function nameTeile(name) {
  const teile = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (teile.length < 2) return null;
  return { vorname: teile.slice(0, -1).join(" "), nachname: teile.at(-1) };
}

function fachlich(id, grund) {
  return { id, fachlich: grund, speichern: false, befehle: [] };
}

function offen(id) {
  return { id, nichtUmgesetzt: true, speichern: false, befehle: [] };
}

function besichtigung(daten) {
  const ort = adresse(daten.auftraggeber);
  const name = sachverstaendigerName(daten.kuerzel);
  if (!ort) return fachlich("besichtigung", "Besichtigungsadresse fehlt");
  if (!name) return fachlich("besichtigung", "Sachverständiger fehlt");
  return {
    id: "besichtigung",
    speichern: true,
    befehle: [
      { typ: "seite", pfad: "surveys" },
      { typ: "waehle", feld: "Besichtigungsort", wert: "Auftraggeber" },
      { typ: "text", feld: "surveys.0.locationName", wert: "" },
      { typ: "text", feld: "surveys.0.location", wert: ort },
      { typ: "waehle", feld: "Sachverständiger", wert: name },
    ],
  };
}

function beteiligte(daten) {
  const person = daten.auftraggeber || {};
  const anrede = person.anrede === "Frau" ? "Frau" : "Herr";
  const teile = nameTeile(person.name);
  if (person.lesbar === false || !teile || !adresse(person)) {
    return fachlich("beteiligte", "Auftraggeber unvollständig");
  }
  const befehle = [
    { typ: "seite", pfad: "participants" },
    {
      typ: "beteiligter",
      rolle: "Auftraggeber",
      anrede,
      vorname: teile.vorname,
      nachname: teile.nachname,
      strasse: String(person.strasse).trim(),
      plz: String(person.plz).trim(),
      ort: String(person.ort).trim(),
    },
  ];
  const halter = daten.fahrzeughalter;
  const halterName = String(halter?.name || "").trim();
  const halterAnrede = halter?.anrede === "Frau" ? "Frau" : "Herr";
  const halterTeile = nameTeile(halterName);
  const namenGleich = halterName.toLowerCase().replace(/\s+/g, " ") === String(person.name || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (halter && halter.lesbar !== false && halterName && !namenGleich && halterAnrede && halterTeile) {
    befehle.push({
      typ: "beteiligter",
      rolle: "Fahrzeughalter",
      anrede: halterAnrede,
      vorname: halterTeile.vorname,
      nachname: halterTeile.nachname,
      strasse: String(halter.strasse || "").trim(),
      plz: String(halter.plz || "").trim(),
      ort: String(halter.ort || "").trim(),
    });
  }
  const anwalt = String(daten.anwalt?.name || "").trim();
  if (daten.vollmacht === true && daten.anwalt && daten.anwalt.lesbar !== false && anwalt) {
    befehle.push({ typ: "beteiligter", rolle: "Anwalt", anrede: "Firma", firma: anwalt });
  }
  return { id: "beteiligte", speichern: true, befehle };
}

function auftrag(daten) {
  const befehl = {
    typ: "auftrag",
    kennzeichen: wert(daten.kennzeichen),
    fin: wert(daten.fin),
    schadentag: wert(daten.schadentag),
    schadennummer: wert(daten.schadennummer),
    versicherungsnummer: wert(daten.versicherungsnummer),
    schadenort: wert(daten.schadenort),
    schadenstrasse: wert(daten.schadenstrasse),
    sachverstaendiger: sachverstaendigerName(daten.kuerzel),
    unfallgegner: daten.unfallgegnerKennzeichen?.lesbar === false ? "" : wert(daten.unfallgegnerKennzeichen),
    erteilung: "telefonisch",
    erteiltDurch: "den Auftraggeber",
  };
  return {
    id: "auftrag",
    speichern: true,
    befehle: [
      { typ: "seite", pfad: "order/general" },
      befehl,
    ],
  };
}

function fahrzeug(daten) {
  const fin = wert(daten.fin);
  const ez = wert(daten.erstzulassung);
  const getriebe = wert(daten.getriebe);
  const km = wert(daten.kilometerstand);
  const hu = wert(daten.hu);
  if (!fin) return fachlich("fahrzeug", "Fahrzeugidentifikationsnummer fehlt");
  if (!ez || !getriebe) return fachlich("fahrzeug", "Erstzulassung oder Getriebe fehlt");
  if (!km) return fachlich("fahrzeug", "Kilometerstand fehlt");
  const befehle = [
    { typ: "seite", pfad: "vehicle/identification" },
    { typ: "text", feld: "vehicle.vin", wert: fin },
    { typ: "fin", fin, erstzulassung: ez, getriebe },
    { typ: "text", feld: "vehicle.milageRead", wert: km },
    { typ: "datum", feld: "registrationDate_input", wert: ez },
  ];
  if (hu) befehle.push({ typ: "datum", feld: "generalInspectionDate_input", wert: hu });
  const farbe = wert(daten.farbe);
  if (farbe) befehle.push({ typ: "text", feld: "vehicle.color", wert: farbe });
  return { id: "fahrzeug", speichern: true, befehle };
}

function bereifung(daten) {
  const reifen = daten.bereifung;
  if (!reifen || reifen.lesbar === false) return fachlich("bereifung", "Bereifung fehlt");
  const profiltiefe = String(reifen.profiltiefe || "").trim();
  const hersteller = String(reifen.hersteller || "").trim();
  const dimension = String(reifen.dimension || "").trim();
  const felgen = String(reifen.felgen || "").trim();
  if (!profiltiefe || !hersteller || !dimension) return fachlich("bereifung", "Bereifung fehlt");
  if (felgen !== "Stahl" && felgen !== "Aluminium") return fachlich("bereifung", "Felgen unklar");
  return {
    id: "bereifung",
    speichern: true,
    befehle: [
      { typ: "seite", pfad: "vehicle/tyres" },
      { typ: "text", feld: "tyres.1.profile", wert: profiltiefe },
      { typ: "waehle", feld: "Hersteller", wert: hersteller },
      { typ: "waehle", feld: "Dimension", wert: dimension },
      { typ: "waehle", feld: "Felgen", wert: felgen },
    ],
  };
}

function vorOrt(daten) {
  if (!wert(daten.schilderung)) return fachlich("vor-ort", "Schilderung fehlt");
  const befehle = [
    { typ: "seite", pfad: "inspections" },
    { typ: "waehle", feld: "Besichtigungsbedingungen", wert: "ausreichend" },
    { typ: "waehle", feld: "Besichtigungszustand", wert: "unrepariert" },
    { typ: "waehle", feld: "Identifizierung", wert: "FZ-Schein" },
    { typ: "waehle", feld: "Probelauf Antrieb", wert: "durchgeführt" },
    { typ: "waehle", feld: "Allgemeinzustand", wert: "gepflegt" },
    { typ: "waehle", feld: "Plausibilität", wert: "plausibel" },
    { typ: "label", feld: "Schilderung", wert: wert(daten.schilderung) },
  ];
  if (daten.scheckheft === true) {
    befehle.push({ typ: "waehle", feld: "Scheckheftgepflegt", wert: "Fachwerkstatt" });
  }
  return { id: "vor-ort", speichern: true, befehle };
}

const WERTVERBESSERUNG = [
  "<p>Die Vorschäden, welche sich ebenfalls im aktuellen Schadenbereich befinden haben einen geringen Schadenausmaß. Durch den neuen Zusammenstoß, ist ein <strong>wirtschaftlicher Mehrschaden</strong> entstanden.</p>",
  "<p>Für diese Vorschäden wurde ein Vorteilsausgleich bei der Lackierung sowie den Ersatzteilen berücksichtigt (<strong>vgl. Wertverbesserung</strong>). Im Rahmen der Instandsetzung des Fahrzeuges werden die Vorschäden zwangsläufig mit beseitigt. Vorliegend tritt eine Gesamtwertverbesserung des Fahrzeuges in Höhe von {{INCREASE_IN_VALUE_PREDAMAGE}} ein.</p>",
].join("");

function html(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function aufzaehlung(titel, teile) {
  const punkte = teile.map((teil) => `<li>${html(teil)}</li>`).join("");
  return `<p>${html(titel)}</p><ul>${punkte}</ul>`;
}

function zeile(teil) {
  return String(teil || "").replace(/\s+/g, " ").trim();
}

function schluessel(teil) {
  return zeile(teil).toLowerCase().replace(/[.]/g, "");
}

function eindeutig(teile, schon = new Set()) {
  const ergebnis = [];
  for (const teil of teile || []) {
    const text = zeile(teil);
    const key = schluessel(text);
    if (!text || schon.has(key)) continue;
    schon.add(key);
    ergebnis.push(text);
  }
  return ergebnis;
}

function fasseStossfaenger(teile) {
  const seiten = new Map();
  for (const teil of teile) {
    const treffer = schluessel(teil).match(/^stoßfänger (vorne|hinten)(?: (links|rechts))? beschädigt$/);
    if (!treffer) continue;
    if (!seiten.has(treffer[1])) seiten.set(treffer[1], new Set());
    seiten.get(treffer[1]).add(treffer[2] || "ganz");
  }
  const gesehen = new Set();
  const ergebnis = [];
  for (const teil of teile) {
    const treffer = schluessel(teil).match(/^stoßfänger (vorne|hinten)(?: (links|rechts))? beschädigt$/);
    if (!treffer) {
      ergebnis.push(teil);
      continue;
    }
    if (gesehen.has(treffer[1])) continue;
    gesehen.add(treffer[1]);
    const vorhanden = seiten.get(treffer[1]);
    const beide = vorhanden.has("links") && vorhanden.has("rechts");
    ergebnis.push(beide || vorhanden.has("ganz") ? `Stoßfänger ${treffer[1]} beschädigt` : teil);
  }
  return ergebnis;
}

export function vorschaedenText(eintrag) {
  const quelle = eintrag || {};
  const innenNamen = new Set((quelle.imSchadenbereich || []).map(schluessel));
  const aussen = fasseStossfaenger(eindeutig(quelle.ausserhalb).filter((teil) => !innenNamen.has(schluessel(teil))));
  const innen = fasseStossfaenger(eindeutig(quelle.imSchadenbereich));
  const bloecke = [];
  if (aussen.length > 0) bloecke.push(aufzaehlung("Nicht im Schadenbereich:", aussen));
  if (innen.length > 0) bloecke.push(aufzaehlung("Im Schadenbereich:", innen) + WERTVERBESSERUNG);
  return bloecke.join("");
}

function vorschaeden(daten) {
  const eintrag = daten.vorschaeden || {};
  const text = vorschaedenText(eintrag);
  if (!text) {
    return {
      id: "vorschaeden",
      speichern: false,
      befehle: [{ typ: "seite", pfad: "condition/predamage" }],
    };
  }
  const imBereich = Array.isArray(eintrag.imSchadenbereich) && eintrag.imSchadenbereich.length > 0;
  return {
    id: "vorschaeden",
    speichern: true,
    befehle: [
      { typ: "seite", pfad: "condition/predamage" },
      {
        typ: "vorschaden",
        variante: imBereich
          ? "A - Abzug Vorschäden - WV Erneuerung"
          : "C - Abzug - Vorschaden NICHT im Schadenbereich",
        html: text,
      },
    ],
  };
}

function schadenfeststellung(daten) {
  const fahrbereitschaft = String(daten.fahrbereitschaft || "").trim().toLowerCase();
  if (!FAHRBEREIT.has(fahrbereitschaft)) return fachlich("schadenfeststellung", "Fahrbereitschaft fehlt");
  const teile = Array.isArray(daten.beschaedigungen)
    ? daten.beschaedigungen.map((teil) => String(teil).trim()).filter(Boolean)
    : [];
  if (teile.length === 0) return fachlich("schadenfeststellung", "Schadenbeschreibung fehlt");
  const befehle = [
    { typ: "seite", pfad: "condition/vehicle" },
    { typ: "waehle", feld: "movementType", wert: fahrbereitschaft },
    { typ: "waehle", feld: "airbagReleased", wert: daten.airbagAusgeloest === true ? "Ja" : "Nein" },
    { typ: "label", feld: "Schadenbeschreibung", wert: schadenText(teile) },
  ];
  if (String(daten.schadenregionen || "").includes("1")) {
    befehle.push({ typ: "skizze", regionen: String(daten.schadenregionen) });
  }
  return { id: "schadenfeststellung", speichern: true, befehle };
}

export function eingabePlan(daten) {
  const quelle = daten || {};
  return {
    auftrag: auftrag(quelle),
    besichtigung: besichtigung(quelle),
    beteiligte: beteiligte(quelle),
    fahrzeug: fahrzeug(quelle),
    bereifung: bereifung(quelle),
    "vor-ort": vorOrt(quelle),
    vorschaeden: vorschaeden(quelle),
    schadenfeststellung: schadenfeststellung(quelle),
    "dokumente-import": offen("dokumente-import"),
    lichtbilder: offen("lichtbilder"),
  };
}
