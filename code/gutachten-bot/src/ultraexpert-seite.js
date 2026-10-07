import { FachlichError, NichtUmgesetztError } from "./fehler.js";
import { waehleModell, waehleOption } from "./eingabe-plan.js";

export const UNSICHERE_TYPEN = new Set(["skizze"]);

function kurzFehler(error) {
  const text = String(error?.message || error || "").split("Call log")[0].split("\n")[0].trim();
  if (/timeout|locator|waiting for/i.test(text)) return "Klick nicht möglich";
  return text.slice(0, 80) || "nicht eingetragen";
}

export async function fuehreSchritt(seite, schritt) {
  if (!schritt) throw new FachlichError("Schritt fehlt");
  if (schritt.fachlich) throw new FachlichError(schritt.fachlich);
  if (schritt.nichtUmgesetzt) throw new NichtUmgesetztError(schritt.id);
  if (!(schritt.befehle || []).length && schritt.wiederholen) throw new FachlichError(schritt.wiederholen);
  const probleme = [];
  for (const befehl of schritt.befehle || []) {
    if (UNSICHERE_TYPEN.has(befehl.typ)) continue;
    try {
      await seite.ausfuehren(befehl);
    } catch (error) {
      if (error?.code === "BOT_STOPPED") throw error;
      probleme.push(kurzFehler(error));
    }
  }
  let gespeichert = false;
  if (schritt.speichern) {
    try {
      const pruefung = await seite.pruefe();
      if (!pruefung?.ok) probleme.push("Rücklesen");
      else {
        await seite.speichern();
        gespeichert = true;
      }
    } catch (error) {
      if (error?.code === "BOT_STOPPED") throw error;
      probleme.push(kurzFehler(error));
    }
  }
  if (probleme.length && !gespeichert) throw new FachlichError([...new Set(probleme)].join("; "));
  return { gespeichert, hinweis: probleme };
}

export function fakeSeite(optionen = {}) {
  const werte = new Map();
  const gespeichert = [];
  const befehle = [];
  return {
    werte,
    gespeichert,
    befehle,
    geoeffnet: [],
    async oeffneAkte(nummer) {
      this.geoeffnet.push(nummer);
    },
    async ausfuehren(befehl) {
      befehle.push(befehl);
      if (befehl.typ === "text" || befehl.typ === "datum" || befehl.typ === "label" || befehl.typ === "waehle") {
        werte.set(befehl.feld, befehl.wert);
      }
      if (befehl.typ === "fin") {
        const modell = waehleModell(optionen.modelle || [], befehl);
        if (!modell) throw new FachlichError("Modellauswahl nicht eindeutig");
        werte.set("modell", modell);
        werte.set("vehicle.vin", befehl.fin);
      }
      if (befehl.typ === "beteiligter") {
        werte.set(befehl.rolle, JSON.stringify(befehl));
      }
      if (befehl.typ === "vorschaden") {
        werte.set("vorschaeden", befehl.html);
      }
    },
    async pruefe() {
      if (optionen.ruecklesenFalsch) return { ok: false };
      return { ok: true };
    },
    async speichern() {
      gespeichert.push(Object.fromEntries(werte));
    },
  };
}

async function schliesseStoerungen(page) {
  const closeBtn = page.locator("div.modal-content .modal-header button.close").first();
  if (await closeBtn.isVisible().catch(() => false)) {
    await closeBtn.click({ timeout: 3000 }).catch(() => {});
    await page.keyboard.press("Escape").catch(() => {});
  }
  const banner = page.locator(".alert").filter({ hasText: /Mehrfachzugriff/i }).first();
  if (await banner.isVisible().catch(() => false)) {
    await banner.locator("button.close, .close").first().click().catch(() => {});
  }
}

async function warteAufSeite(page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  await schliesseStoerungen(page);
}

