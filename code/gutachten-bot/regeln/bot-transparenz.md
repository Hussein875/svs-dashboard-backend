# Bot-Transparenz (Dashboard „Bots“)

Ziel: **Ohne UltraExpert zu öffnen** jederzeit verstehen, was der KI-Lauf gerade tut, was er aus Drive **verstanden** hat und was am Ende **gespeichert** bzw. **offen** ist.

---

## Wo du etwas siehst

| Ort | Wann | Inhalt |
|-----|------|--------|
| **Dashboard → Bots** (Admin-PIN) | Während und nach dem Lauf | Laufzeit, Live-Zeile, Abschlussbericht, Kopieren, UltraExpert-Link |
| **Karte der Akte** | Kurz nach Ende | Tooltip mit Kurzfassung der Abschlussmeldung |
| **UltraExpert** | Optional | Ergebnis der Eingabe — **nicht nötig**, solange der Bot läuft |

Die Bot-Liste lebt **nur im Server-Arbeitsspeicher** (kein Archiv). Nach Container-Neustart oder nach ~30 Minuten bei beendeten Jobs verschwinden Einträge. **Mit KI bearbeiten** startet einen neuen Lauf; der Abschlussbericht ist die dauerhafte Erinnerung für diese Session.

---

## Ablauf in zwei Phasen (was „echt passiert“)

### Phase 1 — Drive (noch kein Speichern in UX)

1. **Dokumente und Fotos lesen** — BD, Abtretung, Schein-Fotos, Übersichtsbilder (Gemini/JSON).
2. **Lesung erneut, Versuch 2/3** — nur wenn Pflicht- oder Zusatzfelder noch fehlen; es wird **nicht** abgebrochen.
3. **Lesung fertig** (geplant) — Kurzzeile: wie viele Angaben gelesen, was noch offen (z. B. „12 gelesen, 3 offen — Bereifung …“).

In Phase 1 ändert sich **nichts** in UltraExpert.

### Phase 2 — UltraExpert (Menüreihenfolge)

Reihenfolge der **Live-Zeilen** (Schrittname + optional Detail):

| Schritt | Was der Bot tut | Beispiel Detail (Soll) |
|---------|-----------------|-------------------------|
| `auftrag` | Reiter Auftrag | Kennzeichen … · FIN … · SV … · Gegner … |
| `beteiligte` | Beteiligte | Auftraggeber Name, Adresse · ggf. Halter · Anwalt |
| `besichtigung` | Besichtigung anlegen | Ort beim Auftraggeber · Sachverständiger · **Teilnehmer** (Beteiligte zuvor anlegen) |
| `fahrzeug` | Fahrzeug identifizieren | FIN … · km · EZ · Getriebe |
| `bereifung` | Reifen | Profiltiefe · Hersteller · Dimension · Felgen |
| `vor-ort` | Besichtigung Vor Ort | Bedingungen, Schilderung, Probelauf |
| `vorschaeden` | Vorschäden-Listen | BD-Listen übernehmen |
| `schadenfeststellung` | Schaden | Fahrbereitschaft · Schadenpunkte |
| `dokumente-import` / `lichtbilder` | oft offen | „Schritt noch nicht angebunden“ |

Zwischen den Schritten: kurze Playwright-Aktionen (Speichern, Seite wechseln). Die Anzeige springt zum **nächsten Schritt**, sobald der vorherige erledigt oder übersprungen ist.

---

## Abschlussbericht (Pflicht nach jedem Lauf)

Wenn der Lauf **erfolgreich durch UltraExpert** ging, ersetzt eine **mehrzeilige Meldung** die Live-Zeile (Status z. B. „geöffnet“):

```text
Akte 2301
Gelesen: Kennzeichen, Kilometerstand, …
Gespeichert: Auftrag, Beteiligte, Besichtigung, …
Offen:
• Bereifung: …
• Dokumente
• …
```

- **Gelesen** — alles, was Phase 1 aus Drive **zuverlässig** extrahiert hat (Pflichtfelder + FIN, Bereifung, Schilderung, …).
- **Gespeichert** — UX-Schritte, die **wirklich gespeichert** wurden.
- **Offen** — fehlende Lesung **und** UX-Schritte, die übersprungen wurden (fehlende Klickpfade, unleserliche Felder, Dokumente/Lichtbilder).

**Kopieren** im Bots-Modal → ganzer Text für Mail/Notiz. **UltraExpert öffnen** → Dossier-URL nach erfolgreichem Lauf.

Bei **Fehler** oder **Stopp**: eine Zeile mit Fehlertext; kein vollständiger Bericht.

---

## Ist vs. Soll (Dashboard)

### Ist (Produktion, Stand vor Live-Detail-Deploy)

- Live: nur **Schritt: Status** (z. B. „Vor Ort: läuft“) + Laufzeit.
- Lesung: „Dokumente lesen“, „Versuch 3 von 3“ — **ohne** Liste gelesener Felder bis zum Ende.
- Abschluss: **Gespeichert** + **Offen** (Zeile **Gelesen** ist im Code vorbereitet, Deploy folgt).

### Soll (Lesung-Checkliste im Bots-Modal)

1. **Live-Checkliste** unter dem KI-Eintrag: Feld · Wert · ✓/○/? (während Lesung Zeilen füllen sich).
2. **Pause nach Lesung** — Status „Lesung prüfen“, Felder **editierbar**, Button **„UX starten“** (Korrekturen gehen in die Eingabe).
3. **UX-Spalte** — zweite Liste: Auftrag, Beteiligte, … mit Fortschritt während Phase 2.
4. API: `PATCH /api/bots/:id/lesung`, `POST /api/bots/:id/ux-start`. Abschalten der Pause: `KI_PAUSE_AFTER_LESUNG=0` auf dem Server.

Technik: `src/lesung-checkliste.js`, `kiFortschrittPayload` → assign-service → Dashboard `renderLesungChecklistHtml`.

---

## Roadmap (später, Dokumentation first)

Priorität für „wirklich alles sehen“:

1. **Deploy Soll v1** — Live-Detail + Gelesen-Zeile (siehe oben).
2. **Lesung während Versuch 1/2** — optional Zwischenstand „bisher gelesen: …“ (nicht nur nach Versuch 3).
3. **Schritt-Historie im Modal** — letzte 5 Meldungen einklappbar (nicht nur die letzte Zeile).
4. **Lesung vs. Plan** — kurze Tabelle im Bericht: Feld | Quelle (BD/Schein/Foto) | Status (ok/fehlt/unleserlich) — angebunden an Pflichtfeld-JSON und `lesungOffen()`.
5. **Kein Akte-Peek nötig** — KI-Markierung auf der Karte + Bots reichen; optional Badge „Phase 2, Schritt 7/12“.

Nicht geplant: dauerhaftes Log aller Läufe in der Datenbank (nur Session + Abschluss kopieren).

---

## Faustregeln für dich während ein Lauf läuft

- **Schritt wechselt** alle paar Minuten → normal (Playwright + Speichern).
- **Gleiche Zeile > 30 Min** → vermutlich hängender Klick; Stopp oder uns melden.
- **Akte nicht öffnen**, bis Status **geöffnet** / Bericht da ist — sonst Kollision mit Playwright.
- **Ergebnis** = Abschlussbericht in Bots, nicht die letzte Live-Zeile.

Siehe auch: `arbeitsschritte.md` (was in jedem Schritt fachlich passiert).
