import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import trigger from "../regeln/schaden-trigger.json" with { type: "json" };

const TOKEN = "https://oauth2.googleapis.com/token";
const MODELL = "gemini-2.5-flash";
const MAX_PARALLEL = Number.parseInt(process.env.GEMINI_MAX_PARALLEL || "2", 10);
const MAX_VERSUCHE = Number.parseInt(process.env.GEMINI_RETRY_MAX || "7", 10);
const WARTE_MS = [4000, 8000, 15000, 25000, 40000, 60000, 90000];

let tokenCache = { wert: "", bis: 0 };
const warteschlange = [];
let laufend = 0;

function b64url(wert) {
  const roh = Buffer.isBuffer(wert) ? wert : Buffer.from(wert);
  return roh.toString("base64url");
}

function schlafe(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function istGeminiRateLimit(status) {
  return status === 429 || status === 503 || status === 504;
}

async function zugang(datei) {
  const jetzt = Date.now();
  if (tokenCache.wert && tokenCache.bis > jetzt + 60_000) return tokenCache.wert;

  const konto = JSON.parse(await readFile(datei, "utf8"));
  const sek = Math.floor(jetzt / 1000);
  const kopf = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const anspruch = b64url(JSON.stringify({
    iss: konto.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: TOKEN,
    iat: sek,
    exp: sek + 3600,
  }));
  const unsigniert = `${kopf}.${anspruch}`;
  const signatur = createSign("RSA-SHA256").update(unsigniert).sign(konto.private_key);
  const antwort = await fetch(TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigniert}.${b64url(signatur)}`,
    }),
  });
  if (!antwort.ok) throw new Error("Gemini-Anmeldung fehlgeschlagen");
  const payload = await antwort.json();
  tokenCache = {
    wert: payload.access_token,
    bis: jetzt + (payload.expires_in || 3600) * 1000,
  };
  return tokenCache.wert;
}

function pumpGeminiQueue() {
  while (laufend < MAX_PARALLEL && warteschlange.length > 0) {
    const { task, resolve, reject } = warteschlange.shift();
    laufend += 1;
    task()
      .then(resolve, reject)
      .finally(() => {
        laufend -= 1;
        pumpGeminiQueue();
      });
  }
}

function inGeminiQueue(task) {
  return new Promise((resolve, reject) => {
    warteschlange.push({ task, resolve, reject });
    pumpGeminiQueue();
  });
}

export function schadenKuerzel() {
  return trigger.map((eintrag) => eintrag.kuerzel).filter((wert) => wert && wert !== "div");
}

async function frageGeminiDirekt(text, dateien = []) {
  const quelle = process.env.GUTACHTEN_DRIVE_CREDENTIALS || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!quelle) throw new Error("Drive-Zugang fehlt");
  const token = await zugang(quelle);
  const projekt = process.env.GUTACHTEN_VERTEX_PROJECT || "svs-app-864ed";
  const parts = [{ text }];
  for (const datei of dateien) {
    parts.push({ text: `Datei ${datei.name}` });
    parts.push({
      inlineData: {
        mimeType: datei.mimeType,
        data: Buffer.from(datei.bytes).toString("base64"),
      },
    });
  }
  const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projekt}/locations/us-central1/publishers/google/models/${MODELL}:generateContent`;
  const body = JSON.stringify({
    contents: [{ role: "user", parts }],
    generationConfig: { temperature: 0, responseMimeType: "application/json", maxOutputTokens: 8192 },
  });

  let letzterFehler = null;
  for (let versuch = 1; versuch <= MAX_VERSUCHE; versuch += 1) {
    const antwort = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(180000),
    });
    if (antwort.ok) {
      const payload = await antwort.json();
      const inhalt = payload.candidates?.[0]?.content?.parts?.map((teil) => teil.text || "").join("") || "";
      return JSON.parse(inhalt);
    }

    const roh = await antwort.text();
    let grund = roh.slice(0, 220);
    try {
      grund = JSON.parse(roh).error?.message || grund;
    } catch {
      // Die Antwort ist kein JSON.
    }
    letzterFehler = new Error(`Lesung fehlgeschlagen (${antwort.status}): ${grund}`);

    if (!istGeminiRateLimit(antwort.status) || versuch >= MAX_VERSUCHE) break;
    const pause = WARTE_MS[Math.min(versuch - 1, WARTE_MS.length - 1)];
    await schlafe(pause + Math.floor(Math.random() * 2000));
  }

  throw letzterFehler || new Error("Lesung fehlgeschlagen");
}

export async function frageGemini(text, dateien = []) {
  return inGeminiQueue(() => frageGeminiDirekt(text, dateien));
}