async function wiederAnmelden(page, ziel) {
  if (!String(page.url()).includes("/login")) return;
  const kunde = page.locator("input[name='customerNr']").first();
  await kunde.waitFor({ state: "visible", timeout: 15_000 });
  const kundenNr = process.env.UX_USERNAME || process.env.UX_CUSTOMER_NR || "";
  await kunde.fill(kundenNr);
  await page.locator("input[type='password']").first().fill(process.env.UX_PASSWORD || "");
  const mandant = page.locator("input[name='mandant']").first();
  if (process.env.UX_MANDANT && await mandant.count()) await mandant.fill(process.env.UX_MANDANT);
  await page.getByRole("button", { name: /Anmelden|Login/i }).first().click();
  await page.waitForURL((url) => !String(url).includes("/login"), { timeout: 20_000 });
  if (ziel) {
    await page.goto(ziel, { waitUntil: "domcontentloaded" });
    await warteAufSeite(page);
  }
  if (String(page.url()).includes("/login")) {
    throw new FachlichError("Anmeldung bei UltraExpert fehlgeschlagen");
  }
}

async function oeffneBesichtigungFallsLeer(page) {
  const ortsfeld = page.locator('[name="surveys.0.location"]').first();
  const knopf = page.locator("button.empty-button.btn-blue").filter({
    has: page.locator("span", { hasText: /^Neue Besichtigung$/ }),
  }).first();

  const ende = Date.now() + 15_000;
  let geklickt = false;
  while (Date.now() < ende) {
    if (await ortsfeld.count() && await ortsfeld.isVisible().catch(() => false)) return;
    if (await knopf.count() && await knopf.isVisible().catch(() => false)) {
      await knopf.scrollIntoViewIfNeeded().catch(() => {});
      await knopf.click();
      geklickt = true;
      break;
    }
    await page.waitForTimeout(300);
  }
  if (!geklickt && !(await ortsfeld.isVisible().catch(() => false))) {
    throw new FachlichError("Neue Besichtigung nicht gefunden");
  }

  await ortsfeld.waitFor({ state: "visible", timeout: 25_000 });
  await warteAufSeite(page);
}

