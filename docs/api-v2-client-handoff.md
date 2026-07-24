# API-V2-Übergabe an die SpyHunt-App

## Zuständigkeitsgrenze

Die API besitzt nach V2 alle Lobby-Lese- und Schreibzugriffe. Die App verwendet Firebase nur noch für Authentifizierung und liest keine Lobbydaten direkt aus der Realtime Database.

## Zu migrierende App-Aktionen

| App-Aktion | API-Endpunkt |
|---|---|
| Lobby erstellen | `POST /api/lobby/create` |
| Lobby vor Beitritt prüfen | `POST /api/lobby/check` |
| Lobby beitreten | `POST /api/lobby/join` |
| Gefilterten Lobby-/Spielzustand lesen | `POST /api/lobby/state` |
| Agent beanspruchen | `POST /api/lobby/claim-agent` |
| Agent freigeben | `POST /api/lobby/release-agent` |
| Spiel starten | `POST /api/game/start` |
| Positionssession starten/übernehmen | `POST /api/game/position-session` |
| Agenten-QR laden | `POST /api/game/catch-token` |
| Fang melden | `POST /api/game/catch` |
| Position senden | `POST /api/game/position` |
| Presence aktualisieren | `POST /api/game/heartbeat` |
| Agentenpuls | `POST /api/game/pulse` |
| Intercept | `POST /api/game/intercept` |
| Lobby/Spiel verlassen | `POST /api/game/leave` |

Die API-Basis-URL kommt aus der freigegebenen App-Umgebung (beispielsweise `https://<vercel-projekt>.vercel.app`) und darf nicht stillschweigend zwischen Entwicklungs- und Produktivsystem wechseln. Jeder Request benötigt ein frisches Firebase-ID-Token im Header `Authorization: Bearer <token>` sowie `Content-Type: application/json`. Eine UID darf niemals in einen Request-Body aufgenommen werden.

Erfolge haben die Form `{ "ok": true, "data": { ... } }`, Fehler `{ "ok": false, "error": { "code": "...", "message": "..." } }`. Relevante stabile Codes sind `UNAUTHORIZED`, `NOT_LOBBY_MEMBER`, `NOT_ACTIVE_MEMBER`, `HOST_REQUIRED`, `LOBBY_NOT_FOUND`, `LOBBY_FULL`, `GAME_ALREADY_STARTED`, `INVALID_GAME_PHASE`, `GAME_ALREADY_ENDED`, `POSITION_SESSION_EXPIRED`, `POSITION_RATE_LIMITED` und `IMPLAUSIBLE_POSITION`.

## Notwendige Modelländerungen

- `Lobby.hostUid`, `Player.joinedAt`, `Player.accuracy` und `Player.lastSeenAt` ergänzen.
- `countdownStartLat/Lng`, `countdownViolationStartedAt` und `fieldViolationStartedAt` ergänzen.
- `positionSessionId` und `positionSequence` ergänzen.
- `agentBleUuid` entfernen. Der Agent hält das Ergebnis von `/api/game/catch-token` nur lokal für die QR-Anzeige.
- Serverwerte für Rollen, Verstöße, Eliminierungen, `gameState` und `result` ausschließlich anzeigen, niemals optimistisch überschreiben.

## Positionen

`/api/lobby/state` blendet die Live-Position des Agenten für Jäger aus und entfernt interne Positionssessionfelder sowie unbekannte Legacy-/Zukunftsfelder für alle Rollen. `agentPulseMarker` ist eine bewusste Ausnahme: Dieser zeitpunktgebundene Spielmarker enthält die beim Puls veröffentlichte Agentenposition, nicht dessen laufende Live-Position. Die App pollt den Endpunkt ohne überlappende Requests. Direkte Firebase-Listener und Realtime-Database-Reads werden vollständig entfernt.

Nach erfolgreichem Spielstart und bei jedem neuen Tracking-Lifecycle ruft die App zuerst `POST /api/game/position-session` mit `{ "lobbyCode": "abc123" }` auf. Die zurückgegebene `data.sessionId` bleibt nur im laufenden Tracker; anschließend beginnt `sequence` bei 0 und steigt pro gesendetem Fix. Die App erzeugt keine Session-UUID mehr selbst.

