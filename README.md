# SpyHunt Game API

Autoritative Vercel API für Lobby- und Spielzugriffe von SpyHunt. App-Clients lesen und verändern Lobbydaten ausschließlich über diese API; Firebase wird clientseitig nur noch für Authentication verwendet. Der separate Agora-Tokenserver bleibt unverändert.

## Voraussetzungen

- Node.js 22
- npm
- Firebase Realtime Database
- eigenes, möglichst eingeschränktes Firebase-Servicekonto
- Vercel-Projekt für das spätere Deployment

## Installation und Prüfung

```bash
npm ci
npm run build
npm test
npm audit --omit=dev
```

Es gibt bewusst keinen automatischen Deployment-Befehl.

## Umgebungsvariablen

```dotenv
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
FIREBASE_DATABASE_URL=
ALLOWED_ORIGINS=http://localhost:4200,https://localhost,capacitor://localhost
CRON_SECRET=
CATCH_TOKEN_SECRET=
```

`CATCH_TOKEN_SECRET` muss mindestens 32 UTF-8-Bytes enthalten. Es dient zur HMAC-Ableitung der Fangtokens und darf niemals an die App gelangen. Eine Rotation macht alle QR-Tokens laufender Spiele ungültig.

`FIREBASE_PRIVATE_KEY` unterstützt escaped Zeilenumbrüche (`\\n`). Keine echten Secrets, ID-Tokens, Fangtokens oder GPS-Koordinaten einchecken oder loggen.

Die Origin-Liste ist eine exakte Allowlist: Angular lokal verwendet `http://localhost:4200`, die Capacitor-Standardkonfiguration verwendet je nach Plattform `https://localhost` beziehungsweise `capacitor://localhost`. Wildcards sind für authentifizierte App-Requests nicht vorgesehen. Dynamische CORS-Antworten enthalten `Vary: Origin`.

## Gemeinsamer HTTP-Vertrag

Alle fachlichen Endpunkte verwenden `POST`, JSON und ein Firebase-ID-Token:

```http
Authorization: Bearer <Firebase-ID-Token>
Content-Type: application/json
```

Die UID stammt ausschließlich aus `verifyIdToken()`. Unbekannte Request-Felder werden mit `400 UNKNOWN_FIELD` abgelehnt.

Erfolg:

```json
{ "ok": true, "data": {} }
```

Fehler:

```json
{
  "ok": false,
  "error": { "code": "LOBBY_NOT_FOUND", "message": "Lobby not found" }
}
```

Verwendete Statusklassen:

- `400`: syntaktisch oder fachlich ungültige Eingabe
- `401`: fehlendes oder ungültiges Firebase-ID-Token
- `403`: fehlende Mitgliedschaft oder falsche Rolle
- `404`: Lobby nicht gefunden
- `409`: Zustandskonflikt
- `429`: Positionsupdate zu schnell
- `500`: interner Fehler ohne Firebase- oder Secret-Details

## Endpunkte

### Allgemein

- `GET /api/health` – Healthcheck ohne Konfigurationsdetails
- `GET /api/maintenance/cleanup-lobbies` – tägliche Bereinigung, ausschließlich mit `Bearer <CRON_SECRET>`
- `GET /api/spyhuntgame` – kompatibler Alias des Cleanup-Handlers

### Lobby

- `POST /api/lobby/create`

```json
{
  "lobbyCode": "abc123",
  "gameField": { "north": 51.6, "south": 51.5, "east": 10.2, "west": 10.1 },
  "settings": {
    "gameDurationSec": 1800,
    "countdownDurationSec": 240,
    "pulseIntervalSec": 300,
    "agentInterceptEnabled": false
  },
  "player": { "nickname": "Alex", "color": "#E53935" }
}
```

- `POST /api/lobby/check` – Body `{ "lobbyCode": "abc123" }`; liefert nur Beitrittsstatus, belegte Farben und Spielerzahl
- `POST /api/lobby/join` – Body mit `lobbyCode` und `player`; Wiederholung derselben UID ist idempotent
- `POST /api/lobby/state` – Body `{ "lobbyCode": "abc123" }`; liefert ausschließlich die für das Mitglied freigegebene Lobby-Sicht
- `POST /api/lobby/claim-agent` – Body `{ "lobbyCode": "abc123" }`; bei Parallelität gewinnt genau eine Transaktion
- `POST /api/lobby/release-agent` – Body `{ "lobbyCode": "abc123" }`

