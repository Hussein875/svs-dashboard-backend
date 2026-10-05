import { FachlichError, NichtUmgesetztError } from "./fehler.js";
import { waehleModell, waehleOption } from "./eingabe-plan.js";

export const UNSICHERE_TYPEN = new Set(["skizze"]);

export async function fuehreSchritt(seite, schritt) {
  if (!schritt) throw new FachlichError("Schritt fehlt");
  if (schritt.fachlich) throw new FachlichError(schritt.fachlich);
  if (schritt.nichtUmgesetzt) throw new NichtUmgesetztError(schritt.id);
  for (const befehl of schritt.befehle || []) {
    if (UNSICHERE_TYPEN.has(befehl.typ)) throw new NichtUmgesetztError(schritt.id);
    await seite.ausfuehren(befehl);
  }
  if (schritt.speichern) {
    const pruefung = await seite.pruefe();
    if (!pruefung?.ok) throw new FachlichError("Rücklesen fehlgeschlagen");
    await seite.speichern();
  }
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

async function oeffneBesichtigungFallsLeer(page) {
  const ortsfeld = page.locator('[name="surveys.0.location"]').first();
  if (await ortsfeld.count() && await ortsfeld.isVisible().catch(() => false)) return;

  const muster = /Neue Besichtigung/i;
  const ziele = [
    page.getByRole("button", { name: muster }),
    page.getByRole("link", { name: muster }),
    page.locator("button, a, [role='button']").filter({ hasText: muster }),
    page.getByText(muster),
  ];
  let geklickt = false;
  for (const liste of ziele) {
    const ziel = liste.first();
    if (!(await ziel.count())) continue;
    if (!(await ziel.isVisible().catch(() => false))) continue;
    await ziel.scrollIntoViewIfNeeded().catch(() => {});
    await ziel.click();
    geklickt = true;
    break;
  }
  if (!geklickt) throw new FachlichError("Neue Besichtigung nicht gefunden");

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
        await page.goto(`${base}home/dossiers/edit/${dossierId}/${befehl.pfad}`, { waitUntil: "domcontentloaded" });
        await warteAufSeite(page);
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
        const suche = page.locator('[name="vehicle.vin"]').locator("xpath=following::button[2]");
        await suche.click();
        const optionen = await page.locator("[id*='option'], [role='option'], tr").allTextContents();
        const modell = waehleModell(optionen, befehl);
        if (!modell) throw new FachlichError("Modellauswahl nicht eindeutig");
        await page.getByText(modell, { exact: false }).first().click();
        werte.set("vehicle.vin", befehl.fin);
        werte.set("modell", modell);
        return;
      }
      if (befehl.typ === "beteiligter") {
        await beteiligtenSchreiben(page, befehl);
        werte.set(befehl.rolle, befehl.firma || `${befehl.vorname} ${befehl.nachname}`);
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
      await page.locator("button").filter({ hasText: "Speichern" }).last().click();
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      werte.clear();
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

  const formGroup = page.locator(".form-group, .form-row, .row").filter({
    has: page.locator("label", { hasText: new RegExp(escaped, "i") }),
  }).first();

  const klickZiele = [
    formGroup.locator(".select2-selection").first(),
    formGroup.locator("div.control").first(),
    formGroup.locator("select").first(),
    page.locator("label").filter({ hasText: new RegExp(escaped, "i") })
      .locator("xpath=following::div[contains(@class,'control')][1]"),
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
  const treffer = waehleOption(optionen, wert);
  if (!treffer) throw new FachlichError(feld);
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

async function beteiligtenSchreiben(page, befehl) {
  const knopf = page.getByRole("button", { name: /Neuer Beteiligter|Beteiligten hinzufügen|Hinzufügen/i }).first();
  if (!(await knopf.count())) throw new NichtUmgesetztError("beteiligte");
  await knopf.click();
  await waehleFeld(page, "Anrede", befehl.anrede);
  if (befehl.firma) {
    const feld = page.getByLabel(/Firma|Name/i).first();
    await feld.fill(befehl.firma);
    return;
  }
  await page.getByLabel("Vorname", { exact: true }).fill(befehl.vorname);
  await page.getByLabel("Nachname", { exact: true }).fill(befehl.nachname);
  await page.getByLabel("Straße, Nr.", { exact: true }).fill(befehl.strasse);
  await page.getByLabel("PLZ / Ort", { exact: true }).fill(`${befehl.plz} ${befehl.ort}`);
}
