import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import trigger from "../regeln/schaden-trigger.json" with { type: "json" };

const TOKEN = "https://oauth2.googleapis.com/token";
const MODELL = "gemini-2.5-flash";

function b64url(wert) {
  const roh = Buffer.isBuffer(wert) ? wert : Buffer.from(wert);
  return roh.toString("base64url");
}

async function zugang(datei) {
  const konto = JSON.parse(await readFile(datei, "utf8"));
  const jetzt = Math.floor(Date.now() / 1000);
  const kopf = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const anspruch = b64url(JSON.stringify({
    iss: konto.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: TOKEN,
    iat: jetzt,
    exp: jetzt + 3600,
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
  return payload.access_token;
}

export function schadenKuerzel() {
  return trigger.map((eintrag) => eintrag.kuerzel).filter((wert) => wert && wert !== "div");
}

export async function frageGemini(text, dateien = []) {
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
  const antwort = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { temperature: 0, responseMimeType: "application/json", maxOutputTokens: 8192 },
    }),
    signal: AbortSignal.timeout(180000),
  });
  if (!antwort.ok) {
    const roh = await antwort.text();
    let grund = roh.slice(0, 180);
    try {
      grund = JSON.parse(roh).error?.message || grund;
    } catch {
      // Die Antwort ist kein JSON.
    }
    throw new Error(`Lesung fehlgeschlagen (${antwort.status}): ${grund}`);
  }
  const payload = await antwort.json();
  const inhalt = payload.candidates?.[0]?.content?.parts?.map((teil) => teil.text || "").join("") || "";
  return JSON.parse(inhalt);
}