export function createPlaywrightSeite(page) {
  const werte = new Map();
  let dossierId = "";
  const base = String(process.env.UX_URL || "https://ux.winvalue.de/ux/").replace(/\/?$/, "/");

  async function lies(feld) {
    const benannt = page.locator(`[name="${feld}"]`);
    if (await benannt.count()) return (await benannt.first().inputValue()).trim();
    const beschriftet = page.getByLabel(feld, { exact: true }).first();
    if (await beschriftet.count()) return (await beschriftet.inputValue()).trim();
    return "";
  }

  return {
    async oeffneAkte(nummer) {
      const url = `${base}api/v1/dossiers/info?page=0&size=50&sort=createDate,DESC&query=${encodeURIComponent(nummer)}`;
      const response = await page.request.get(url);
      if (!response.ok()) throw new FachlichError("Akte nicht gefunden");
      const payload = await response.json();
      const content = Array.isArray(payload?.content) ? payload.content : [];
      const treffer = content.filter((item) => String(item?.referenceNr || item?.fileNumber || "").trim() === nummer);
      if (treffer.length !== 1 || !treffer[0]?.id) throw new FachlichError("Akte nicht eindeutig");
      dossierId = String(treffer[0].id);
      werte.clear();
    },
    async ausfuehren(befehl) {
      if (befehl.typ === "seite") {
        if (!dossierId) throw new FachlichError("Akte fehlt");
        const ziel = `${base}home/dossiers/edit/${dossierId}/${befehl.pfad}`;
        await page.goto(ziel, { waitUntil: "domcontentloaded" });
        await warteAufSeite(page);
        await wiederAnmelden(page, ziel);
        if (befehl.pfad === "surveys") {
          await oeffneBesichtigungFallsLeer(page);
        }
        werte.clear();
        return;
      }
      if (befehl.typ === "text" || befehl.typ === "datum") {
        const field = befehl.typ === "datum"
          ? page.locator(`#${befehl.feld}`)
          : page.locator(`[name="${befehl.feld}"]`);
        await field.click();
        await field.fill(befehl.wert);
        await field.press("Tab");
        const gelesen = (await field.inputValue()).trim();
        if (gelesen !== befehl.wert) throw new FachlichError(befehl.feld);
        werte.set(befehl.feld, befehl.wert);
        return;
      }
      if (befehl.typ === "label") {
        const field = page.getByLabel(befehl.feld, { exact: false }).first();
        await field.fill(befehl.wert);
        const gelesen = (await field.inputValue()).trim();
        if (gelesen !== befehl.wert) throw new FachlichError(befehl.feld);
        werte.set(befehl.feld, befehl.wert);
        return;
      }
      if (befehl.typ === "waehle") {
        const gewaehlt = await waehleFeld(page, befehl.feld, befehl.wert);
        werte.set(befehl.feld, gewaehlt);
        return;
      }
      if (befehl.typ === "fin") {
        await finSuchen(page);
        const optionen = await page.locator("[id*='option'], [role='option'], tr").allTextContents();
        const modell = waehleModell(optionen, befehl);
        if (!modell) throw new FachlichError("Modellauswahl nicht eindeutig");
        await page.getByText(modell, { exact: false }).first().click();
        werte.set("vehicle.vin", befehl.fin);
        werte.set("modell", modell);
        return;
      }
      if (befehl.typ === "auftrag") {
        await auftragSchreiben(page, befehl);
        return;
      }
      if (befehl.typ === "beteiligter") {
        await beteiligtenSchreiben(page, befehl);
        werte.set(befehl.rolle, befehl.firma || `${befehl.vorname} ${befehl.nachname}`);
        return;
      }
      if (befehl.typ === "versicherung-abfrage") {
        await versicherungAbfragen(page, befehl.kennzeichen);
        return;
      }
      if (befehl.typ === "vorschaden") {
        await vorschadenSchreiben(page, befehl);
        werte.set("vorschaeden", befehl.html);
        return;
      }
      throw new NichtUmgesetztError(befehl.typ);
    },
    async pruefe() {
      for (const [feld, erwartet] of werte) {
        if (feld === "modell" || feld === "Auftraggeber" || feld === "Anwalt" || feld === "Versicherung" || feld === "vorschaeden") continue;
        if (["Besichtigungsort", "Sachverständiger", "Besichtigungsbedingungen", "Besichtigungszustand", "Identifizierung", "Probelauf Antrieb", "Allgemeinzustand", "Plausibilität", "Scheckheftgepflegt", "movementType", "airbagReleased"].includes(feld)) {
          continue;
        }
        const aktuell = await lies(feld);
        if (aktuell !== erwartet) return { ok: false };
      }
      return { ok: true };
    },
    async speichern() {
      const knopf = await sichtbarerKnopf(page, /^Speichern$/i);
      if (knopf) {
        try {
          await knopf.click({ timeout: 8_000 });
        } catch {
          throw new FachlichError("Speichern nicht geklickt");
        }
        await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
        werte.clear();
        return;
      }
      const adresse = String(page.url());
      if (adresse.includes("/participants") && !adresse.includes("/edit")) {
        werte.clear();
        return;
      }
      throw new FachlichError("Speichern nicht gefunden");
    },
  };
}

async function waehleFeld(page, feld, wert) {
  await schliesseStoerungen(page);
  const escaped = feld.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const benannt = page.locator(`[name="${feld}"], select[name*="${feld}"]`).first();
  if (await benannt.count()) {
    const tag = await benannt.evaluate((el) => el.tagName);
    if (tag === "SELECT") {
      const optionen = await benannt.locator("option").allTextContents();
      const treffer = waehleOption(optionen, wert);
      if (!treffer) throw new FachlichError(feld);
      await benannt.selectOption({ label: treffer });
      return treffer;
    }
  }

  const label = page.locator("label").filter({ hasText: new RegExp(escaped, "i") }).first();
  const formGroup = page.locator(".form-group, .form-row, .row").filter({
    has: page.locator("label", { hasText: new RegExp(escaped, "i") }),
  }).first();

  const klickZiele = [
    label.locator("xpath=following::div[contains(@class,'-control')][1]"),
    formGroup.locator(".select2-selection").first(),
    formGroup.locator("div.control").first(),
    formGroup.locator("select").first(),
  ];

  let geoeffnet = false;
  for (const ziel of klickZiele) {
    if (!(await ziel.count())) continue;
    if (!(await ziel.first().isVisible().catch(() => false))) continue;
    await ziel.first().click({ timeout: 15_000 });
    geoeffnet = true;
    break;
  }
  if (!geoeffnet) {
    throw new FachlichError(`Feld nicht klickbar: ${feld}`);
  }

  await page.waitForTimeout(400);
  const optionenLocs = [
    page.locator(".select2-results__option"),
    page.locator("[role='option']"),
    page.locator("[id*='option']"),
  ];
  let optionen = [];
  for (const loc of optionenLocs) {
    if (await loc.count()) {
      optionen = await loc.allTextContents();
      if (optionen.length) break;
    }
  }
  let treffer = waehleOption(optionen, wert);
  if (!treffer) {
    await page.keyboard.type(String(wert), { delay: 20 }).catch(() => {});
    await page.waitForTimeout(400);
    for (const loc of optionenLocs) {
      if (await loc.count()) {
        optionen = await loc.allTextContents();
        if (optionen.length) break;
      }
    }
    treffer = waehleOption(optionen, wert);
  }
  if (!treffer) {
    await page.keyboard.press("Escape").catch(() => {});
    throw new FachlichError(feld);
  }
  for (const loc of optionenLocs) {
    const option = loc.filter({ hasText: treffer }).first();
    if (await option.count()) {
      await option.click();
      return treffer;
    }
  }
  await page.getByText(treffer, { exact: false }).first().click();
  return treffer;
}

