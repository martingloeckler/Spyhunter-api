# SpyHunt Game API

Diese API stellt autoritative Spielaktionen für SpyHunt auf Vercel bereit und bleibt unabhängig vom bestehenden Agora-Tokenserver.

## Zweck und Abgrenzung

- Bietet serverseitige Mutationen für Spielstart, Fang, Pulse, Intercept und Verlassen.
- Verwendet Firebase Admin SDK mit der bestehenden Realtime Database.
- Nutzt keine Firebase Cloud Functions und kein Blaze-Konto.
- Ändert den bestehenden Agora-Tokenserver nicht.

## Voraussetzungen

- Node.js 22
- npm
- Firebase Realtime Database
- Vercel Account

## Installation

```bash
npm install
cp .env.example .env.local
```

## Umgebung

Setze die folgenden Variablen:

- FIREBASE_PROJECT_ID
- FIREBASE_CLIENT_EMAIL
- FIREBASE_PRIVATE_KEY
- FIREBASE_DATABASE_URL
- ALLOWED_ORIGINS
- CRON_SECRET

Die Datei [.env.example](.env.example) enthält nur Platzhalter.

## Lokaler Start

```bash
npm run build
npm test
```

## API

### Health

GET /api/health

Response:

```json
{
  "ok": true,
  "data": {
    "service": "spyhunt-game-api"
  }
}
```

### Start

POST /api/game/start

Body:

```json
{
  "lobbyCode": "abc123"
}
```

### Catch

POST /api/game/catch

Body:

```json
{
  "lobbyCode": "abc123",
  "scannedToken": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

### Pulse

POST /api/game/pulse

Body:

```json
{
  "lobbyCode": "abc123",
  "pulseIndex": 1
}
```

### Intercept

POST /api/game/intercept

Body:

```json
{
  "lobbyCode": "abc123"
}
```

### Leave

POST /api/game/leave

Body:

```json
{
  "lobbyCode": "abc123"
}
```

### Maintenance

GET /api/spyhuntgame

Authorization: Bearer <CRON_SECRET>

## Fehlercodes

- LOBBY_NOT_FOUND
- INVALID_INPUT
- UNAUTHORIZED
- FORBIDDEN
- GAME_ALREADY_STARTED
- GAME_ALREADY_ENDED
- INTERCEPT_ALREADY_USED
- INVALID_STATE

## Firebase-Servicekonto

Erstelle ein eigenes Servicekonto für dieses Projekt mit Zugriff auf die Realtime Database. Verwende nur die minimalen Rechte, die für die API erforderlich sind. Kein bestehender Service-Account des Agora-Tokenservers.

## Vercel-Umgebungsvariablen

Lege in Vercel die gleichen Variablen wie in der lokalen .env-Datei an. Achte darauf, dass FIREBASE_PRIVATE_KEY die Zeilenumbrüche korrekt escaped enthält.

## Cron-Job

Der tägliche Cron-Job läuft in UTC zu 03:00 Uhr. Lobbys bleiben eventuell bis zu etwa 24 Stunden länger erhalten, weil Vercel Hobby-Cron nur grob geplant wird.

## Sicherheitsannahmen und Alpha-Einschränkungen

- Keine echten Secrets im Repository.
- Keine vollständige Migration aller direkten Client-Schreibrechte.
- Die Puls-Validierung verwendet ein Frischefenster von 60 Sekunden.
- Die API validiert Serverzeit und Token-Identität selbst.

## Abhängigkeits-Upgrade-Roadmap

Eine detaillierte Roadmap für zukünftige Abhängigkeits-Upgrades ist in [docs/upgrade-roadmap.md](docs/upgrade-roadmap.md) beschrieben.

## Angular-Integration

1. API lokal bauen und testen.
2. Neues Vercel-Projekt mit eigenen Secrets anlegen.
3. Angular um einen gameApiUrl-Parameter ergänzen.
4. Firebase Bearer-Token an die API übergeben.
5. Aktionen einzeln migrieren: Start → Catch → Pulse → Intercept → Leave.
