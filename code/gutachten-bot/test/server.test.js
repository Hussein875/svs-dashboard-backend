import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { analysiere } from "../src/pipeline.js";
import { eingeben } from "../src/phase2.js";
import { createApp } from "../src/server.js";
import { closeState, openState } from "../src/state.js";

function neueDb() {
  const dir = mkdtempSync(path.join(tmpdir(), "gutachten-server-"));
  return openState(path.join(dir, "state.sqlite"));
}

function hoeren(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

test("ohne Anmeldung kein Start, mit PIN kommt der Live-Schritt", async () => {
  const db = neueDb();
  const server = createApp({
    db,
    pin: "2468",
    starteEingabe: (state, log) => eingeben(state, {
      auftrag: async () => {},
      besichtigung: async () => {},
      beteiligte: async () => {},
      fahrzeug: async () => {},
      bereifung: async () => {},
      "vor-ort": async () => {},
      vorschaeden: async () => {},
      schadenfeststellung: async () => {},
      "dokumente-import": async () => {},
      lichtbilder: async () => {},
    }, { fortsetzen: true, log, sleep: async () => {}, owner: "ui" }),
  });
  const port = await hoeren(server);
  try {
    await analysiere(db, {
      nummer: "2300/26",
      dokumente: async () => ({
        fahrzeugschein: { vorhanden: true, lesbar: true },
        kennzeichen: { wert: "HH-AB 123", lesbar: true },
        vorschaeden: { angegeben: true, lesbar: true },
        auftraggeber: {
          anrede: "Frau",
          name: "Test",
          strasse: "Weg 1",
          plz: "20095",
          ort: "Hamburg",
          lesbar: true,
        },
      }),
      fotos: async () => ({
        kilometerstand: { wert: "10", lesbar: true },
        schadenfotos: {
          vorneLinks: true,
          vorneRechts: true,
          hintenRechts: true,
          hintenLinks: true,
        },
      }),
    });

    const gesperrt = await fetch(`http://127.0.0.1:${port}/api/start`, { method: "POST" });
    assert.equal(gesperrt.status, 401);

    const login = await fetch(`http://127.0.0.1:${port}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin: "2468" }),
    });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const start = await fetch(`http://127.0.0.1:${port}/api/start`, {
      method: "POST",
      headers: { cookie },
    });
    assert.equal(start.status, 202);

    await new Promise((resolve) => setTimeout(resolve, 80));
    const controller = new AbortController();
    const ereignisse = await fetch(`http://127.0.0.1:${port}/api/ereignisse`, {
      headers: { cookie },
      signal: controller.signal,
    });
    const reader = ereignisse.body.getReader();
    let text = "";
    const timeout = setTimeout(() => controller.abort(), 1000);
    try {
      while (!text.includes("2300/26")) {
        const chunk = await reader.read();
        if (chunk.done) break;
        text += Buffer.from(chunk.value).toString();
      }
    } catch (error) {
      if (error.name !== "AbortError") throw error;
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
    assert.match(text, /2300\/26/);
    assert.equal(text.includes("HH-AB 123"), false);
    assert.equal(text.includes("Hamburg"), false);
  } finally {
    server.close();
    closeState(db);
  }
});
