# Lebensspuren

Eine Progressive Web App (PWA), die Lebenserinnerungen festhält: Sie zeigt eine
tiefgehende Frage groß und gut lesbar an und nimmt gleichzeitig das gesprochene
Wort als Sprachmemo oder Video auf. Gebaut für einen technisch nicht versierten
älteren Menschen – große Schrift, große Knöpfe, maximal zwei Fingertipps vom
Öffnen der App bis zur laufenden Aufnahme.

**Keine Installation, kein Build-Schritt, kein Server-Backend.** Die App besteht
aus statischen Dateien und läuft direkt im Browser – auf Android (Chrome) und
iPhone (Safari) mit demselben Code.

---

## Die Dateien

| Datei | Zweck |
| --- | --- |
| `index.html` | Kern der App (alle fünf Ansichten) |
| `styles.css` | Gestaltung (große Schrift, große Tippflächen) |
| `app.js` | App-Logik: Aufnahme, Speicherung, Teilen, Sync |
| `questions.js` | Fragenkatalog als reine Daten – hier neue Fragen ergänzen |
| `firebase.js` | Optionale Cloud-Anbindung mit Platzhalter-Konfiguration |
| `sw.js` | Service Worker (Offline-Fähigkeit) |
| `manifest.webmanifest` | PWA-Manifest (Name, Icons, Vollbild) |
| `firestore.rules` | Security Rules für Firestore |
| `storage.rules` | Security Rules für Cloud Storage |
| `icons/` | App-Icons in 192 px und 512 px |

---

## Lokal starten

Die App braucht nur einen simplen Webserver (wegen Service Worker und
Mikrofonzugriff funktioniert das Öffnen per Doppelklick auf `index.html` nicht).
Im Projektordner:

```bash
# Variante 1: Python (fast überall vorhanden)
python3 -m http.server 8000

# Variante 2: Node
npx serve .
```

Dann im Browser `http://localhost:8000` öffnen. Mikrofon/Kamera funktionieren
auf `localhost` auch ohne HTTPS.

**Vom Handy aus testen:** Mikrofon und Kamera erfordern HTTPS. Am einfachsten
die App kurz deployen (siehe unten) oder einen Tunnel wie `npx ngrok http 8000`
nutzen.

## Deployen

Jeder statische Hosting-Dienst mit HTTPS funktioniert. Zwei einfache Wege:

**GitHub Pages:** Repository → Settings → Pages → Branch auswählen → speichern.
Die App liegt dann unter `https://<name>.github.io/<repo>/`.

**Firebase Hosting** (praktisch, wenn du ohnehin Firebase einrichtest):

```bash
npm install -g firebase-tools
firebase login
firebase init hosting   # als öffentliches Verzeichnis "." angeben, kein Rewrite nötig
firebase deploy
```

Danach ist die App unter `https://<projekt>.web.app` erreichbar.

---

## Firebase einrichten (optional – für die Cloud-Sicherung)

Die App läuft ohne Firebase vollständig lokal. Mit Firebase kommt der optionale
Google-Login dazu, der jede Aufnahme automatisch in die Cloud sichert
(local-first: erst lokal gespeichert, dann im Hintergrund hochgeladen).

1. **Projekt anlegen:** [console.firebase.google.com](https://console.firebase.google.com)
   → „Projekt hinzufügen" → Namen vergeben (z. B. „lebensspuren"). Google
   Analytics kann aus bleiben.
2. **Web-App registrieren:** Auf der Projektübersicht das `</>`-Symbol
   anklicken → Namen vergeben → die angezeigte `firebaseConfig` kopieren.
3. **Konfiguration eintragen:** In `firebase.js` den deutlich markierten
   Platzhalter-Block mit den kopierten Werten füllen. Mehr ist im Code nicht
   zu tun – die App erkennt die Konfiguration beim nächsten Laden automatisch
   und zeigt den Anmelde-Knopf auf der Startseite.
4. **Google-Anmeldung aktivieren:** Build → Authentication → „Jetzt starten"
   → Tab „Sign-in method" → Google → aktivieren → Support-E-Mail wählen →
   speichern. Unter Authentication → Settings → „Authorized domains" muss die
   Domain stehen, unter der die App läuft (localhost und Firebase-Domains sind
   schon eingetragen; GitHub-Pages-Domain ggf. hinzufügen).
