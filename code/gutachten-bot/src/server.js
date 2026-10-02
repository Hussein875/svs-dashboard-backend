import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createUltraExpertAdapter } from "./adapter-ultraexpert.js";
import { schreibeLog } from "./log.js";
import { eingeben } from "./phase2.js";
import { listVorgaenge, openState } from "./state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sessions = new Set();
const clients = new Set();
const verlauf = [];
let lauf = null;

function pinPasst(eingabe, erwartet) {
  const links = Buffer.from(String(eingabe));
  const rechts = Buffer.from(String(erwartet));
  if (links.length !== rechts.length || rechts.length === 0) return false;
  return timingSafeEqual(links, rechts);
}

function cookieSession(header) {
  const treffer = String(header || "").match(/(?:^|;\s*)gutachten_session=([^;]+)/);
  return treffer ? decodeURIComponent(treffer[1]) : "";
}

function sende(res, status, body, headers = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": typeof body === "string" ? "text/html; charset=utf-8" : "application/json; charset=utf-8",
    ...headers,
  });
  res.end(payload);
}

function broadcast(zeile, ereignis) {
  verlauf.push(ereignis);
  if (verlauf.length > 200) verlauf.shift();
  const data = `data: ${zeile}\n\n`;
  for (const client of clients) client.write(data);
}

function seite() {
  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Gutachten-Bot</title>
  <style>
    body { font-family: sans-serif; margin: 24px; background: #f4f6f8; color: #142033; }
    button, input { font: inherit; }
    button { background: #2457d6; color: white; border: 0; border-radius: 8px; padding: 8px 14px; cursor: pointer; }
    input { padding: 8px 10px; border: 1px solid #c5ceda; border-radius: 8px; }
    ul { list-style: none; padding: 0; }
    li { background: white; margin: 8px 0; padding: 10px 12px; border-radius: 10px; }
    .laeuft { border-left: 4px solid #2457d6; }
    .erledigt { border-left: 4px solid #15803d; }
    .wartet { border-left: 4px solid #b45309; }
    .fehler { border-left: 4px solid #b91c1c; }
  </style>
</head>
<body>
  <h1>Gutachten-Bot</h1>
  <form id="login">
    <input id="pin" type="password" inputmode="numeric" maxlength="8" placeholder="PIN" aria-label="PIN">
    <button type="submit">Anmelden</button>
    <p id="loginFehler"></p>
  </form>
  <section id="arbeit" hidden>
    <button id="start" type="button">Eingabe starten</button>
    <p id="startHinweis"></p>
    <ul id="liste"></ul>
  </section>
  <script>
    const login = document.querySelector("#login");
    const arbeit = document.querySelector("#arbeit");
    const liste = document.querySelector("#liste");
    function zeige(eintrag) {
      const li = document.createElement("li");
      li.className = eintrag.status || "";
      li.textContent = eintrag.nummer + " · " + eintrag.schritt + " · " + eintrag.status;
      liste.prepend(li);
    }
    login.addEventListener("submit", async (event) => {
      event.preventDefault();
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin: document.querySelector("#pin").value })
      });
      if (!res.ok) {
        document.querySelector("#loginFehler").textContent = "PIN falsch";
        return;
      }
      login.hidden = true;
      arbeit.hidden = false;
      const quelle = new EventSource("/api/ereignisse");
      quelle.onmessage = (event) => zeige(JSON.parse(event.data));
    });
    document.querySelector("#start").addEventListener("click", async () => {
      const hinweis = document.querySelector("#startHinweis");
      hinweis.textContent = "Startet…";
      const res = await fetch("/api/start", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      hinweis.textContent = data.meldung || (res.ok ? "Gestartet" : "Start fehlgeschlagen");
    });
  </script>
</body>
</html>`;
}

export function createApp({ db, pin, starteEingabe }) {
  return createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    const session = cookieSession(req.headers.cookie);
    const angemeldet = sessions.has(session);

    if (req.method === "GET" && url.pathname === "/") {
      sende(res, 200, seite());
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/login") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      if (!pinPasst(body.pin, pin)) {
        sende(res, 401, { ok: false });
        return;
      }
      const token = randomBytes(24).toString("hex");
      sessions.add(token);
      sende(res, 200, { ok: true }, {
        "set-cookie": `gutachten_session=${token}; HttpOnly; SameSite=Lax; Path=/`,
      });
      return;
    }

    if (!angemeldet) {
      sende(res, 401, { ok: false });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/vorgaenge") {
      sende(res, 200, { ok: true, vorgaenge: listVorgaenge(db) });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/ereignisse") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      for (const eintrag of verlauf) res.write(`data: ${JSON.stringify(eintrag)}\n\n`);
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/start") {
      if (!starteEingabe) {
        sende(res, 409, { ok: false, meldung: "Die Klickstrecke in UltraExpert ist noch nicht angeschlossen. Es wurde nichts geändert." });
        return;
      }
      if (lauf) {
        sende(res, 409, { ok: false, meldung: "Es läuft bereits eine Eingabe." });
        return;
      }
      sende(res, 202, { ok: true, meldung: "Eingabe gestartet." });
      lauf = starteEingabe(db, (zeile, ereignis) => broadcast(zeile, ereignis))
        .finally(() => {
          lauf = null;
        });
      return;
    }

    sende(res, 404, { ok: false });
  });
}

export function startServer({ db, pin, starteEingabe, port = 3090 } = {}) {
  if (!pin) throw new Error("GUTACHTEN_UI_PIN fehlt.");
  const server = createApp({ db, pin, starteEingabe });
  return new Promise((resolve) => {
    server.listen(port, () => resolve(server));
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const dbPath = process.env.GUTACHTEN_DB || path.join(__dirname, "../data/gutachten.sqlite");
  const db = openState(dbPath);
  startServer({
    db,
    pin: process.env.GUTACHTEN_UI_PIN || "",
    port: Number(process.env.GUTACHTEN_PORT || 3090),
    starteEingabe: process.env.UX_USERNAME && process.env.UX_PASSWORD
      ? async (db, log) => {
        try {
          await import("playwright");
        } catch {
          schreibeLog(log, { nummer: "", schritt: "eingabe", status: "fehler" });
          return { gestartet: false };
        }
        const ergebnis = await eingeben(db, createUltraExpertAdapter(), { fortsetzen: true, log });
        if (!ergebnis.gestartet && !ergebnis.nummer) {
          schreibeLog(log, { nummer: "", schritt: "warteschlange", status: "wartet" });
        }
        return ergebnis;
      }
      : null,
  }).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
