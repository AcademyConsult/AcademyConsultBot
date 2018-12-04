# AcademyConsultBot
Dies ist der Quellcode für den [Telegram](https://telegram.org/)-Bot von Academy Consult.

Unterstützte Befehle
* /bewerbungen: zeigt die Anzahl der aktuellen Bewerbungen während dem Recruiting an
* /bdsu: zeigt BDSU-Events an, die im Eventkalender stehen
* /buero: zeigt die aktuellen Reservierungen/Verfügbarkeiten der Büroräume an
* /countdown: aktiviert Push-Benachrichtigungen für neue Bewerbungen während dem Recruiting
* /details: zeigt an, wie viele Geräte im Büro-WLAN online sind und die Namen der Benutzer, falls verfügbar
* /events: zeigt die aktuellen Termine aus dem Event-Kalender an
* inline query: Suchen und Versenden von Kontakten aus dem internen Adressbuch; Erstellen einer einfachen Umfrage

## Details
### Authentifizierung
Die Funktionen des Bots stehen nur Mitgliedern von Academy Consult München e.V.
zur Verfügung. Zur Authentifizierung muss die Telegram User-ID bei einem aktiven
Benutzer im internen Active Directory hinterlegt sein (in einem
[`extensionAttribute`](config.json#L48)-Attribut).

Beim ersten Kontakt sucht der Bot nach einem aktiven AD-Benutzer mit der
Telegram-ID im entsprechenden Attribut. Wird kein aktiver AD-Benutzer gefunden,
wird der User an die Login-Seite verwiesen mit einem Link, der seine ID enthält.
Über die Login-Seite wird dann die ID nach erfolgreicher Authentifizierung mit
den eigenen Zugangsdaten beim entsprechenden AD-Benutzer hinterlegt.

### Kalender
Die Kalender werden über öffentliche URLs als `ical`s abgerufen (z.B. über die
öffentlichen Links zu freigegebenen Office365-Kalendern) und dann jeweils die 5
nächsten Termine angezeigt bzw. eine Übersicht aller Räume und ihrer aktuellen
Verfügbarkeiten angezeigt. Zusätzlich werden [inline
keyboards](https://core.telegram.org/bots#inline-keyboards-and-on-the-fly-updating)
zum Durchbättern der Termine bzw. einzelner Räume angezeigt.

### Büro-WLAN
Die Anzahl der aktiven Geräte im Büro-WLAN fragt der Bot über die REST-Api des
[UniFi-Controllers](https://www.ubnt.com/software/) ab. Bei Geräten, bei denen
ein Anzeigename hinterlegt ist, wird dieser zusätzlich angezeigt. Der
Anzeigename kann für jedes Gerät gesetzt werden, indem im internen WLAN eine
entsprechende Seite aufgerufen wird. Der dort eingegebene Anzeigename wird dann
mit der MAC-Adresse des Gerätes verknüpft und im UniFi-Controller gespeichert.

Zusätzlich werden alle Benachrichtigungen aus dem UniFi-Controller regelmäßig
abgerufen und an alle [`subscribers`](config.json#L10) (die IT-Telegram-Gruppe
von Academy Consult) geschickt, um z.B. sofort über abgesteckte Access Points zu
informieren.

### Adressbuchsuche
Mit Eingaben der inline queries werden alle Namen der aktiven AD-Benutzer
durchsucht und Treffer als Ergebnisse zur Auswahl angezeigt. Ausgewählte Treffer
werden als Kontakte inkl. Handynummer (AD-Attribut `mobile`) an den aktuellen
Chat gesendet.

### Einfach Umfrage
Wird kein passender Kontakt für ein inline query gefunden, wird der eingegebene
Text als Text für eine einfache Umfrage interpretiert. Wählt der User dieses
Ergebnis aus, wird eine Nachricht mit seinem Text in den Chat geschickt mit den
möglichen Optionen als inline keyboard. Andere User können dann über das inline
keyboard eine Option auswählen (oder wieder abwählen) wodurch sie mit ihrem
Namen zur ausgewählten Option in der Nachricht hinzugefügt (oder wieder
entfernt) werden.
Die verfügbaren Optionen werden global in der `simple_poll`-Konfiguration
festgelegt (siehe unten).

## Ausführung
Der Bot kann als Docker-Container gebaut und gestartet werden mit einem einfachen
```
docker-compose up -d
```

### Konfiguration
Alle benötigte Konfiguration wird in der [`config.json`](config.json) vorgenommen:

* `name`: String - Benutzernamen des Bots (ohne führendes `@`)
* `token`: String - [API-Token für Telegram](https://core.telegram.org/bots/api#authorizing-your-bot)
* `timeout`: Int - Timeout für [`getUpdates`](https://core.telegram.org/bots/api#getupdates)
* `controllers`: Array - von UniFi-Controllern, die abgefragt werden sollen
  * `name`: String - Anzeigename für diesen UniFi-Controller
  * `uri`: String - Basis-URL, unter der der Controller erreichbar ist
  * `username`: String - Benutzername für API-Login
  * `password`: String - Passwort für API-Login
  * `subscribers`: Array - Telegram-IDs von Benutzern/Gruppen, an die ein [Alarm aus dem Controller geschickt](main.js#310) werden soll
  * `whitelist`: Array - Telegram-IDs von Benutzern/Gruppen, die [erweiterte Controller-Informationen abfragen](main.js#233) können
* `events` - Object - `ical` und `html` URLs für den Eventkalender (`/events`)
* `rooms`: Object - `ical` und `html` URLs für alle Raumkalender mit Raumnamen als Keys (`/buero`)
* `countdown`: Object - URL zum API-Endpunkt zum Abfragen der Bewerberzahlen (`/bewerbungen`, `/countdown`)
* `group`: Object - Vereinsgruppe, zu der alle neuen Mitglieder automatisch eingeladen werden sollen
  * `id`: Int/String - Telegram-ID/Name der Gruppe
  * `name`: String - Anzeigename der Gruppe für Einladungstext
* `ldap`: Object - Konfiguration für LDAP-Verbindung
  * `uri`: String - URI zum LDAP-Server, inkl. Schema
  * `binddn`: String - DN oder userPrincipalName für Login
  * `bindpw`: String - Passwort für Login
  * `uid_attribute`: String - LDAP-Attribut, in dem die Telegram-Benutzer-ID gespeichert ist
  * `basedn`: String - DN auf den die Suche nach Benutzerobjekten eingeschränkt werden soll
* `excluded_essids`: Array - ESSIDs deren verbundene Geräte nicht angezeigt werden sollen (`/details`)
* `simple_poll`: Object - Konfiguration für einfache Umfragen
  * `title`: String - Titel der dem User beim inline query als Ergebnis angezeigt werden soll
  * `buttons`: Object - Auswahlmöglichkeiten des inline keyboards; Keys sind die internen IDs der Optionen, Values der Anzeigetext für die Option

Für eine sichere LDAP-Verbindung über `ldaps` wird außerdem das CA-Zertifikat
des LDAP-/AD-Servers in der Datei [`activedirectory_CA.pem`](main.js#10)
benötigt.

### Entwicklung
Für die lokale Entwicklung kann der Bot auch über
```
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up
```
gestartet werden. Dadurch wird das komplette Verzeichnis unter `/app` in den
Container gemountet, sodass alle Dateiänderungen auch ohne neuen `docker build`
beim nächsten Start sofort effektiv sind und der
[node inspector](https://nodejs.org/en/docs/inspector/) gestartet, sodass man in
Chrome über `chrome://inspect` bzw. die ausgebene `chrome-devtools://...` URL
(IP in der URL austauschen!) den laufenden Bot mit den DevTools öffnen und live
debuggen kann.
