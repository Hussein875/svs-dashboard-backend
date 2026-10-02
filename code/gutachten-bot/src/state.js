import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { SCHRITTE, schrittById, schritteDerPhase } from "./schritte.js";

const STAND_NEU = "neu";

export class VorgangGesperrtError extends Error {
  constructor(nummer) {
    super(`Akte ${nummer} wird bereits bearbeitet.`);
    this.name = "VorgangGesperrtError";
    this.code = "VORGANG_GESPERRT";
  }
}

function now() {
  return new Date().toISOString();
}

export function openState(dbPath) {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS vorgang (
      nummer TEXT PRIMARY KEY,
      stand TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS schritt (
      nummer TEXT NOT NULL,
      schritt_id TEXT NOT NULL,
      status TEXT NOT NULL,
      erledigt_at TEXT,
      PRIMARY KEY (nummer, schritt_id)
    );
    CREATE TABLE IF NOT EXISTS vorgang_lock (
      nummer TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      acquired_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS extrakt (
      nummer TEXT NOT NULL,
      quelle TEXT NOT NULL,
      json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (nummer, quelle)
    );
    CREATE TABLE IF NOT EXISTS eingabe_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nummer TEXT NOT NULL,
      datensatz TEXT NOT NULL,
      bericht TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      started_at TEXT
    );
  `);
  return db;
}

export function closeState(db) {
  db.close();
}

function ensureVorgang(db, nummer) {
  const existing = db.prepare("SELECT nummer FROM vorgang WHERE nummer = ?").get(nummer);
  if (existing) return;
  db.prepare("INSERT INTO vorgang (nummer, stand, updated_at) VALUES (?, ?, ?)").run(
    nummer,
    STAND_NEU,
    now(),
  );
}

export function listVorgaenge(db) {
  return db.prepare(
    "SELECT nummer, stand, updated_at AS updatedAt FROM vorgang ORDER BY updated_at DESC",
  ).all();
}

export function getVorgang(db, nummer) {
  ensureVorgang(db, nummer);
  const row = db.prepare("SELECT nummer, stand, updated_at FROM vorgang WHERE nummer = ?").get(nummer);
  const schritte = Object.fromEntries(SCHRITTE.map((schritt) => [schritt.id, "offen"]));
  const saved = db.prepare(
    "SELECT schritt_id, status FROM schritt WHERE nummer = ?",
  ).all(nummer);
  for (const entry of saved) {
    if (entry.schritt_id in schritte) schritte[entry.schritt_id] = entry.status;
  }
  return {
    nummer: row.nummer,
    stand: row.stand,
    updatedAt: row.updated_at,
    schritte,
  };
}

function setStand(db, nummer, stand) {
  db.prepare("UPDATE vorgang SET stand = ?, updated_at = ? WHERE nummer = ?").run(
    stand,
    now(),
    nummer,
  );
}

function phaseErledigt(vorgang, phase) {
  return schritteDerPhase(phase).every((schritt) => vorgang.schritte[schritt.id] === "erledigt");
}

function refreshStand(db, nummer) {
  const vorgang = getVorgang(db, nummer);
  if (vorgang.schritte.abschluss === "erledigt") {
    setStand(db, nummer, "abgeschlossen");
    return "abgeschlossen";
  }
  if (phaseErledigt(vorgang, "eingabe")) {
    setStand(db, nummer, "eingetippt");
    return "eingetippt";
  }
  if (vorgang.schritte["pflichtfelder-pruefen"] === "erledigt") {
    setStand(db, nummer, "geprueft");
    return "geprueft";
  }
  if (vorgang.stand === "wartet_auf_eingabe") return vorgang.stand;
  const analyseOhnePruefung = schritteDerPhase("analyse")
    .filter((schritt) => schritt.id !== "pflichtfelder-pruefen" && schritt.id !== "report-schreiben");
  if (analyseOhnePruefung.every((schritt) => vorgang.schritte[schritt.id] === "erledigt")) {
    setStand(db, nummer, "eingelesen");
    return "eingelesen";
  }
  return vorgang.stand;
}

function isErledigt(db, nummer, schrittId) {
  const row = db.prepare(
    "SELECT status FROM schritt WHERE nummer = ? AND schritt_id = ?",
  ).get(nummer, schrittId);
  return row?.status === "erledigt";
}

function markErledigt(db, nummer, schrittId) {
  db.prepare(`
    INSERT INTO schritt (nummer, schritt_id, status, erledigt_at)
    VALUES (?, ?, 'erledigt', ?)
    ON CONFLICT (nummer, schritt_id)
    DO UPDATE SET status = 'erledigt', erledigt_at = excluded.erledigt_at
  `).run(nummer, schrittId, now());
  refreshStand(db, nummer);
}

export function acquireLock(db, nummer, owner) {
  ensureVorgang(db, nummer);
  const existing = db.prepare("SELECT owner FROM vorgang_lock WHERE nummer = ?").get(nummer);
  if (existing?.owner === owner) return;
  if (existing) throw new VorgangGesperrtError(nummer);
  try {
    db.prepare(
      "INSERT INTO vorgang_lock (nummer, owner, acquired_at) VALUES (?, ?, ?)",
    ).run(nummer, owner, now());
  } catch (error) {
    if (String(error?.message || error).includes("UNIQUE") || String(error?.code) === "ERR_SQLITE_ERROR") {
      const held = db.prepare("SELECT owner FROM vorgang_lock WHERE nummer = ?").get(nummer);
      if (held?.owner === owner) return;
      throw new VorgangGesperrtError(nummer);
    }
    throw error;
  }
}

export function releaseLock(db, nummer, owner) {
  db.prepare("DELETE FROM vorgang_lock WHERE nummer = ? AND owner = ?").run(nummer, owner);
}

export function setWartetAufEingabe(db, nummer) {
  ensureVorgang(db, nummer);
  setStand(db, nummer, "wartet_auf_eingabe");
}

export async function withVorgang(db, nummer, owner, fn) {
  acquireLock(db, nummer, owner);
  try {
    return await fn(createContext(db, nummer, owner));
  } finally {
    releaseLock(db, nummer, owner);
  }
}

function createContext(db, nummer, owner) {
  return {
    nummer,
    stand() {
      return getVorgang(db, nummer);
    },
    async runSchritt(schrittId, fn) {
      schrittById(schrittId);
      acquireLock(db, nummer, owner);
      if (isErledigt(db, nummer, schrittId)) {
        return { skipped: true, schrittId };
      }
      await fn();
      markErledigt(db, nummer, schrittId);
      return { skipped: false, schrittId, stand: getVorgang(db, nummer).stand };
    },
  };
}
