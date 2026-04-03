# Musiclist DSM

Webbasierte Musikverwaltung und EDL-Bibliothek (Edit Decision List) für die Die Schnittmeister GmbH. Ermoeglicht das Verwalten von Musiktiteln mit Audio-Tags (ID3), GEMA-Daten, GVL-Labels, Playlists und den Export als EDL/XLS.

## Features

- Musikdatenbank mit ID3-Tag-Verwaltung (Lesen, Bearbeiten, Schreiben)
- EDL-Import (CMX 3600) und Playlist-Verwaltung pro Benutzer
- GEMA-OCR und XLS-Import
- GVL-Label-Suche (ProSiebenSat.1 Musikportal)
- Gemeinsame MP3-Ablage (Shared Tracks)
- Benutzerverwaltung mit Rollen (Admin / User)
- Einladungsmail per SMTP

## Technologie

| Bereich   | Stack                                       |
|-----------|---------------------------------------------|
| Frontend  | React 19, Vite, TypeScript                  |
| Backend   | Express, TypeScript (tsx)                    |
| Daten     | JSON-Dateien (kein SQL, kein Prisma)         |
| Auth      | bcrypt + HMAC-signierte Token (14 Tage)      |
| Mail      | Nodemailer (SMTP)                           |

## Projektstruktur

```
musiclist-dsm/
  index.html              # Vite-Einstieg
  vite.config.ts          # Frontend-Build + Dev-Proxy (/api -> :5274)
  server/
    mailServer.ts         # Express API-Server (Haupteinstieg)
    userRoutes.ts         # Auth (Login, Bootstrap, Invite) + User-CRUD
    userEdlRoutes.ts      # EDL-Bibliothek pro User (CRUD Dateien/Ordner)
    sharedTracksRoutes.ts # Gemeinsame MP3-Ablage (Lesen/Schreiben/Loeschen)
    userStore.ts          # JSON-basierter User-Speicher (data/app-users.json)
    passwordHash.ts       # bcrypt-Passwort-Hashing
    authToken.ts          # HMAC-Token (Signierung + Verifikation)
    authMiddleware.ts     # Bearer-Auth + Admin-Check
    constants.ts          # Initiales Einladungspasswort
  src/
    App.tsx               # Haupt-React-Komponente
    components/           # UI-Komponenten (Auth, UserManagement, TagEditor, ...)
    audio/                # ID3-Tag Lesen/Schreiben, GEMA-OCR, GVL-PDF
    edl/                  # EDL-Parser, Playlist-Merge, Timecode
    storage/              # IndexedDB + lokale State-Verwaltung
    tracks/               # MP3-Verwaltung (Export, Loeschen, Platzhalter)
  data/                   # Laufzeitdaten (nicht im Git)
    app-users.json        # Benutzerdaten
    shared/tracks/        # Gemeinsame MP3-Dateien
    users/<id>/edl/       # EDL-Bibliothek pro User
```

## Lokale Entwicklung

```bash
# 1. Abhaengigkeiten installieren
npm install

# 2. Umgebungsvariablen
cp .env.example .env
# MUSICLIST_AUTH_SECRET setzen (mind. 16 Zeichen)

# 3. Starten (Vite + API gleichzeitig)
npm run dev
```

- Frontend: http://localhost:5273
- API: http://localhost:5274

Beim ersten Start gibt es noch keine Benutzer. Die App zeigt einen Bootstrap-Dialog, in dem der erste Admin-Account angelegt wird.

## Verfuegbare Scripts

| Befehl                | Beschreibung                                   |
|-----------------------|------------------------------------------------|
| `npm run dev`         | Vite-Dev-Server + Express API (concurrently)   |
| `npm run dev:vite`    | Nur Vite-Dev-Server                            |
| `npm run dev:mail`    | Nur Express API-Server                         |
| `npm run build`       | Vite Production Build (-> dist/)               |
| `npm run preview`     | Vite Preview (serviert dist/)                  |
| `npm run check:server`| TypeScript-Check fuer Server-Code              |

## Umgebungsvariablen

| Variable                   | Pflicht     | Beschreibung                                      |
|----------------------------|-------------|---------------------------------------------------|
| `MUSICLIST_AUTH_SECRET`    | Produktion  | Token-Signiergeheimnis (mind. 16 Zeichen)         |
| `MUSICLIST_APP_URL`        | Produktion  | Oeffentliche URL (z.B. https://musiclist.dsm.team) |
| `MUSICLIST_MAIL_PORT`      | Nein        | API-Port (Standard: 5274)                         |
| `MUSICLIST_DATA_DIR`       | Nein        | Datenverzeichnis (Standard: ./data)               |
| `MUSICLIST_MAIL_SECRET`    | Nein        | Schutz fuer Invite-Endpoint                       |
| `SMTP_HOST`                | Fuer Mail   | SMTP-Server                                       |
| `SMTP_PORT`                | Nein        | SMTP-Port (Standard: 587)                         |
| `SMTP_USER`                | Fuer Mail   | SMTP-Benutzername                                 |
| `SMTP_PASS`                | Fuer Mail   | SMTP-Passwort                                     |
| `SMTP_FROM`                | Nein        | Absender (Standard: dispo@dsm.team)               |

## Sicherheit

- Passwoerter werden mit **bcrypt** (10 Runden) gehasht
- Auth-Tokens sind HMAC-SHA256-signiert mit konfigurierbarem Secret
- Rate Limiting auf Login/Bootstrap (15 Versuche / 15 Min)
- CORS in Produktion auf `MUSICLIST_APP_URL` beschraenkt
- Security-Headers: X-Content-Type-Options, X-Frame-Options, Referrer-Policy
- Path-Traversal-Schutz auf allen Datei-Endpunkten
- `/users/hints` nur fuer authentifizierte Benutzer
- Shared Tracks Write/Delete nur fuer Admins
