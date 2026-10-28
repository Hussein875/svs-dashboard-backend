# Referenz-Lesung 2301/26 (AE + BD)

Quelle: lokale PDFs `2301_26 AE.pdf`, `2301_26 BD.pdf` (Scans, kein Textlayer).  
Stand: manuelle Volllesung vor Bot-Bearbeitung. Dient als Soll für Phase 1 und UX-Eingabe.

---

## Abtretung (AE)

| Feld | Soll-Wert | Bot-Feld / Hinweis |
|------|-----------|-------------------|
| Auftraggeber Name | **Faro Houzan** (Formular: „Houzan, Faro“) | `auftraggeber.name`, Anrede **Herr** (nicht „Frau“) |
| Straße | Heinrich-Zille-Platz 1 | `auftraggeber.strasse` |
| PLZ / Ort | 40789 Monheim am Rhein | `plz`, `ort` |
| E-Mail | Faro.houzan@gmail.com | **nicht** in UltraExpert-Pflichtschema |
| Kennzeichen Auftraggeber | **ME-HS 1718** | `kennzeichenAbtretung` → `kennzeichen` |
| Unfallgegner (Freitext) | Fahrer: Frank-Joch, Halter: Joch GmbH | **nicht** als Beteiligter modelliert (nur AE-Notiz) |
| Kennzeichen Unfallgegner | **ME-FJ 210** + **ME-ED 523** (Anhänger) | Erstes Kennzeichen für Z@Online; zweites optional merken |
| Versicherung | leer | — |
| Schaden-Nr. / Vers.-Nr. | leer | `schadennummer`, `versicherungsnummer` leer |
| Schadentag | **27.12.26** 11:00 | Nur Datum: prüfen ob **2026** gemeint (Oktober 2026 → Zukunft → Bot verwirft) oder Fehllesung **2024/2025** |
| Schadenort | Karlstr. 3, 40764 Langenfeld | `schadenstrasse` + `schadenort` (Langenfeld) |
| Gutachten-Nr. | leer | — |
| Vorsteuerabzug | **Nein** angekreuzt | nicht in UX-Auftrag |
| Unterschrift | Monheim am Rhein, Signatur | — |

---

## Besichtigungsblatt (BD)

Layout beginnt auf dem Scan direkt mit **Reifen** (kein Kennzeichen/FIN auf BD — kommt aus AE + Fotos).

### Reifen / Bereifung

| | V | H |
|---|---|---|
| Profiltiefe | **8** | **8** |
| Dimension / Hersteller | **215/60 R 17** | **FALKEN** |

- Kreise **Stahl / Aluminium** (Felgen): auf dem Scan prüfen, welches angekreuzt ist — ohne Kreuz bleibt `bereifung.lesbar` false.
- **nicht fahrbereit** / **nicht verkehrssicher**: beide **leer** → Fahrbereitschaft **`verkehrssicher`**.

### Vorschäden

| Spalte | Eintrag |
|--------|---------|
| Verkratzt | **SVL** (Seite vorne links) |
| Beschädigt | **THR** (Tür hinten rechts) |
| Reparierte Vorschäden | keine Kreuze |

→ Bot: `vorschadenAusserhalb` als Klartext-Sätze, nicht nur Kürzel.

### Schadenhergang / Skizze

- **Geparkter Zustand** angekreuzt → `hergangGeparkt: true`, Schilderung z. B. Parkplatzunfall.
- Skizze: **Anhänger** am Fahrzeug (Auffahrunfall/Hinterstoss Kontext).

### Bearbeitung

| Feld | Wert |
|------|------|
| Reparaturdauer | 7–8 Tage (nur Info, kein UX-Pflichtfeld) |
| HU | 04/27 (auf BD — Bot übernimmt HU **nicht** vom BD-Blatt, sondern Schein/Plakette) |
| KM | **166317** |
| Totalschaden / Scheckheft / Mietwagen | leer |
| Polizeilich aufgenommen | **Ja** |
| Rechtsanwalt RS | leer |

### Schadenbereich (Icon-Raster)

- Am **Stoßfänger vorne** handschriftlich **„N“** (erneuern) — aktueller Anstoß vorne.
- Keine weiteren Kästchen sichtbar markiert → Skizze/Regionen aus „N“ vorne ableiten.

---

## Zusammenführung Phase 1 → UX

| UX-Schritt | Hauptquelle 2301 |
|------------|------------------|
| Auftrag | AE: Kennzeichen, Gegner **ME-FJ 210**, Schadentag, Ort/Straße, SV aus Ordner |
| Beteiligte | AE: Faro Houzan, Adresse |
| Besichtigung | AE-Adresse, SV |
| Fahrzeug | Fotos Schein/FIN (nicht BD) |
| Bereifung | BD: 8 mm, Falken, 215/60 R17, Felgen-Kreuz |
| Vor Ort | BD: geparkt, polizei, Probelauf/Checklisten |
| Vorschäden | BD: SVL/THR |
| Schadenfeststellung | BD: Anstoß vorne (N), Fahrbereitschaft verkehrssicher |

---

## Bekannte Bot-Lücken (2301)

1. AE **Doppel-Lesung** + Format (Komma-Name, Kennzeichen, `+` beim Gegner) — Fixes in `lese-roh.js` / `ordner-lesen.js`.
2. Schadentag **27.12.26** und Zukunftsfilter in `tagesdatum()`.
3. BD **SVL/THR** in Klartext für Vorschäden (Prompt/Erweiterung).
4. BD **Felgen-Kreuz** muss gelesen werden, sonst „Bereifung fehlt“.
5. Phase 2 **UX-Klicks** unabhängig von Lesung (Speichern, Beteiligte, Dropdowns).

---

## Nächster Schritt

Automatisiert: Fixture-Test `2301-26` gegen `werteLesung()` / `lesungStandBericht()` mit obigen Soll-Werten (sobald Felgen auf BD bestätigt).  
Manuell: UX mit dieser Tabelle abgleichen, bevor erneut „Mit KI bearbeiten“.