Erlaubte Spielerfarben:

```text
#E53935 #1E88E5 #43A047 #FB8C00 #8E24AA #00ACC1
```

Nicknames werden getrimmt, interne Leerzeichen normalisiert und auf acht Zeichen begrenzt.

### Spiel

- `POST /api/game/start` – `{ "lobbyCode": "abc123" }`; ausschließlich der Host, 2–6 Spieler, genau ein Agent
- `POST /api/game/position-session` – `{ "lobbyCode": "abc123" }`; erzeugt die einzige aktive, serverautorisierte Positionssession des Mitglieds
- `POST /api/game/catch-token` – `{ "lobbyCode": "abc123" }`; Token nur für den aktiven Agenten, Antwort mit `Cache-Control: no-store`
- `POST /api/game/catch` – `{ "lobbyCode": "abc123", "scannedToken": "v1.…" }`; ausschließlich aktive Jäger
- `POST /api/game/position`

```json
{
  "lobbyCode": "abc123",
  "lat": 51.55,
  "lng": 10.15,
  "accuracy": 8.5,
  "sessionId": "123e4567-e89b-42d3-a456-426614174000",
  "sequence": 12
}
```

- `POST /api/game/heartbeat` – `{ "lobbyCode": "abc123" }`
- `POST /api/game/pulse` – `{ "lobbyCode": "abc123", "pulseIndex": 1 }`
- `POST /api/game/intercept` – `{ "lobbyCode": "abc123" }`
- `POST /api/game/leave` – `{ "lobbyCode": "abc123" }`

## Positions- und Presence-Vertrag

Die App liest Lobby- und Spielzustand ausschließlich über `/api/lobby/state`. Jäger erhalten dort niemals die Live-Position des Agenten. Interne `positionSessionId`- und `positionSequence`-Felder sowie unbekannte Legacy- oder Zukunftsfelder werden über eine explizite Response-Allowlist entfernt. Die einzige absichtlich sichtbare Agentenkoordinate ist `agentPulseMarker`: Sie ist ein zeitpunktgebundener, vom Agenten ausgelöster Spielmarker und keine Live-Position. Für die geschlossene Alpha pollt die App diesen Endpunkt überlappungsfrei; die Polling-Last ist vor einer öffentlichen Freigabe neu zu bewerten.

- Genauigkeit: maximal 30 Meter
- Mindestabstand zwischen akzeptierten Positionsupdates: 1,5 Sekunden
- maximale plausible Geschwindigkeit: 25 m/s nach Abzug beider GPS-Ungenauigkeiten
- `sessionId`: vom Server über `/api/game/position-session` erzeugte UUID
- `sequence`: nichtnegative, streng steigende sichere Ganzzahl
- doppelte oder ältere Sequenzen derselben Session sind idempotente No-ops
- die zuletzt explizit gestartete Session gewinnt; alte oder fremde Sessions erhalten `409 POSITION_SESSION_EXPIRED`
- der Spielstart löscht vorherige Sessiondaten; jeder Client startet danach ausdrücklich eine neue Session und beginnt bei Sequenz 0
- jede akzeptierte Position ist gleichzeitig ein Heartbeat
- Heartbeat-Empfehlung bei Stillstand: alle 10–15 Sekunden
- Disconnect-Markierung nach 30 Sekunden ohne Lebenszeichen
- Eliminierung nach weiteren 60 Sekunden
- Countdown-Radius: 5 Meter; Startpunkt wird nur bei höchstens 15 Metern Genauigkeit gesetzt
- Feld- und Countdown-Verstoß führen nach 60 Sekunden zur serverseitigen Eliminierung

Die App soll bei einem laufenden Positionsrequest höchstens die neueste noch nicht gesendete Position behalten.

## Fangtoken

`agentBleUuid` wird nicht mehr in das Lobbyobjekt geschrieben. Das Token hat das Format `v1.<base64url-hmac>` und ist an Lobby-Code, Startzeit sowie Agenten-UID gebunden. Nur der Agent lädt es über `/api/game/catch-token`; der Catch-Handler leitet den Sollwert erneut ab und verwendet einen konstantzeitgeeigneten Vergleich.

