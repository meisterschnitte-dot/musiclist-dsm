# Deployment: musiclist.dsm.team

## Voraussetzungen Server

- Debian/Ubuntu mit Node.js >= 18
- PM2 (`npm install -g pm2`)
- Nginx als Reverse Proxy
- Let's Encrypt (certbot) fuer SSL

## Server-Details

| Eigenschaft | Wert                          |
|-------------|-------------------------------|
| Server      | 37.27.189.89 (Hetzner)        |
| Domain      | musiclist.dsm.team            |
| Pfad        | /opt/musiclist-dsm            |
| API-Port    | 5274                          |
| PM2-Name    | musiclist                     |
| Daten       | /opt/musiclist-dsm/data/      |

## Erstinstallation

### 1. Repository klonen

```bash
cd /opt
git clone https://github.com/meisterschnitte-dot/musiclist-dsm.git
cd musiclist-dsm
npm install
```

### 2. Umgebungsvariablen

```bash
cp .env.example .env
nano .env
```

Folgende Werte setzen:

```env
MUSICLIST_AUTH_SECRET=<sicherer-zufalls-string-mind-16-zeichen>
MUSICLIST_APP_URL=https://musiclist.dsm.team
MUSICLIST_MAIL_PORT=5274
NODE_ENV=production

SMTP_HOST=w0119329.kasserver.com
SMTP_PORT=587
SMTP_USER=dispo@dsm.team
SMTP_PASS=<passwort>
SMTP_FROM=dispo@dsm.team
```

### 3. Frontend bauen

```bash
npx vite build
```

### 4. PM2-Prozess starten

```bash
pm2 start "npx tsx server/mailServer.ts" --name musiclist
pm2 save
```

### 5. Nginx konfigurieren

```nginx
server {
    listen 80;
    server_name musiclist.dsm.team;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name musiclist.dsm.team;

    ssl_certificate /etc/letsencrypt/live/musiclist.dsm.team/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/musiclist.dsm.team/privkey.pem;

    # Statische Frontend-Dateien
    root /opt/musiclist-dsm/dist;
    index index.html;

    # API -> Express
    location /api/ {
        proxy_pass http://127.0.0.1:5274;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 15m;
    }

    # SPA-Fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

```bash
sudo nginx -t
sudo systemctl reload nginx
```

### 6. SSL-Zertifikat

```bash
sudo certbot --nginx -d musiclist.dsm.team
```

### 7. Erster Admin

Die App im Browser oeffnen (https://musiclist.dsm.team). Beim ersten Aufruf erscheint der Bootstrap-Dialog, in dem der erste Admin-Account angelegt wird.

## Updates deployen

Nach Aenderungen auf GitHub:

```bash
cd /opt/musiclist-dsm
git pull origin main
npm install
npx vite build
pm2 restart musiclist
```

## Nuetzliche Befehle

```bash
pm2 list                    # Alle Prozesse anzeigen
pm2 logs musiclist          # Logs anzeigen
pm2 restart musiclist       # Neustart
pm2 stop musiclist          # Stoppen
```

## Backups

Die Daten liegen in `/opt/musiclist-dsm/data/`:

- `app-users.json` — Benutzerdaten
- `shared/tracks/` — Gemeinsame MP3-Dateien
- `users/<id>/edl/` — EDL-Bibliotheken pro User

Ein einfaches Backup:

```bash
tar -czf /root/musiclist-backup-$(date +%F).tar.gz /opt/musiclist-dsm/data/
```
