# Musiclist — Benutzerhandbuch

## Uebersicht

Musiclist ist eine webbasierte Anwendung zur Verwaltung von Musiktiteln fuer Film- und TV-Produktionen. Die Anwendung unterstuetzt:

- Verwaltung von Musiktiteln mit Audio-Tags (Titel, Interpret, Verlag, ISRC, etc.)
- Import von EDL-Dateien (Edit Decision Lists) zur automatischen Playlist-Erstellung
- GEMA-Daten Import (OCR-Text und XLS)
- GVL-Label-Suche
- Export als EDL, Playlist und XLS
- Gemeinsame MP3-Ablage fuer das Team
- Benutzerverwaltung mit Rollen

## Erste Anmeldung

1. Oeffnen Sie https://musiclist.dsm.team im Browser
2. Melden Sie sich mit Ihrer E-Mail-Adresse und dem Initialpasswort `Initial#123` an
3. Aendern Sie Ihr Passwort nach der ersten Anmeldung

## Hauptbereiche

### Musiktabelle

Die zentrale Ansicht zeigt alle Musiktitel der aktuellen Playlist als Tabelle. Spalten koennen per Drag & Drop umsortiert und in der Breite angepasst werden.

**Titel hinzufuegen:**
- MP3-Dateien per Drag & Drop in die Tabelle ziehen
- ID3-Tags werden automatisch ausgelesen

**Tags bearbeiten:**
- Doppelklick auf eine Zelle zum direkten Bearbeiten
- Oder: Titel auswaehlen und den Tag-Editor oeffnen

### EDL-Bibliothek (Seitenpanel)

Das linke Panel zeigt die persoenliche EDL-Bibliothek:

- **Ordner erstellen:** Klick auf das Ordner-Plus-Symbol
- **EDL importieren:** `.edl`-Datei in die Bibliothek ziehen
- **Playlist oeffnen:** Klick auf eine `.list`-Datei
- **Dateien verschieben:** Drag & Drop zwischen Ordnern

### GEMA-Import

1. GEMA-Daten als Text (OCR) oder XLS-Datei bereitstellen
2. Ueber das Menu "GEMA importieren" aufrufen
3. Die erkannten Daten werden automatisch den passenden Titeln zugeordnet

### GVL-Label-Suche

Fuer Titel ohne Label-Information:
1. Titel auswaehlen
2. GVL-Suche starten
3. Gefundene Labels werden automatisch eingetragen

### Export

Ueber das Menu stehen folgende Exportformate zur Verfuegung:
- Playlist als `.list`-Datei
- EDL im CMX-3600-Format
- GEMA-Meldung als XLS

## Administration

### Benutzerverwaltung (nur Admins)

Ueber das Menu "Benutzer verwalten":

- **Neuen Benutzer einladen:** Name, E-Mail und Rolle angeben. Der Benutzer erhaelt eine Einladungsmail mit dem Initialpasswort.
- **Benutzer loeschen:** Entfernt den Benutzer und alle zugehoerigen Daten.
- **Passwort zuruecksetzen:** Neues Passwort fuer einen Benutzer setzen.

### Rollen

| Rolle  | Berechtigungen                                              |
|--------|-------------------------------------------------------------|
| Admin  | Alles: Benutzerverwaltung, Shared Tracks schreiben/loeschen |
| User   | Eigene EDL-Bibliothek, Shared Tracks lesen, Tags bearbeiten |

### Shared Tracks (gemeinsame MP3-Ablage)

- Admins koennen MP3-Dateien in die gemeinsame Ablage hochladen und loeschen
- Alle Benutzer koennen die Dateien lesen und in ihren Playlists verwenden
- Die Dateien liegen serverseitig unter `data/shared/tracks/`

## Systemanforderungen

- Moderner Browser (Chrome, Firefox, Safari, Edge)
- Fuer lokale MP3-Verwaltung: File System Access API (Chrome/Edge empfohlen)

## Haeufige Fragen

**Ich habe mein Passwort vergessen.**
Wenden Sie sich an einen Administrator. Dieser kann Ihr Passwort zuruecksetzen.

**Die Seite laedt nicht oder zeigt alte Inhalte.**
Druecken Sie `Ctrl+Shift+R` (Windows) bzw. `Cmd+Shift+R` (Mac) fuer einen Hard-Reload.

**MP3-Dateien werden nicht erkannt.**
Stellen Sie sicher, dass die Dateien die Endung `.mp3` haben.
