import { spawn } from "node:child_process";
import { createSign } from "node:crypto";
import { createWriteStream } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const SKRIPT = fileURLToPath(new URL("./foto_klein.py", import.meta.url));
const DRIVE = "https://www.googleapis.com/drive/v3/files";
const TOKEN = "https://oauth2.googleapis.com/token";

function b64url(wert) {
  const roh = Buffer.isBuffer(wert) ? wert : Buffer.from(wert);
  return roh.toString("base64url");
}

async function tokenAusDienstkonto(datei) {
  const konto = JSON.parse(await readFile(datei, "utf8"));
  const jetzt = Math.floor(Date.now() / 1000);
  const kopf = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const anspruch = b64url(JSON.stringify({
    iss: konto.client_email,
    scope: "https://www.googleapis.com/auth/drive.readonly",
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
  if (!antwort.ok) throw new Error("Drive-Anmeldung fehlgeschlagen");
  return (await antwort.json()).access_token;
}

async function tokenAusRefresh() {
  const antwort = await fetch(TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GUTACHTEN_DRIVE_CLIENT_ID,
      client_secret: process.env.GUTACHTEN_DRIVE_CLIENT_SECRET,
      refresh_token: process.env.GUTACHTEN_DRIVE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  if (!antwort.ok) throw new Error("Drive-Anmeldung fehlgeschlagen");
  return (await antwort.json()).access_token;
}

export async function driveToken() {
  const dienstkonto = process.env.GUTACHTEN_DRIVE_CREDENTIALS
    || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (dienstkonto) {
    return tokenAusDienstkonto(dienstkonto);
  }
  if (process.env.GUTACHTEN_DRIVE_REFRESH_TOKEN) return tokenAusRefresh();
  throw new Error("Drive-Zugang fehlt");
}

export function komprimiere(quelle, ziel) {
  return new Promise((resolve, reject) => {
    const vorgang = spawn("python3", [SKRIPT, quelle, ziel], { stdio: ["ignore", "pipe", "pipe"] });
    let ausgabe = "";
    let fehler = "";
    vorgang.stdout.on("data", (stück) => { ausgabe += stück; });
    vorgang.stderr.on("data", (stück) => { fehler += stück; });
    vorgang.on("close", (code) => {
      if (code !== 0) reject(new Error(fehler || "Vorschau fehlgeschlagen"));
      else resolve(JSON.parse(ausgabe));
    });
  });
}

export async function ladeVorschau(dateiId, ziel, token = driveToken) {
  const zugang = await token();
  const adresse = `${DRIVE}/${encodeURIComponent(dateiId)}?alt=media&supportsAllDrives=true`;
  const antwort = await fetch(adresse, { headers: { authorization: `Bearer ${zugang}` } });
  if (!antwort.ok || !antwort.body) throw new Error("Foto konnte nicht geladen werden");
  const roh = path.join(tmpdir(), `gutachten-${dateiId}.jpg`);
  await pipeline(antwort.body, createWriteStream(roh));
  try {
    return await komprimiere(roh, ziel);
  } finally {
    await rm(roh, { force: true });
  }
}