## Serverseitige Zustandsüberwachung

Jede mutierende Spielaktion und jeder Heartbeat führt innerhalb der Lobby-Transaktion `reconcileLobby(now)` aus. Die Funktion behandelt Zeitablauf, fehlende Pulse, Presence, Disconnects, Verstöße, Agenteneliminierung und zu wenige aktive Spieler. Ein vorhandenes Ergebnis wird niemals überschrieben.

`gameDurationSec` wird wie im bisherigen Client ab `gameStartedAt` gemessen und schließt den Countdown ein: Bis `countdownDurationSec` gilt `countdown`, danach `playing`, und bei `gameDurationSec` endet das Spiel.

Wenn alle Geräte offline sind, erfolgt die Entscheidung erst beim nächsten Request oder bei der täglichen Bereinigung. Diese Einschränkung ist für die geschlossene Alpha akzeptiert.

Die Bereinigung fragt höchstens 100 Lobbys pro Lauf mit `createdAt <= cutoff` ab und prüft jeden Treffer unmittelbar vor dem Löschen erneut. Die produktiven Realtime-Database-Rules müssen für `lobbies` einen Index `".indexOn": "createdAt"` definieren; Rules werden in diesem Repository nicht verwaltet. Bei dauerhaft mehr als 100 abgelaufenen Lobbys werden weitere Einträge in späteren täglichen Läufen entfernt.

## Betriebsrisiken der Alpha

- Ein allgemeines, verteiltes Rate-Limit für Lobby-Erstellung und sonstige Endpunkte ist noch nicht implementiert. Das Positionslimit schützt nur Positionsupdates innerhalb einer Lobby. Für die geschlossene Alpha ist das vertretbar; vor einer öffentlichen Freigabe sind Vercel Firewall/Rate Limiting oder ein zentraler, UID- und IP-basierter Limiter erforderlich.
- Firebase Anonymous Auth liefert gültige, aber keine vertrauenswürdige Personenidentität. Automatisierte Clients können viele Konten und damit Projekt-/Auth-Quoten verbrauchen. Provider-Quoten und Monitoring sollten aktiviert, alte anonyme Konten regelmäßig bereinigt und sensible Aktionen zusätzlich begrenzt werden.
- Firebase App Check wird derzeit nicht serverseitig verifiziert. Vor einer öffentlichen Freigabe kann der Client ein App-Check-Token mitsenden und die API es mit Firebase Admin `appCheck().verifyToken()` prüfen. Das ergänzt Auth und Rate-Limits, ersetzt sie aber nicht.
- Cleanup ist jetzt nach `createdAt` begrenzt, bleibt aber ein Batch von maximal 100 Einträgen und ist kein sekundengenauer Lifecycle-Worker.

## Rollout und Firebase Rules

Noch keine produktiven Rules ändern, solange eine veröffentlichte Angular-App direkte Firebase-Zugriffe enthält. Sichere Reihenfolge:

1. API lokal und später in einer freigegebenen Umgebung bereitstellen.
2. Angular-App vollständig auf diese Endpunkte migrieren.
3. Mehrgeräte-, Reconnect- und Race-Condition-Tests durchführen.
4. Nachweisen, dass keine direkten Client-Lese- oder Schreibzugriffe verbleiben.
5. Erst dann die Lobby-Rules für Clients auf `.read: false` und `.write: false` setzen und mit dem Rules Emulator testen.

Alte App-Versionen dürfen ab Beginn der Umstellung keine neuen Legacy-Lobbys mehr erstellen. Für die Alpha werden bestehende Lobbys vor dem App-Update ausgelaufen beziehungsweise gelöscht; eine gemischte V1/V2-Lobby wird nicht migriert. Ein Deployment erfolgt ausschließlich nach ausdrücklicher Freigabe.

Details für das App-System stehen in [docs/api-v2-client-handoff.md](docs/api-v2-client-handoff.md). Die vollständige Anforderung befindet sich in [docs/Specs/anforderung-vercel-game-api-v2-keine-client-schreibzugriffe.md](docs/Specs/anforderung-vercel-game-api-v2-keine-client-schreibzugriffe.md).