async function vorschadenSchreiben(page, befehl) {
  const reiter = page.getByRole("tab", { name: /Vorschäden/i }).first();
  if (await reiter.count()) await reiter.click().catch(() => {});
  const block = page.locator("div").filter({ hasText: "Nicht reparierte Vorschäden" }).last();
  const keine = block.getByRole("checkbox", { name: /^Keine$/i }).first();
  if (await keine.count() && await keine.isChecked().catch(() => false)) await keine.click();
  const auswahl = block.locator("select").first();
  if (befehl.variante && await auswahl.count()) {
    const optionen = await auswahl.locator("option").allTextContents();
    const treffer = waehleOption(optionen, befehl.variante);
    if (treffer) await auswahl.selectOption({ label: treffer }).catch(() => {});
  }
  const editor = block.locator("[contenteditable='true']").first();
  if (!(await editor.count())) throw new NichtUmgesetztError("vorschaeden");
  await editor.evaluate((el, html) => {
    el.innerHTML = html;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, befehl.html);
}

const BETEILIGUNG = {
  Auftraggeber: "AG Auftraggeber",
  Fahrzeughalter: "FH Fahrzeughalter",
  Versicherung: "VS Versicherung",
  Anwalt: "RA Rechtsanwalt",
};

const KONTAKTTYP = {
  Auftraggeber: "Kontakt",
  Fahrzeughalter: "Kontakt",
  Versicherung: "Versicherung",
  Anwalt: "RA-Kanzlei",
};

export function beteiligungText(rolle) {
  return BETEILIGUNG[rolle] || "";
}

async function sichtbarerKnopf(page, muster) {
  const ziele = [
    page.getByRole("button", { name: muster }),
    page.locator("button, a.btn, [role='button']").filter({ hasText: muster }),
  ];
  for (const liste of ziele) {
    const knopf = liste.first();
    if (await knopf.count() && await knopf.isVisible().catch(() => false)) return knopf;
  }
  return null;
}

async function waehleReactAuswahl(page, klasse, text) {
  const control = page.locator(`.select-container.${klasse} [class*='control']`).first();
  if (!(await control.count())) throw new FachlichError(text);
  await control.click();
  const optionen = page.locator("[role='option'], [id*='option']");
  await optionen.first().waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  const anzahl = await optionen.count();
  for (let index = 0; index < anzahl; index += 1) {
    const inhalt = (await optionen.nth(index).innerText()).replace(/\s+/g, " ").trim();
    if (inhalt === text) {
      await optionen.nth(index).click();
      await page.keyboard.press("Escape").catch(() => {});
      return;
    }
  }
  throw new FachlichError(text);
}

async function schreibeFeld(page, name, wert) {
  const inhalt = String(wert || "").trim();
  if (!inhalt) throw new FachlichError(name);
  const feld = page.locator(`[name="${name}"]`).first();
  await feld.click();
  await feld.fill(inhalt);
  const gelesen = (await feld.inputValue()).trim();
  if (gelesen !== inhalt) throw new FachlichError(name);
  await page.keyboard.press("Escape").catch(() => {});
}

function datumSchluessel(wert) {
  const roh = String(wert || "").trim().toLowerCase();
  const zahlen = roh.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (zahlen) return `${zahlen[3]}-${zahlen[2].padStart(2, "0")}-${zahlen[1].padStart(2, "0")}`;
  const monate = {
    januar: "01", februar: "02", märz: "03", maerz: "03", april: "04", mai: "05", juni: "06",
    juli: "07", august: "08", september: "09", oktober: "10", november: "11", dezember: "12",
  };
  const lang = roh.match(/(\d{1,2})\.?\s+([a-zäöü]+),?\s+(\d{4})/);
  if (lang && monate[lang[2]]) return `${lang[3]}-${monate[lang[2]]}-${lang[1].padStart(2, "0")}`;
  return "";
}

async function schreibeWennPasst(page, name, wert) {
  const inhalt = String(wert || "").trim();
  if (!inhalt) return false;
  const feld = page.locator(`[name="${name}"]`).first();
  if (!(await feld.count())) return false;
  await feld.click();
  await feld.fill(inhalt);
  await feld.press("Tab").catch(() => {});
  return (await feld.inputValue()).trim() === inhalt;
}

async function schreibeSchadentag(page, wert) {
  const feld = page.locator("[name='damageDate']").first();
  if (!(await feld.count())) return false;
  await feld.click();
  await feld.fill(wert);
  await feld.press("Tab").catch(() => {});
  const gelesen = datumSchluessel(await feld.inputValue());
  return gelesen !== "" && gelesen === datumSchluessel(wert);
}

async function erteilungSetzen(page, wert) {
  const ziel = String(wert || "").trim().toLowerCase();
  const label = page.locator("label").filter({ hasText: /^Erteilung\b/ }).first();
  if (!(await label.count())) throw new FachlichError("Erteilung");
  const control = label.locator("xpath=following::div[contains(@class,'-control')][1]");
  await control.click({ timeout: 15_000 });
  const optionen = page.locator("[role='option'], [id*='option']");
  await optionen.first().waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  const anzahl = await optionen.count();
  for (let index = 0; index < anzahl; index += 1) {
    const inhalt = (await optionen.nth(index).innerText()).replace(/\s+/g, " ").trim();
    if (inhalt.toLowerCase() === ziel) {
      await optionen.nth(index).click();
      await page.keyboard.press("Escape").catch(() => {});
      return;
    }
  }
  await page.keyboard.press("Escape").catch(() => {});
  throw new FachlichError("Erteilung");
}

async function finSuchen(page) {
  const vin = page.locator("[name='vehicle.vin']").first();
  await vin.click();
  await vin.press("Tab").catch(() => {});
  const knoepfe = vin.locator("xpath=following::button");
  const ende = Date.now() + 8_000;
  while (Date.now() < ende) {
    const anzahl = Math.min(await knoepfe.count(), 6);
    for (let index = 0; index < anzahl; index += 1) {
      const knopf = knoepfe.nth(index);
      if (!(await knopf.isVisible().catch(() => false))) continue;
      if (!(await knopf.isEnabled().catch(() => false))) continue;
      const klasse = String(await knopf.getAttribute("class").catch(() => "") || "");
      const titel = String(await knopf.getAttribute("title").catch(() => "") || "");
      if (/icon-only|btn-blue/.test(klasse) || /such|fin|fahrzeug|abfrag/i.test(titel)) {
        await knopf.click({ timeout: 8_000 });
        return;
      }
    }
    await page.waitForTimeout(300);
  }
  throw new FachlichError("FIN-Suche nicht klickbar");
}

async function auftragSchreiben(page, befehl) {
  await schliesseStoerungen(page);
  let geschrieben = 0;
  const paare = [
    ["licensePlate", befehl.kennzeichen],
    ["vehicle.vin", befehl.fin],
    ["damageNr", befehl.schadennummer],
    ["insuranceNr", befehl.versicherungsnummer],
    ["damageLocation", befehl.schadenort],
    ["damageStreet", befehl.schadenstrasse],
  ];
  for (const [name, inhalt] of paare) {
    if (await schreibeWennPasst(page, name, inhalt)) geschrieben += 1;
  }
  if (befehl.schadentag && await schreibeSchadentag(page, befehl.schadentag)) geschrieben += 1;
  await erteilungSetzen(page, befehl.erteilung || "telefonisch");
  if (await schreibeWennPasst(page, "orderPlacer", befehl.erteiltDurch || "den Auftraggeber")) {
    geschrieben += 1;
  } else {
    throw new FachlichError("Erteilt durch");
  }
  geschrieben += 1;
  if (befehl.sachverstaendiger) {
    try {
      await waehleFeld(page, "Sachverständiger", befehl.sachverstaendiger);
      geschrieben += 1;
    } catch {
      // Die Auswahl bleibt leer. Die übrigen Felder werden gespeichert.
    }
  }
  if (befehl.unfallgegner) {
    try {
      await versicherungAbfragen(page, befehl.unfallgegner);
      geschrieben += 1;
    } catch {
      const inhalt = await page.locator("[name='opponentLicensePlate']").first().inputValue().catch(() => "");
      if (String(inhalt).trim()) geschrieben += 1;
    }
  }
  if (!geschrieben) throw new FachlichError("Auftragsdaten fehlen");
}

async function versicherungAbfragen(page, kennzeichen) {
  await schliesseStoerungen(page);
  const feld = page.locator("[name='opponentLicensePlate']").first();
  await feld.waitFor({ state: "visible", timeout: 15000 });
  await feld.click();
  await feld.fill(kennzeichen);
  const gelesen = (await feld.inputValue()).trim();
  if (gelesen !== kennzeichen) throw new FachlichError("Unfallgegner-Kennzeichen");
  const suche = feld.locator("xpath=following::button[@title='Versicherungsdaten über Z@Online abfragen'][1]");
  await suche.waitFor({ state: "visible", timeout: 10000 });
  const bereit = await suche.isEnabled().catch(() => false);
  if (!bereit) {
    await page.waitForTimeout(500);
  }
  if (!(await suche.isEnabled().catch(() => false))) {
    throw new FachlichError("Versicherung über Kennzeichen nicht abgefragt");
  }
  await suche.click();
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  const dialog = page.locator(".modal-content, [role='dialog']").last();
  if (await dialog.isVisible().catch(() => false)) {
    const text = await dialog.innerText().catch(() => "");
    if (/nicht gefunden|kein Treffer|keine Daten/i.test(text)) {
      const zu = dialog.getByRole("button", { name: /Abbrechen|Schließen|OK/i }).first();
      if (await zu.count()) await zu.click().catch(() => {});
      throw new FachlichError("Versicherung zum Kennzeichen nicht gefunden");
    }
    const ja = dialog.getByRole("button", { name: /Übernehmen|Hinzufügen|Speichern/i }).first();
    if (await ja.count() && await ja.isVisible().catch(() => false)) await ja.click();
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  }
}

async function beteiligtenSchreiben(page, befehl) {
  await schliesseStoerungen(page);
  const knopf = page.getByRole("button", { name: /Neuer Beteiligter/i }).first();
  if (!(await knopf.count())) throw new NichtUmgesetztError("beteiligte");
  await knopf.click();
  await page.locator("[name='firstName']").first().waitFor({ state: "visible", timeout: 15000 });
  const beteiligung = beteiligungText(befehl.rolle);
  const kontakttyp = KONTAKTTYP[befehl.rolle];
  if (!beteiligung || !kontakttyp) throw new FachlichError(befehl.rolle || "Beteiligung");
  await waehleReactAuswahl(page, "__field_involvementTypes", beteiligung);
  await waehleReactAuswahl(page, "__field_type", kontakttyp);
  await waehleReactAuswahl(page, "__field_title", befehl.anrede);
  if (befehl.firma) {
    await schreibeFeld(page, "companyName", befehl.firma);
  } else {
    await schreibeFeld(page, "firstName", befehl.vorname);
    await schreibeFeld(page, "lastName", befehl.nachname);
    await schreibeFeld(page, "street", befehl.strasse);
    await schreibeFeld(page, "zipCode", befehl.plz);
    await schreibeFeld(page, "city", befehl.ort);
  }
  const hinzu = await sichtbarerKnopf(page, /^Hinzufügen$/i);
  if (!hinzu) throw new FachlichError("Hinzufügen nicht gefunden");
  await hinzu.click();
  await page.waitForURL((url) => !String(url).includes("/participants/edit"), { timeout: 20000 });
  await warteAufSeite(page);
}
