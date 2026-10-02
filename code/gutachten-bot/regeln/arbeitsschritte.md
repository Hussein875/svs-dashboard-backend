# Gutachten-Bot: feste Arbeitsschritte

Jeder Lauf folgt dieser Datei. Ein Schritt, der im Zustandsspeicher als erledigt steht, wird übersprungen. Unklare oder unleserliche Werte werden nicht geschätzt und nicht ergänzt. Das Feld bleibt leer, der Report nennt nur den Feldnamen und den Grund.

## Pflichtfelder

Vor der Eingabe in UltraExpert muss die Akte gegen diese Liste geprüft sein.

- Fahrzeugschein, lesbar
- Kennzeichen, lesbar
- Kilometerstand, lesbar
- Schadenfotos aus allen vier Perspektiven: vorne links, vorne rechts, hinten rechts, hinten links
- Vorschäden-Angabe, auch wenn sie „Keine“ lautet
- Auftraggeberdaten: Anrede, Name, Straße, PLZ, Ort

Fehlt ein Feld oder ist es unleserlich, startet die Eingabe nicht. Der Stand wird `wartet_auf_eingabe`.

## Zustand

Je Vorgangsnummer, in dieser Reihenfolge: `eingelesen`, `geprueft`, `eingetippt`, `abgeschlossen`. Dazu `wartet_auf_eingabe`, wenn die Pflichtfelder nicht erfüllt sind.

## Phase 1, Analyse

Diese Schritte dürfen später für mehrere Akten parallel laufen. Sie schreiben nichts in UltraExpert.

1. `dokumente-lesen` — BD, Fahrzeugschein, Abtretung, Vollmacht lesen.
2. `fotos-auswerten` — Lichtbilder und Fotos 2 sichten. Aufnahmen über 10 MB nicht über den Chat-Download holen. Über `GUTACHTEN_DRIVE_CREDENTIALS` laden und mit `src/drive-foto.js` verkleinern, den Titel aus der Vorschau lesen. Videos ignorieren.
3. `pflichtfelder-pruefen` — Liste oben. Nur bei vollständigem Datensatz erledigt.
4. `report-schreiben` — was übernommen wurde, was fehlt, welche Felder leer bleiben.

Sind 1 und 2 erledigt, ist der Stand `eingelesen`. Ist 3 erfolgreich, ist der Stand `geprueft`.

## Phase 2, Eingabe

Streng eine Akte nach der anderen. Nur mit einem Datensatz, dessen Pflichtprüfung erledigt ist.

Der Knopf **Mit KI bearbeiten** im Dashboard startet diese Phase. Er liefert Aktenzeichen und Drive-Ordner. Keine PIN und keine lokale Seite.

5. `besichtigung` — Adresse des Auftraggebers, Ort/Firma leer. Sachverständiger aus der Klammer im Drive-Ordner: `(HU)` Hussein Souleiman, `(H)` oder `(HJ)` Hussein Jaber, `(B)` Hussein Selman, `(OS)` Osama Sleiman.
6. `beteiligte` — Anwalt und Versicherung Anrede „Firma“. Liegt keine Vollmacht im Ordner, gibt es keinen Anwalt. Dann nur Auftraggeber und Versicherung. Auftraggeber Anrede „Herr“, außer es steht etwas anderes da oder der Name ist bekannt weiblich. Name aus der Abtretung. Weicht der Name auf dem Fahrzeugschein ab, wird er Fahrzeughalter. Stimmen die Namen überein, gibt es keinen zusätzlichen Fahrzeughalter. Kennzeichen: Schein und Bilder gelten, wenn die Abtretung davon abweicht.
7. `fahrzeug` — Fahrzeug über die FIN identifizieren, nicht über HSN/TSN. Variante nach FIN, Erstzulassung und Getriebe. Nächste HU von der Plakette am Kennzeichen oder von der BD, nicht aus dem abgelaufenen Stempel im Schein. Getriebe am Wählhebel prüfen, wenn der Schein es nicht hergibt.
8. `bereifung` — Profiltiefe, Hersteller, Dimension, Felgen. Oberes Kreuz Stahl, unteres Aluminium. Reifentyp, Modell und Bemerkung leer.
9. `vor-ort` — Bedingungen ausreichend, Hebebühne leer, Zustand unrepariert, Identifizierung FZ-Schein. Scheckheft nur bei Kreuz auf der BD, dann Fachwerkstatt. Probelauf Antrieb durchgeführt. Allgemeinzustand gepflegt, normale Gebrauchsspuren. Schilderung aus der BD. Polizei nur eintragen, wenn auf der BD angekreuzt. Plausibilität plausibel.
10. `vorschaeden` — „Keine“ nur dort entfernen, wo die BD einen Vorschaden nennt. Unfachgerecht bleibt „Keine“. Unter „Im Schadenbereich“ nur Bauteile, die der neue Anstoß wieder trifft. Dieselbe Seite reicht nicht. Die übrigen nicht reparierten Vorschäden nur unter „Nicht im Schadenbereich“. Kein Bauteil doppelt. Mehrschaden und Wertverbesserung nur, wenn etwas im Schadenbereich steht.
11. `schadenfeststellung` — Fahrbereitschaft nur verkehrssicher, nicht verkehrssicher oder nicht fahrbereit, Kreuz von der BD. Airbag nur „Ja“, wenn BD oder Bilder eine Auslösung zeigen. Schadenbeschreibung aus den Triggern in `schaden-trigger.json`, ein Punkt pro Bauteil, letzter Punkt `div`. Skizze nur die auf der BD markierten Regionen.
12. `dokumente-import` — Abtretungserklärung über Importieren. Vollmacht nur, wenn sie im Ordner liegt. Verkehrsunfallanzeige, wenn vorhanden, als Unfallbericht. Videos ignorieren.
13. `lichtbilder` — Vier Übersichten, dann die Übersicht mit Geomaßstab, Bauteile, Kilometerstand, FIN, Fahrzeugschein, danach Vorschäden. Kleine Bauteile dürfen mit dem größeren Teil auf einem Bild liegen, wenn der Schaden klar zu sehen ist. Jedes Bodenbild bleibt ohne Titel. Das Bodenbild am Ende der Schadenaufnahme markiert die Vorschäden. Besichtigungsbilder dem Gutachten zuordnen. Fotos 2 nur nach Kundenbilder, nicht dem Gutachten zuordnen. Videos ignorieren.

Sind die Eingabe-Schritte erledigt, ist der Stand `eingetippt`.

## Abschluss

14. `abschluss` — Report als Google Doc im Drive-Ordner der Akte, Name „Aktennummer Report“. Stand danach `abgeschlossen`.
