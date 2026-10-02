export function logZeile({ nummer, schritt, status, zeit = new Date().toISOString() }) {
  return JSON.stringify({
    zeit,
    nummer: String(nummer || ""),
    schritt: String(schritt || ""),
    status: String(status || ""),
  });
}

export function schreibeLog(emit, ereignis) {
  const zeile = logZeile(ereignis);
  if (emit) emit(zeile, JSON.parse(zeile));
  return zeile;
}
