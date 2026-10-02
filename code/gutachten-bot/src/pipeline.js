import { berichtText, pruefePflichtfelder } from "./pflichtfelder.js";
import { getVorgang, setWartetAufEingabe, withVorgang } from "./state.js";

function now() {
  return new Date().toISOString();
}

function speichereExtrakt(db, nummer, quelle, wert) {
  db.prepare(`
    INSERT INTO extrakt (nummer, quelle, json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (nummer, quelle)
    DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at
  `).run(nummer, quelle, JSON.stringify(wert ?? {}), now());
}

function leseExtrakt(db, nummer, quelle) {
  const row = db.prepare(
    "SELECT json FROM extrakt WHERE nummer = ? AND quelle = ?",
  ).get(nummer, quelle);
  if (!row) return {};
  return JSON.parse(row.json);
}

function zusammenfuegen(dokumente, fotos) {
  return {
    ...dokumente,
    ...fotos,
    schadenfotos: fotos.schadenfotos ?? dokumente.schadenfotos,
  };
}

export async function analysiere(db, auftrag) {
  const nummer = String(auftrag?.nummer || "").trim();
  if (!nummer) throw new Error("Vorgangsnummer fehlt.");
  const owner = auftrag.owner || `phase1-${process.pid}`;

  return withVorgang(db, nummer, owner, async (akte) => {
    await Promise.all([
      akte.runSchritt("dokumente-lesen", async () => {
        speichereExtrakt(db, nummer, "dokumente", await auftrag.dokumente());
      }),
      akte.runSchritt("fotos-auswerten", async () => {
        speichereExtrakt(db, nummer, "fotos", await auftrag.fotos());
      }),
    ]);

    const [dokumenteLauf, fotosLauf] = await Promise.all([
      Promise.resolve(leseExtrakt(db, nummer, "dokumente")),
      Promise.resolve(leseExtrakt(db, nummer, "fotos")),
    ]);
    const datensatz = zusammenfuegen(dokumenteLauf, fotosLauf);
    const ergebnis = pruefePflichtfelder(datensatz);
    const bericht = berichtText(nummer, ergebnis);

    if (!ergebnis.vollstaendig) {
      setWartetAufEingabe(db, nummer);
      await akte.runSchritt("report-schreiben", async () => {});
      return {
        angenommen: false,
        nummer,
        bericht,
        fehlend: ergebnis.fehlend.map((feld) => ({ id: feld.id, grund: feld.grund })),
        stand: getVorgang(db, nummer).stand,
      };
    }

    await akte.runSchritt("pflichtfelder-pruefen", async () => {});
    const queueId = einreihen(db, nummer, datensatz, bericht);
    await akte.runSchritt("report-schreiben", async () => {});
    return {
      angenommen: true,
      nummer,
      bericht,
      fehlend: [],
      queueId,
      stand: getVorgang(db, nummer).stand,
    };
  });
}

function einreihen(db, nummer, datensatz, bericht) {
  const vorhanden = db.prepare(
    "SELECT id, status FROM eingabe_queue WHERE nummer = ? AND status IN ('wartend', 'in_arbeit') ORDER BY id DESC LIMIT 1",
  ).get(nummer);
  if (vorhanden) return vorhanden.id;

  const result = db.prepare(`
    INSERT INTO eingabe_queue (nummer, datensatz, bericht, status, created_at)
    VALUES (?, ?, ?, 'wartend', ?)
  `).run(nummer, JSON.stringify(datensatz), bericht, now());
  return Number(result.lastInsertRowid);
}

export function setzeQueueStatus(db, id, status) {
  db.prepare("UPDATE eingabe_queue SET status = ? WHERE id = ?").run(status, id);
}

function beansprucheNummer(db, nummer, fortsetzen) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const fremd = db.prepare(
      "SELECT id FROM eingabe_queue WHERE status = 'in_arbeit' AND nummer != ? LIMIT 1",
    ).get(nummer);
    if (fremd) {
      db.exec("COMMIT");
      return null;
    }
    const zeile = db.prepare(`
      SELECT id, nummer, datensatz, bericht, status
      FROM eingabe_queue
      WHERE nummer = ? AND status IN ('wartend', 'pausiert', 'in_arbeit')
      ORDER BY id DESC
      LIMIT 1
    `).get(nummer);
    if (!zeile || (zeile.status === "in_arbeit" && !fortsetzen)) {
      db.exec("COMMIT");
      return null;
    }
    if (zeile.status !== "in_arbeit") {
      db.prepare(
        "UPDATE eingabe_queue SET status = 'in_arbeit', started_at = ? WHERE id = ?",
      ).run(now(), zeile.id);
    }
    db.exec("COMMIT");
    return auftragAusZeile(zeile);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function auftragAusZeile(zeile) {
  return {
    id: zeile.id,
    nummer: zeile.nummer,
    datensatz: JSON.parse(zeile.datensatz),
    bericht: zeile.bericht,
  };
}

export function holeEingabeAuftrag(db, { fortsetzen = false, nummer = "" } = {}) {
  const ziel = String(nummer || "").trim();
  if (ziel) return beansprucheNummer(db, ziel, fortsetzen);
  if (fortsetzen) {
    const aktiv = db.prepare(`
      SELECT id, nummer, datensatz, bericht
      FROM eingabe_queue
      WHERE status = 'in_arbeit'
      ORDER BY id
      LIMIT 1
    `).get();
    if (aktiv) return auftragAusZeile(aktiv);

    db.exec("BEGIN IMMEDIATE");
    try {
      const pausiert = db.prepare(`
        SELECT id, nummer, datensatz, bericht
        FROM eingabe_queue
        WHERE status = 'pausiert'
        ORDER BY id
        LIMIT 1
      `).get();
      if (!pausiert) {
        db.exec("COMMIT");
      } else {
        db.prepare(
          "UPDATE eingabe_queue SET status = 'in_arbeit', started_at = ? WHERE id = ?",
        ).run(now(), pausiert.id);
        db.exec("COMMIT");
        return auftragAusZeile(pausiert);
      }
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  return naechsterEingabeAuftrag(db);
}

export function naechsterEingabeAuftrag(db) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const aktiv = db.prepare(
      "SELECT id FROM eingabe_queue WHERE status = 'in_arbeit' LIMIT 1",
    ).get();
    if (aktiv) {
      db.exec("COMMIT");
      return null;
    }

    const naechster = db.prepare(`
      SELECT id, nummer, datensatz, bericht
      FROM eingabe_queue
      WHERE status = 'wartend'
      ORDER BY id
      LIMIT 1
    `).get();
    if (!naechster) {
      db.exec("COMMIT");
      return null;
    }

    const vorgang = getVorgang(db, naechster.nummer);
    if (vorgang.schritte["pflichtfelder-pruefen"] !== "erledigt" || vorgang.stand === "wartet_auf_eingabe") {
      db.exec("COMMIT");
      return null;
    }

    db.prepare(
      "UPDATE eingabe_queue SET status = 'in_arbeit', started_at = ? WHERE id = ?",
    ).run(now(), naechster.id);
    db.exec("COMMIT");
    return {
      id: naechster.id,
      nummer: naechster.nummer,
      datensatz: JSON.parse(naechster.datensatz),
      bericht: naechster.bericht,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