5. **Firestore einrichten:** Build → Firestore Database → „Datenbank erstellen"
   → Produktionsmodus → Region wählen (z. B. `europe-west3` für Frankfurt).
6. **Cloud Storage einrichten:** Build → Storage → „Jetzt starten" → gleiche
   Region. **Hinweis:** Storage erfordert den Blaze-Tarif (hinterlegtes
   Zahlungsmittel), auch wenn du im kostenlosen Kontingent (~5 GB) bleibst.
   Setze im Google-Cloud-Abrechnungskonto am besten ein Budget mit Warnung.
7. **Security Rules einspielen:** In der Konsole unter Firestore Database →
   „Regeln" den Inhalt von `firestore.rules` einfügen und veröffentlichen;
   unter Storage → „Rules" den Inhalt von `storage.rules` einfügen und
   veröffentlichen. Damit kann jeder Nutzer ausschließlich seine eigenen
   Daten lesen und schreiben.

**Gemeinsamer Zugriff für die Familie:** Am einfachsten melden sich Opa und
Enkel mit demselben Google-Konto an – dann sehen beide dieselben Aufnahmen,
ohne zusätzliche Freigabelogik.

---

## Die App aufs Handy legen (für Opa)

Am besten einmal gemeinsam einrichten – danach ist es ein normales App-Symbol
auf dem Startbildschirm.

**Android (Chrome):**
1. Die App-Adresse in Chrome öffnen.
2. Chrome schlägt meist von selbst „Lebensspuren installieren" vor → antippen.
   Falls nicht: Menü (⋮ oben rechts) → „App installieren" bzw.
   „Zum Startbildschirm hinzufügen".
3. Bestätigen – fertig. Das Icon liegt jetzt auf dem Startbildschirm.

**iPhone (Safari):**
1. Die App-Adresse in Safari öffnen (wichtig: Safari, nicht Chrome).
2. Teilen-Knopf antippen (das Viereck mit Pfeil nach oben, unten in der Mitte).
3. Nach unten wischen → „Zum Home-Bildschirm" antippen → „Hinzufügen".

Beim ersten Aufnehmen fragt das Handy einmal nach der Erlaubnis für Mikrofon
bzw. Kamera – hier „Erlauben" antippen.

**Wichtig auf dem iPhone:** Safari kann lokale Daten selten genutzter Websites
irgendwann aufräumen. Bei einer installierten App ist das Risiko klein, aber
nicht null. Deshalb erinnert die App daran, Aufnahmen zu teilen – und mit
eingerichtetem Google-Login werden sie ohnehin automatisch in die Cloud
gesichert. Regel: Das Handy ist der Arbeitsspeicher, das Familienarchiv (Cloud
oder Enkel) ist die Wahrheit.

---

## Bedienung in Kürze

- **Erzählen mit Ton** → roter Knopf → sprechen. Zwei Tipps, mehr nicht.
  Mit ‹ und › blättert man durch die Fragen – auch während die Aufnahme läuft;
  die App merkt sich automatisch per Zeitstempel, welche Frage wann dran war.
- **Erzählen mit Video** zeigt die Frontkamera als Spiegel, die Frage liegt als
  halbtransparente Leiste über dem Bild (wie ein Teleprompter). 🔄 wechselt
  auf die Rückkamera.
- **Fragen ansehen** zum Stöbern ohne Aufnahme: ⭐ merkt eine Frage vor,
  ✓ zeigt bereits beantwortete Fragen. Ein Tipp auf die Frage startet den
  Ton-Modus mit genau dieser Frage.
- **Meine Erinnerungen** listet alle Aufnahmen mit Abspielknopf, Teilen
  (natives Teilen-Menü: WhatsApp, AirDrop, E-Mail, Drive …), Zeitstempel-Export
  als Textdatei und Cloud-Status pro Aufnahme.
- Nichts geht verloren: Wird die App unterbrochen (Anruf, Bildschirmsperre,
  App-Wechsel), speichert sie das bis dahin Aufgenommene sofort automatisch.

## Der Weg zum Buch

