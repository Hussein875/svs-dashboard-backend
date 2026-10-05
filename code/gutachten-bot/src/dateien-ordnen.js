const VIDEO = /\.(mp4|mov|avi|m4v)$/i;

function istVideo(datei) {
  const mime = String(datei.mimeType || "");
  return mime.startsWith("video/") || VIDEO.test(datei.name || "");
}

function istBild(datei) {
  const mime = String(datei.mimeType || "");
  return mime.startsWith("image/") || /\.(jpe?g|png|heic|webp)$/i.test(datei.name || "");
}

function istPdf(datei) {
  return datei.mimeType === "application/pdf" || /\.pdf$/i.test(datei.name || "");
}

function imOrdner(datei, muster) {
  return muster.test(String(datei.ordner || ""));
}

export function ordneDateien(dateien) {
  const bd = [];
  const ae = [];
  const vollmacht = [];
  const fotos = [];
  for (const datei of dateien || []) {
    if (istVideo(datei) || imOrdner(datei, /fotos\s*2/i)) continue;
    const name = String(datei.name || "");
    if (/\bvollmacht\b/i.test(name)) {
      vollmacht.push(datei);
      continue;
    }
    if (istPdf(datei) && (/\bBD\b/i.test(name) || /besichtigung/i.test(name))) {
      bd.push(datei);
      continue;
    }
    if (istPdf(datei) && (/\bAE\b/i.test(name) || /abtretung/i.test(name))) {
      ae.push(datei);
      continue;
    }
    if (istBild(datei)) fotos.push(datei);
  }
  fotos.sort((links, rechts) => String(links.name).localeCompare(String(rechts.name), "de"));
  return { bd, ae, vollmacht, fotos };
}