Die zuletzt explizit gestartete Session ist autoritativ. Startet ein zweites Gerät eine Session, wird die vorherige sofort ungültig. Das alte Gerät beendet bei `409 POSITION_SESSION_EXPIRED` seinen Tracker und darf nicht automatisch eine neue Session anfordern, weil es sonst einen Übernahme-Pingpong erzeugt. Eine erneute Übernahme muss durch einen eindeutigen App-Lifecycle beziehungsweise eine bewusste Nutzeraktion ausgelöst werden. Spielstart entfernt alle früheren Sessions.

Während ein Request läuft, nur den neuesten ausstehenden Fix behalten. `429 POSITION_RATE_LIMITED` mit begrenztem Backoff wiederholen; ältere oder doppelte Sequenzen der aktiven Session sind serverseitig idempotent. Bei `409 IMPLAUSIBLE_POSITION` den Fix verwerfen und auf eine neue GPS-Messung warten.

## Presence

Heartbeat im Lobby- und Spiel-Lifecycle alle 10–15 Sekunden ausführen und beim Cleanup stoppen. Begrenzten exponentiellen Backoff mit Jitter verwenden. Firebase `onDisconnect()` vollständig entfernen.

Die effektive Phase wird ab `gameStartedAt` berechnet. `gameDurationSec` schließt den Countdown ein; die Spielphase beginnt nach `countdownDurationSec` und endet bei `gameDurationSec`.

## Fehlerverhalten

- `401`: ID-Token aktualisieren beziehungsweise neu authentifizieren.
- `403`: keine lokale Rollen- oder Zustandsänderung durchführen.
- `404`: Lobby verlassen beziehungsweise zur Lobby-Auswahl zurückkehren.
- `409`: Lobby-Snapshot abwarten/neu laden und Serverzustand anzeigen.
- `429`: neuesten Positionsfix verzögert erneut senden, keine Queue aufbauen.

## Entfernen direkter Firebase-Realtime-Database-Zugriffe

In der App dürfen keine Imports aus `firebase/database`, keine Realtime-Database-Listener und keine Aufrufe wie `get`, `onValue`, `set`, `update`, `remove`, `runTransaction` oder `onDisconnect` verbleiben. Firebase wird clientseitig ausschließlich für Authentication verwendet. `finalizeGame()` sowie clientseitige Eliminierungs- und Spielende-Timer müssen entfernt werden; lokale Berechnungen dürfen nur UI-Hinweise liefern.

## Rollout-Grenze

Alte Lobbys können `hostUid`, `joinedAt`, `lastSeenAt`, Positionssession- und weitere V2-Felder nicht besitzen und werden nicht automatisch migriert. Ab Beginn des Rollouts dürfen alte App-Versionen keine neuen Legacy-Lobbys mehr erzeugen. Für die geschlossene Alpha bestehende Lobbys auslaufen lassen beziehungsweise löschen und erst danach die aktualisierten Clients zulassen.

Verbindliche Reihenfolge:

1. API nach ausdrücklicher Freigabe bereitstellen und Basis-URL/Secrets konfigurieren.
2. Angular-App auf sämtliche V2-Endpunkte einschließlich Positionssession aktualisieren.
3. Mehrgeräte-, Session-Übernahme- und Reconnect-Tests durchführen.
4. Nachweisen, dass keine direkten Firebase-Realtime-Database-Zugriffe verbleiben.
5. Erst danach Database Rules auf `.read: false` und `.write: false` setzen und im Rules Emulator prüfen.

Erforderliche Origins sind `http://localhost:4200`, `https://localhost` und `capacitor://localhost`. Serverseitig erforderlich sind Firebase-Admin-Konfiguration, `CRON_SECRET` und ein mindestens 32 Byte langes `CATCH_TOKEN_SECRET`; kein Secret gehört in die App. In diesem Arbeitsschritt erfolgt ausdrücklich kein Vercel- oder Firebase-Deployment.

## Offene Betriebsrisiken

Für die geschlossene Alpha existiert außer dem Positionslimit noch kein allgemeines verteiltes Rate-Limit. Vor öffentlicher Nutzung Lobby-Erstellung und Mutationen UID-/IP-basiert begrenzen. Anonyme Firebase-Konten sind keine Personenidentität und können massenhaft erzeugt werden; Quoten, Monitoring und Account-Bereinigung einplanen. Firebase App Check kann als zusätzliche Gerätesignalkontrolle integriert werden, wird von der API derzeit aber nicht geprüft. Der Cleanup lädt nicht mehr den gesamten Baum, sondern höchstens 100 nach `createdAt` gefilterte Einträge; dafür ist in den produktiven RTDB-Rules ein Index auf `createdAt` erforderlich.
