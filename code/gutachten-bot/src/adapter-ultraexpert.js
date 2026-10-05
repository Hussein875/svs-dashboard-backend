import { EINGABE } from "./phase2.js";
import { eingabePlan } from "./eingabe-plan.js";
import { fuehreSchritt } from "./ultraexpert-seite.js";

export function createUltraExpertAdapter({ seite, oeffnen } = {}) {
  let aktiv = seite || null;
  let session = null;
  let nummer = "";

  async function schritt(id, datensatz) {
    const plan = eingabePlan(datensatz);
    return fuehreSchritt(aktiv, plan[id]);
  }

  const methoden = {
    async vorbereiten(naechste) {
      nummer = naechste;
      if (!aktiv) {
        if (seite) {
          aktiv = seite;
        } else {
          session = await (oeffnen || oeffneUltraExpert)();
          aktiv = session.seite;
        }
      }
      await aktiv.oeffneAkte(nummer);
    },
    async abschliessen() {
      await session?.schliessen?.();
      session = null;
    },
  };
  for (const id of EINGABE) {
    methoden[id] = (datensatz) => schritt(id, datensatz);
  }
  return methoden;
}

export async function oeffneUltraExpert() {
  const { chromium } = await import("playwright");
  const { createPlaywrightSeite } = await import("./ultraexpert-seite.js");
  const browser = await chromium.launch({
    headless: process.env.UX_HEADLESS !== "false",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  page.setDefaultTimeout(Number(process.env.UX_TIMEOUT_MS || 30000));
  await meldeAn(page);
  return {
    seite: createPlaywrightSeite(page),
    async schliessen() {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };
}

async function meldeAn(page) {
  const url = String(process.env.UX_URL || "https://ux.winvalue.de/ux/");
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const kunde = page.locator("#customerNr, input[name='customerNr']").first();
  if (!(await kunde.count()) || !(await kunde.isVisible().catch(() => false))) return;
  const kundenNr = process.env.UX_USERNAME || process.env.UX_CUSTOMER_NR || "";
  await kunde.fill(kundenNr);
  await page.locator("input[type='password']").first().fill(process.env.UX_PASSWORD || "");
  const mandant = page.locator("input[name='mandant']").first();
  if (process.env.UX_MANDANT && await mandant.count()) await mandant.fill(process.env.UX_MANDANT);
  await page.getByRole("button", { name: /Anmelden|Login/i }).first().click();
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
}