1. Opa erzählt, die App speichert Aufnahmen samt Zeitstempel-Protokoll.
2. Die Familie erhält die Dateien per Teilen-Knopf oder über die Cloud.
3. Transkriptionsdienst (z. B. NotebookLM) macht Text daraus; die
   Zeitstempel-Dateien ordnen die Passagen den Fragen und damit den
   Buchkapiteln zu.

---

## Entscheidungen, die ich selbst getroffen habe

Wie gewünscht, hier die wesentlichen Detailentscheidungen:

1. **Startseite mit vier großen Knöpfen** („Erzählen mit Ton" als größter,
   roter Primärknopf ganz oben). Damit gilt: App öffnen → 1. Tipp „Erzählen
   mit Ton" → 2. Tipp roter Knopf = Aufnahme läuft.
2. **Audio als Standard-Empfehlung:** Der Ton-Modus ist der hervorgehobene
   Primärknopf (kleinere Dateien, robuster – wie im Konzept empfohlen).
3. **Gemeinsame Fragenposition über alle Modi:** Die App merkt sich die zuletzt
   angezeigte Frage (auch über Neustarts) – Opa macht immer dort weiter, wo er
   war. Blättern läuft zyklisch (nach der letzten Frage kommt wieder die erste).
4. **Stoppen = Speichern, immer:** Es gibt keinen Verwerfen-Knopf und keine
   „Bist du sicher?"-Dialoge. Auch Zurück-Tippen oder App-Wechsel während der
   Aufnahme speichert automatisch. Nur beim Löschen einer Aufnahme verlangt
   der Knopf einen zweiten Tipp („Wirklich löschen?") – als Schutz vor
   Versehen, ohne Dialogfenster.
5. **Aufnahme in 1-Sekunden-Blöcken** (`MediaRecorder.start(1000)`): Bei einem
   Absturz oder einer Unterbrechung ist maximal die letzte Sekunde in Gefahr.
6. **Beantwortet-Logik:** Jede Frage, die während einer Aufnahme angezeigt war
   (laut Zeitstempel-Protokoll), bekommt den grünen Haken.
7. **Dateinamen** = Titel der Aufnahme: `JJJJ-MM-TT – Startfrage` plus passende
   Endung (`.webm` auf Android, `.m4a`/`.mp4` auf dem iPhone).
8. **Teilen einer Aufnahme** hängt die Zeitstempel-Textdatei gleich mit an;
   ohne Web-Share-API (z. B. Desktop-Browser) werden die Dateien stattdessen
   heruntergeladen.
9. **Cloud-Sync ist bewusst nur Upload** (Sicherung), kein Zwei-Wege-Sync –
   local-first, einfach und robust. Status pro Aufnahme: „📱 Nur auf diesem
   Gerät", „⏳ Wird gerade gesichert", „☁️ In der Cloud gesichert".
   Ausgelöst wird der Upload nach jeder Aufnahme, beim Anmelden, beim App-Start
   und sobald das Netz zurückkommt.
10. **Ohne Firebase-Konfiguration** erscheint schlicht kein Anmelde-Knopf –
    keine Fehlermeldung, keine kaputten Funktionen. Das SDK wird nur bei
    ausgefüllter Konfiguration dynamisch von Googles CDN geladen.
11. **Login per Popup, Fallback Redirect** (Popups sind in installierten
    iOS-PWAs unzuverlässig).
12. **Speicherschutz:** Nach der ersten Aufnahme bittet die App den Browser um
    dauerhaften Speicher (`navigator.storage.persist()`), damit Aufnahmen
    nicht automatisch aufgeräumt werden.
13. **Wake Lock** hält den Bildschirm während der Aufnahme an; wo die API fehlt
    (ältere iOS-Versionen), speichert die Unterbrechungs-Logik trotzdem sofort.
14. **Die Platzhalter-Frage der Bonus-Kategorie** („Wo warst du, als
    [Mauerfall/Mondlandung/…] passierte?") habe ich als einzige Stelle des
    Katalogs sprachlich ausformuliert, damit sie direkt an Opa gerichtet
    lesbar ist. Alle übrigen Fragen sind wortgleich übernommen.
15. **Design:** Warme Creme-/Bernstein-Töne, Systemschrift, Fragen in 28–40 pt,
    alle Tippflächen mindestens 56 px, Aufnahmeknopf 104 px – bewusst wie der
    Auslöser einer Kamera-App.
