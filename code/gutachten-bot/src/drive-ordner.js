import { readFile } from "node:fs/promises";
import path from "node:path";
import { driveToken } from "./drive-foto.js";
import { leseOrdnerNamen, loeseVorgangsNummer } from "./ordner.js";

const DRIVE = "https://www.googleapis.com/drive/v3/files";

function slugAusNummer(nummer) {
  return String(nummer || "").trim().replace(/\//g, "-");
}

async function apiGet(url, token) {
  const antwort = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!antwort.ok) {
    const text = await antwort.text().catch(() => "");
    throw new Error(`Drive-API fehlgeschlagen (${antwort.status}): ${text.slice(0, 200)}`);
  }
  return antwort.json();
}

async function ladeText(dateiId, token) {
  const url = `${DRIVE}/${encodeURIComponent(dateiId)}?alt=media&supportsAllDrives=true`;
  const antwort = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!antwort.ok) throw new Error("Drive-Datei konnte nicht geladen werden");
  return antwort.text();
}

export async function listeOrdnerDateien(folderId, token = driveToken) {
  const zugang = await token();
  const id = String(folderId || "").trim();
  if (!id) throw new Error("Drive-Ordner-ID fehlt");

  const dateien = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({
      q: `'${id}' in parents and trashed=false`,
      fields: "nextPageToken,files(id,name,mimeType,size)",
      pageSize: "200",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const payload = await apiGet(`${DRIVE}?${params}`, zugang);
    dateien.push(...(payload.files || []));
    pageToken = payload.nextPageToken || "";
  } while (pageToken);

  return dateien;
}

export async function leseOrdnerMeta(folderId, token = driveToken) {
  const zugang = await token();
  const id = String(folderId || "").trim();
  if (!id) throw new Error("Drive-Ordner-ID fehlt");
  const payload = await apiGet(
    `${DRIVE}/${encodeURIComponent(id)}?fields=id,name&supportsAllDrives=true`,
    zugang,
  );
  const { nummer, kuerzel } = leseOrdnerNamen(payload.name || "");
  return { id, name: payload.name || "", nummer, kuerzel };
}

function waehleJson(dateien, nummer, suffix) {
  const slug = slugAusNummer(nummer);
  const exakt = `${slug}-${suffix}.json`.toLowerCase();
  const treffer = dateien.filter((datei) => {
    const name = String(datei.name || "").toLowerCase();
    return name === exakt || name.endsWith(`-${suffix}.json`);
  });
  if (treffer.length === 1) return treffer[0];
  if (treffer.length > 1) {
    const passend = treffer.find((datei) => datei.name.toLowerCase() === exakt);
    if (passend) return passend;
    throw new Error(`Mehrere *-${suffix}.json im Drive-Ordner`);
  }
  return null;
}

async function ladeLokaleJson(nummer, suffix) {
  const basis = String(process.env.GUTACHTEN_DATA_DIR || "").trim();
  if (!basis) return null;
  const slug = slugAusNummer(nummer);
  const ziel = path.join(basis, `${slug}-${suffix}.json`);
  try {
    return JSON.parse(await readFile(ziel, "utf8"));
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

export async function leseExtraktionen({ folderId, nummer, token = driveToken }) {
  const ziel = String(nummer || "").trim();
  if (!ziel) throw new Error("Aktenzeichen fehlt");

  const meta = await leseOrdnerMeta(folderId, token);
  const dateien = await listeOrdnerDateien(folderId, token);
  const vorgangsNummer = loeseVorgangsNummer(ziel, meta.nummer);

  const zugang = await token();
  const bdDatei = waehleJson(dateien, vorgangsNummer, "bd");
  const aeDatei = waehleJson(dateien, vorgangsNummer, "ae");
  const scheinDatei = waehleJson(dateien, vorgangsNummer, "schein");

  let bd = bdDatei ? JSON.parse(await ladeText(bdDatei.id, zugang)) : null;
  let ae = aeDatei ? JSON.parse(await ladeText(aeDatei.id, zugang)) : null;
  let schein = scheinDatei ? JSON.parse(await ladeText(scheinDatei.id, zugang)) : null;

  if (!bd) bd = await ladeLokaleJson(vorgangsNummer, "bd");
  if (!ae) ae = await ladeLokaleJson(vorgangsNummer, "ae");
  if (!schein) schein = await ladeLokaleJson(vorgangsNummer, "schein");

  if (!bd && !ae) {
    throw new Error(
      "Keine Gutachten-Lesung im Drive-Ordner (erwartet z. B. 2102-26-bd.json und 2102-26-ae.json).",
    );
  }

  return { meta, bd, ae, schein, vorgangsNummer };
}
