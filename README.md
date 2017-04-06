# AcademyConsultBot
Dies ist der Quellcode für den [Telegram](https://telegram.org/)-Bot von Academy Consult.

Unterstützte Befehle
* /bdsu: zeigt BDSU-Events an, die im Eventkalender oder in den BDSU-Kalendern stehen
* /buero: zeigt die aktuellen Reservierungen/Verfügbarkeiten der Büroräume an
* /details: zeigt an, wie viele Geräte im Büro-WLAN online sind und die Namen der Benutzer, falls verfügbar
* /events: zeigt die aktuellen Termine aus dem Event-Kalender an
* inline query: Suchen und Versenden von Kontakten aus dem internen Adressbuch

## Details
### Authentifizierung
Die Funktionen des Bots stehen nur Mitgliedern von Academy Consult München e.V.
zur Verfügung. Zur Authentifizierung muss die Telegram User-ID bei einem aktiven
Benutzer im internen Active Directory hinterlegt sein (in einem
[`extensionAttribute`](config.json#L44)-Attribut).

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
