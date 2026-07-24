# Anforderung V2: Keine direkten Firebase-Schreibzugriffe aus der SpyHunt-App

> Nachtrag: Der spätere Sicherheitsumbau ersetzt auch sämtliche direkten Firebase-Reads durch den gefilterten Endpunkt `POST /api/lobby/state`. Die App verwendet keine Realtime-Database-Listener mehr; finale Client-Rules setzen `.read` und `.write` auf `false`. Abweichende Read-Aussagen in diesem historischen V2-Dokument sind durch diesen Nachtrag überholt.

## 1. Auftrag

Erweitere das bestehende Projekt `spyhunt-game-api` und migriere anschließend die
Angular-/Capacitor-App so, dass kein App-Client mehr direkt in die Firebase
Realtime Database schreibt.

Nach Abschluss gilt:

- App-Clients lesen weiterhin autorisierte Echtzeitdaten direkt aus Firebase.
- Sämtliche Mutationen laufen ausschließlich über die Vercel Game API.
- Die Firebase Database Rules setzen für App-Clients alle Schreibrechte auf
  `false`.
- Das Firebase Admin SDK der API umgeht die Rules und ist der einzige
  schreibberechtigte Datenbankzugang.
- Der bestehende Agora-Tokenserver bleibt ein separates Projekt und unverändert.

Betroffene Projekte:

```text
D:\source\nodejs\spyhunt-game-api
D:\source\angular\spyhunt
```

Kein Deployment und keine Änderung produktiver Firebase-Daten ohne ausdrückliche
Freigabe durchführen.

## 2. Ausgangslage

Die Game API deckt bereits folgende Aktionen ab:

- Spielstart
- QR-Fang
- Agentenpuls
- Intercept
- freiwilliges Verlassen
- tägliche Lobby-Bereinigung

Die App schreibt noch direkt für:

- Lobby-Erstellung
- Lobby-Beitritt
- Agentenrolle beanspruchen und freigeben
- eigene GPS-Position
- Reconnect und `onDisconnect`
- `disconnectedAt`
- Countdown- und Spielfeld-Verstoßsstatus
- Selbsteliminierung nach Regelverstoß
- Eliminierung anderer Spieler nach Disconnect
- mehrere Spielende-Szenarien

Die bestehenden API-Handler müssen außerdem korrigiert werden: Ein
Transaktions-Callback darf bei einer abgelehnten Aktion nicht einfach das
unveränderte Objekt zurückgeben und anschließend HTTP 200 melden. Fachlich
abgelehnte Aktionen müssen einen eindeutigen `4xx`-Status und Fehlercode liefern.

## 3. Ziele

1. Vollständig autoritative Mutationen über die Game API.
2. Keine direkten Firebase-Schreibrechte für anonyme App-Benutzer.
3. Atomare Rollen-, Status-, Eliminierungs- und Spielende-Entscheidungen.
4. Serverseitige Zeit als einzige Grundlage für Fristen und Ergebnisse.
5. Fangtoken darf für Jäger nicht aus Firebase auslesbar sein.
6. Positions- und Presence-Verarbeitung muss trotz Wegfall von `onDisconnect`
   funktionieren.
7. Wiederholte, parallele und verspätete HTTP-Aufrufe müssen sicher behandelt
   werden.
8. Die bestehende Echtzeitdarstellung über Firebase Listener bleibt erhalten.

## 4. Nicht-Ziele

- Keine Migration der Firebase Reads auf die Vercel API.
- Kein WebSocket-Server und keine dauerhafte Vercel-Instanz.
- Keine Firebase Cloud Functions und kein Blaze-Tarif.
- Kein Schutz vor manipulierten Betriebssystemen oder gefälschten GPS-Sensoren.
- Keine Änderung am Agora-Tokenserver.
- Kein automatisches Deployment.

## 5. Sicherheitsmodell

### 5.1 Authentifizierung

Jeder API-Aufruf verwendet:

```http
Authorization: Bearer <Firebase-ID-Token>
```

Die UID stammt ausschließlich aus `verifyIdToken()`. Eine UID im Body wird
ignoriert bzw. als unbekanntes Feld abgelehnt.

### 5.2 Autorisierung

Jeder Handler prüft innerhalb derselben atomaren Operation:

- Lobby existiert,
- Aufrufer ist Lobby-Mitglied,
- Rolle und Eliminierungsstatus passen zur Aktion,
- Spielphase erlaubt die Aktion,
- Eingaben und Zustandsübergang sind gültig.

### 5.3 Keine generische Mutation

Es darf keinen Endpunkt geben, der beliebige Firebase-Pfade, Spieler-UIDs,
Gewinner, Ergebnisgründe oder Zeitstempel aus einem Client-Body übernimmt.

### 5.4 Servicekonto

- Eigenes Servicekonto nur für `spyhunt-game-api`.
- Keine Editor-/Owner-Rolle, sofern sich die benötigten Realtime-Database-Rechte
  enger vergeben lassen.
- Schlüssel ausschließlich in Vercel Environment Variables.
- Keine Secrets oder ID-Tokens in Logs.

## 6. Datenmodell V2

### 6.1 Lobby

Das Lobby-Modell wird erweitert:

```ts
interface Lobby {
  hostUid: string;
  createdAt: number;
  lastActivityAt: number;
  gameState: 'lobby' | 'countdown' | 'playing' | 'ended';
  gameStartedAt: number | null;
  gameField: GameField;
  settings: GameSettings;
  players: Record<string, Player>;
  agentInterceptUsed?: boolean;
  agentPulseMarker?: AgentPulseMarker;
  result?: GameResult;
}
```

`agentBleUuid` wird aus dem öffentlich lesbaren Lobbyobjekt entfernt.

### 6.2 Spieler

```ts
interface Player {
  uid: string;
  nickname: string;
  color: string;
  role: 'agent' | 'hunter' | null;
  joinedAt: number;

  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  positionUpdatedAt: number | null;
  lastSeenAt: number;

  disconnectedAt: number | null;
  eliminated: boolean;
  eliminatedReason:
    | 'field_violation'
    | 'movement_restriction'
    | 'disconnect_timeout'
    | 'voluntary'
    | null;

  countdownStartLat: number | null;
  countdownStartLng: number | null;
  countdownViolationStartedAt: number | null;
  countdownViolation: boolean | null;

  fieldViolationStartedAt: number | null;
  fieldViolationActive: boolean | null;

  positionSessionId?: string;
  positionSequence?: number;
}
```

Alle Zeitstempel werden serverseitig gesetzt.

### 6.3 Fangtoken

Der Fangtoken darf nicht mehr in einem für alle Lobby-Mitglieder lesbaren Pfad
stehen.

Bevorzugte Lösung:

- Neue Vercel-Umgebungsvariable `CATCH_TOKEN_SECRET` mit mindestens 32 zufälligen
  Bytes.
- Token deterministisch und nicht erratbar als HMAC aus
  `lobbyCode`, `gameStartedAt` und Agenten-UID ableiten.
- Format versionieren, beispielsweise `v1.<base64url-signature>`.
- Nur der Agent erhält den Token über einen authentifizierten API-Endpunkt.
- Der Catch-Endpunkt berechnet den erwarteten Token erneut und vergleicht ihn mit
  konstantzeitgeeignetem Vergleich.
- Ein neuer Spielstart erzeugt durch die neue Startzeit automatisch einen neuen
  Token.
- Rotation von `CATCH_TOKEN_SECRET` macht aktive QR-Tokens ungültig und muss im
  README dokumentiert werden.

Keine Roh-Tokens, Token-Hashes oder privaten Secrets loggen.

## 7. API-Endpunkte

Alle mutierenden Endpunkte sind `POST`, erwarten JSON und verwenden den bereits
definierten einheitlichen Erfolgs-/Fehlervertrag.

### 7.1 Lobby erstellen

`POST /api/lobby/create`

Body:

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
  "player": {
    "nickname": "Alex",
    "color": "#E53935"
  }
}
```

Anforderungen:

- Lobby-Code, Spielfeld, Settings, Nickname und Farbe serverseitig validieren.
- Atomar fehlschlagen, wenn Lobby-Code bereits existiert.
- `hostUid` und erster Spieler werden aus der authentifizierten UID erzeugt.
- Alle Spielerstatusfelder serverseitig initialisieren.
- `createdAt`, `joinedAt`, `lastSeenAt` und `lastActivityAt` serverseitig setzen.
- Ergebnis `LOBBY_ALREADY_EXISTS` bei Konflikt.

### 7.2 Lobby prüfen

`POST /api/lobby/check`

Body:

```json
{ "lobbyCode": "abc123" }
```

Antwort enthält ausschließlich:

- ob Beitritt möglich ist,
- belegte Farben,
- Spielerzahl,
- stabilen Fehlercode für nicht gefunden, voll oder bereits gestartet.

Keine vollständigen Spielerprofile, Positionen oder internen Lobbydaten an
Nichtmitglieder zurückgeben.

### 7.3 Lobby beitreten

`POST /api/lobby/join`

Body enthält Lobby-Code, Nickname und Farbe.

Innerhalb einer Transaktion prüfen:

- Lobby existiert und ist im Zustand `lobby`,
- maximal sechs Spieler,
- Nickname case-insensitiv eindeutig,
- Farbe eindeutig und aus der erlaubten Palette,
- wiederholter Aufruf derselben UID ist idempotent.

Der Server initialisiert alle Spielerfelder und Zeitstempel.

### 7.4 Agentenrolle beanspruchen

`POST /api/lobby/claim-agent`

- Aufrufer ist aktives Lobby-Mitglied.
- Lobby ist noch nicht gestartet.
- Noch kein anderer Spieler ist Agent.
- Atomar eigene Rolle auf `agent` setzen.
- Parallele Aufrufe: exakt einer gewinnt.

### 7.5 Agentenrolle freigeben

`POST /api/lobby/release-agent`

- Nur der aktuelle Agent darf seine eigene Rolle freigeben.
- Nur im Zustand `lobby`.
- Idempotente Wiederholung zulassen.

### 7.6 Spielstart erweitern

Bestehenden Endpunkt `POST /api/game/start` ändern:

- Nur `hostUid` darf starten.
- Mindestens zwei und höchstens sechs aktive Spieler.
- Genau ein Agent.
- Alle anderen Spieler werden Jäger.
- Startzeit und Zustände serverseitig setzen.
- Kein öffentliches `agentBleUuid` mehr schreiben.
- Vorhandene Ergebnisse, Pulse und Verstoßstatus zurücksetzen.
- Paralleler Start erzeugt exakt einen Startzustand.

### 7.7 Fangtoken für Agent

`POST /api/game/catch-token`

Body:

```json
{ "lobbyCode": "abc123" }
```

- Aufrufer muss aktiver Agent sein.
- Effektive Phase muss `countdown` oder `playing` sein.
- Token serverseitig ableiten und nur diesem Agenten zurückgeben.
- Antwort mit `Cache-Control: no-store`.

### 7.8 Fang bestätigen

Bestehenden Endpunkt `POST /api/game/catch` ändern:

- UUID-Anforderung entfernen und versioniertes Tokenformat validieren.
- Aufrufer ist aktiver Jäger.
- Effektive Phase ist `playing`.
- Token für Lobby/Start/Agent serverseitig neu berechnen.
- Konstantzeitvergleich verwenden.
- Erstes korrektes Ergebnis gewinnt.
- Falscher Token liefert `409 INVALID_CATCH_TOKEN`, niemals HTTP 200.

### 7.9 Position und Presence aktualisieren

`POST /api/game/position-session`

Authentifiziert, Body `{ "lobbyCode": "abc123" }`. Der Server erzeugt atomar eine UUID als aktive `positionSessionId`, setzt `positionSequence` zurück und gibt die UUID zurück. Nur aktive Mitglieder dürfen eine Session starten. Die zuletzt explizit gestartete Session gewinnt; damit werden vorherige Sessions anderer Geräte ungültig.

`POST /api/game/position`

Body:

```json
{
  "lobbyCode": "abc123",
  "lat": 51.55,
  "lng": 10.15,
  "accuracy": 8.5,
  "sessionId": "uuid",
  "sequence": 12
}
```

Prüfungen:

- Aufrufer ist aktives Mitglied.
- Effektive Phase ist `countdown` oder `playing`.
- Koordinaten, Genauigkeit, Session-ID und Sequenz sind gültig.
- Serverzeit statt Clientzeit verwenden.
- Veraltete oder doppelte Sequenzen derselben Session idempotent ignorieren.
- Unplausible Sprünge über benannte Geschwindigkeitsgrenze ablehnen; GPS-
  Genauigkeit berücksichtigen.
- Request-Rate serverseitig begrenzen. Zu schnelle Updates mit `429` oder
  idempotentem No-op beantworten.

Atomar aktualisieren:

- `lat`, `lng`, `accuracy`, `positionUpdatedAt`, `lastSeenAt`,
- `positionSessionId`, `positionSequence`,
- `lastActivityAt`.

Die App darf Positionsrequests nicht unbegrenzt aufstauen. Bei einem laufenden
Request wird höchstens die neueste noch nicht gesendete Position behalten.

### 7.10 Heartbeat

`POST /api/game/heartbeat`

Body:

```json
{ "lobbyCode": "abc123" }
```

- Aufrufer ist Lobby-Mitglied.
- Aktualisiert `lastSeenAt` serverseitig.
- Wird während Lobby und Spiel regelmäßig aufgerufen, auch wenn sich das Gerät
  nicht bewegt.
- Empfohlenes Intervall für die Alpha: 10 bis 15 Sekunden.
- Netzwerkfehler mit begrenztem exponentiellem Backoff und Jitter behandeln.

Jede Position gilt gleichzeitig als Heartbeat.

### 7.11 Freiwilliges Verlassen

Bestehenden Endpunkt `POST /api/game/leave` für Lobby und Spiel beibehalten und
ergänzen:

- Vor dem Spiel eigenen Eintrag entfernen.
- Verlässt der Host, Hostrolle deterministisch an den ältesten verbleibenden
  Spieler (`joinedAt`, danach UID) übertragen.
- Leere Lobby löschen.
- Im Spiel Jäger als freiwillig eliminiert markieren.
- Agentenaustritt beendet das Spiel mit `agent_left`.
- Zu wenige aktive Spieler beenden das Spiel mit `too_few_players`.
- Bereits beendete Ergebnisse niemals überschreiben.

## 8. Serverseitige Regel- und Zeitüberwachung

Vercel Hobby bietet keinen präzisen sekündlichen Scheduler. Deshalb führt jede
mutierende Spielaktion und jeder Heartbeat eine gemeinsame, atomare
`reconcileLobby(now)`-Funktion aus.

Diese Funktion entscheidet in dieser Reihenfolge:

1. Bereits beendetes Spiel unverändert lassen.
2. Effektive Phase aus Startzeit und Settings berechnen.
3. Ablauf der Gesamtspielzeit → Agent gewinnt mit `time_up`.
4. Überfälligen Agentenpuls inklusive Toleranz prüfen → Ergebnis
   `agent_offline_pulse`.
5. Presence aller Spieler anhand `lastSeenAt` prüfen.
6. Nach Disconnect-Schwelle `disconnectedAt` setzen.
7. Nach 60 Sekunden Offlinezeit Spieler mit `disconnect_timeout` eliminieren.
8. Agenten-Disconnect → Jäger gewinnen mit `agent_disconnected`.
9. Zu wenige aktive Spieler → `too_few_players`.
10. Laufende Bewegungs-/Spielfeldverstöße prüfen und ggf. eliminieren.

Alle Ergebnisse sind `first write wins` und dürfen ein vorhandenes Resultat nicht
überschreiben.

Wenn alle Geräte offline sind, erfolgt die Entscheidung erst beim nächsten
Request oder bei der täglichen Bereinigung. Diese serverlose Einschränkung ist
für die Alpha zu dokumentieren.

## 9. Serverseitige Verstoßsermittlung

### 9.1 Countdown-Bewegungsbeschränkung

- Bei der ersten hinreichend genauen Jägerposition im Countdown setzt der Server
  `countdownStartLat/Lng`.
- Entfernung zur Startposition serverseitig per Haversine berechnen.
- Gemeldete Genauigkeit wie bisher berücksichtigen.
- Bei Überschreitung `countdownViolationStartedAt` und
  `countdownViolation = true` setzen.
- Bei Rückkehr vor Ablauf Status zurücksetzen.
- Nach 60 Sekunden Verstoß Spieler mit `movement_restriction` eliminieren.

### 9.2 Spielfeldverletzung

- Server vergleicht jede Position mit `gameField`.
- Außerhalb: `fieldViolationStartedAt` und `fieldViolationActive = true`.
- Rückkehr vor Ablauf setzt Status zurück.
- Nach 60 Sekunden Spieler mit `field_violation` eliminieren.
- Agenteneliminierung beendet das Spiel zugunsten der Jäger.
- Bei zu wenigen übrigen Spielern Ergebnis `too_few_players`.

Die App zeigt nur die vom Server geschriebenen Statuswerte und lokale
Countdown-Darstellung an. Sie entscheidet nicht mehr über Eliminierungen.

## 10. Agentenpuls

Bestehenden `POST /api/game/pulse` korrigieren:

- Nur aktiver Agent.
- Effektive Phase `playing`.
- Fälligkeit aus Serverzeit prüfen.
- Position aus dem serverseitigen Spielerzustand übernehmen.
- Position muss hinreichend frisch sein.
- Pulsindex streng monoton und höchstens erwarteter Pulsindex.
- Vorzeitige, doppelte oder ungültige Pulse mit eindeutigem `409` ablehnen.
- Keine unveränderte Transaktion als erfolgreichen HTTP-200-Aufruf melden.

Die Überwachung fehlender Pulse erfolgt ausschließlich in `reconcileLobby()`;
Clients rufen kein `finalizeGame()` mehr auf.

## 11. Intercept

Bestehenden `POST /api/game/intercept` korrigieren:

- Nur aktiver Agent in effektiver Spielphase `playing`.
- Feature muss aktiviert sein.
- Genau einmal atomar nutzbar.
- Zweiter oder fachlich ungültiger Aufruf liefert eindeutigen `409`.
- App startet die Agora-Listen-in-Session erst nach bestätigtem API-Erfolg.

## 12. Entfernen des generischen Client-Spielendes

`GameService.finalizeGame()` wird aus der Angular-App entfernt.

Kein Client darf mehr direkt folgende Werte setzen:

- `gameState`
- `result`
- `caughtByUid`
- `finalizedAt`
- Eliminierungsstatus anderer Spieler

Alle Ergebnisgründe entstehen ausschließlich durch konkrete API-Aktionen oder
`reconcileLobby()`:

- `caught`
- `time_up`
- `agent_left`
- `agent_disconnected`
- `too_few_players`
- `agent_offline_pulse`
- `field_violation`
- `movement_restriction`
- `disconnect_timeout`

## 13. Angular-/Capacitor-Migration

### 13.1 `GameApiService`

Ergänzen um Methoden für alle neuen Endpunkte. Gemeinsame Anforderungen:

- Firebase-ID-Token automatisch mitsenden.
- Timeout und stabile Fehlercodes.
- Keine Tokens oder Positionsdaten loggen.
- Nur echte, explizit konfigurierte HTTPS-Produktions-URL verwenden.
- Lokales HTTP ausschließlich für localhost-Entwicklung zulassen.

### 13.2 `LobbyService`

Folgende direkten Firebase-Mutationen ersetzen:

- `createLobby()` → `/api/lobby/create`
- `joinLobby()` → `/api/lobby/join`
- `claimAgentRole()` → `/api/lobby/claim-agent`
- `releaseAgentRole()` → `/api/lobby/release-agent`
- `leaveLobby()` bleibt API-basiert
- `ensureLobbyPresence()` verwendet Heartbeat statt direktem `set()`
- sämtliche `onDisconnect()`-Registrierungen entfernen

Reads und `watchLobby()` dürfen direkt bleiben.

### 13.3 `GameService`

- Positionsupdate ausschließlich über `/api/game/position`.
- Heartbeat-Lifecycle starten und in `cleanup()` beenden.
- Keine direkten `set`, `update`, `runTransaction`, `remove` oder
  `onDisconnect`-Aufrufe mehr.
- Lokale Verstoßberechnung darf für unmittelbares UI-Feedback bleiben, ist aber
  nicht autoritativ.
- Eliminierungs- und Spielende-Timer entfernen; Serverzustand über Listener
  anzeigen.
- `finalizeGame()` vollständig entfernen.
- Fangtoken nur als Agent über `/api/game/catch-token` laden.
- Jäger dürfen keinen Fangtoken im Lobby-Snapshot erhalten.

### 13.4 Verhalten bei API-Ausfall

- Lobby-/Rollenaktionen zeigen verständliche Fehler und bleiben wiederholbar.
- Positionsübertragung hält höchstens den neuesten ausstehenden Wert.
- Heartbeat nutzt begrenzten Backoff.
- Keine optimistischen autoritativen Zustandsänderungen.
- UI darf lokale Position weiter anzeigen, aber klar erkennen, wenn die
  Serververbindung länger ausfällt.

## 14. Finale Firebase Database Rules

Nach vollständiger App-Migration:

```json
{
  "rules": {
    "lobbies": {
      "$lobbyCode": {
        ".read": "auth != null && data.child('players').child(auth.uid).exists()",
        ".write": false
      }
    }
  }
}
```

Falls weitere serverinterne Pfade existieren:

```json
{
  "lobbySecrets": {
    ".read": false,
    ".write": false
  }
}
```

Admin SDK umgeht diese Rules. Es darf keine temporäre Client-Ausnahme verbleiben.

Die API-Endpunkte `check` und `join` ersetzen den bisherigen Read-/Write-Bedarf
eines Nichtmitglieds. Erst nach erfolgreichem Join erlaubt die Rule den direkten
Lobby-Read.

## 15. Tests der Game API

Mindestens automatisieren:

### Lobby

- Erstellung setzt Host und vollständige Defaults.
- Doppelter Code wird atomar abgelehnt.
- Join erzwingt Kapazität, eindeutigen Namen und Farbe.
- parallele Joins überschreiten sechs Spieler nicht.
- Claim-Agent hat bei Parallelität genau einen Gewinner.
- Host-Start nur durch Host.
- Host-Transfer beim Verlassen deterministisch.

### API-Fehlervertrag

- fachlicher No-op liefert nicht versehentlich HTTP 200.
- falscher Token, falsche Rolle und falsche Phase liefern stabile Codes.
- vorhandenes Spielresultat wird nie überschrieben.

### Fangtoken

- nur Agent erhält Token.
- Jäger erhält `403`.
- Token ist an Lobby, Startzeit und Agent gebunden.
- falscher oder alter Token beendet das Spiel nicht.
- Token und Secret erscheinen nicht in Logs.

### Position/Presence

- nur eigene Position wird aktualisiert.
- Serverzeit wird verwendet.
- ungültige Koordinaten/Genauigkeit werden abgelehnt.
- veraltete Sequenz überschreibt keine neuere Position.
- zu schnelle/unplausible Updates werden abgelehnt.
- Heartbeat aktualisiert Presence.
- Disconnect- und Eliminierungsgrenzen werden korrekt ausgewertet.

### Regeln und Spielende

- Countdown-Verstoß startet, endet und eliminiert korrekt.
- Spielfeldverstoß startet, endet und eliminiert korrekt.
- Zeitablauf, fehlender Puls und Disconnect ergeben das richtige Ergebnis.
- parallele Ergebnisursachen: erstes Ergebnis bleibt bestehen.

## 16. Tests der Angular-App

- Jeder frühere direkte Schreibpfad ruft jetzt `GameApiService` auf.
- Positionsrequests werden zusammengefasst statt aufgestaut.
- Heartbeat startet und stoppt mit Lobby-/Spiel-Lifecycle.
- Fangtoken wird nur in Agentenansicht geladen.
- API-Fehler führen nicht zu optimistischen Rollen-/Ergebnisänderungen.
- Realtime Listener aktualisieren UI nach API-Mutationen.
- App-Reconnect registriert kein Firebase `onDisconnect` mehr.

Statischer Kontrolltest bzw. CI-Check:

```text
Im Angular-Projekt dürfen außerhalb klarer Firebase-Read-Adapter keine Imports
oder Aufrufe von set, update, remove, runTransaction oder onDisconnect aus
firebase/database mehr existieren.
```

## 17. Tests der finalen Database Rules

Mit Rules Emulator prüfen:

- nicht authentifizierter Client kann nicht lesen oder schreiben.
- authentifizierter Nichtmitglied-Client kann Lobby nicht lesen.
- Mitglied kann eigene Lobby lesen.
- Mitglied kann keinen einzigen Pfad schreiben, auch nicht eigene Position,
  Presence, Rolle oder Ergebnis.
- Lobby-Erstellung und Join per Client schlagen fehl.
- Admin-/Test-Setup kann weiterhin API-Schreibvorgänge simulieren.

## 18. Performance und Vercel-Nutzung

Positionsupdates über HTTP erhöhen Aufrufszahl und Latenz deutlich. Vor Umsetzung
die erwartete Last dokumentieren.

Bei aktuell bis zu sechs Spielern und 30 Minuten Spielzeit:

- Clientseitiges Positionsintervall nicht unter 1,5 Sekunden.
- Bevorzugt dynamisch 2 bis 5 Sekunden, abhängig von Bewegung und Spielphase.
- Mindestbewegung und Genauigkeitsfilter beibehalten.
- Heartbeat 10 bis 15 Sekunden bei Stillstand.
- Nur neueste ausstehende Position übertragen.
- Vercel-Nutzungs- und Funktionslimits beobachten.

Wenn die Positionslast die Vercel-Grenzen überschreitet, ist vor einer öffentlichen
Veröffentlichung ein für dauerhafte Echtzeitkommunikation geeigneter Backenddienst
zu evaluieren. Für die geschlossene Alpha ist Vercel akzeptiert.

## 19. Migrationsreihenfolge

Die Reihenfolge ist zwingend, damit keine App-Version ausgesperrt wird:

1. API-Transaktions- und HTTP-Statusfehler korrigieren.
2. Neue Datenmodelle und Endpunkte implementieren.
3. API vollständig lokal testen.
4. API deployen, Rules noch nicht final schließen.
5. Angular-App vollständig auf API-Mutationen migrieren.
6. Mehrgeräte-Test mit API und bisherigen Übergangs-Rules.
7. Prüfen, dass kein direkter Firebase-Schreibaufruf verbleibt.
8. Finale `.write: false` Rules deployen.
9. Erneuter Mehrgeräte-, Reconnect- und Race-Condition-Test.
10. Erst danach Übergangslogik und alte Felder entfernen.

Alte App-Versionen funktionieren nach Schritt 8 nicht mehr. Vor dem Rule-
Deployment sicherstellen, dass alle Testgeräte aktualisiert wurden.

## 20. Abnahmekriterien

- [ ] Alle neuen und korrigierten API-Endpunkte implementiert.
- [ ] Kein fachlich abgelehnter API-Aufruf meldet fälschlich Erfolg.
- [ ] `hostUid` und deterministischer Host-Transfer implementiert.
- [ ] Fangtoken nicht mehr im öffentlichen Lobbyobjekt.
- [ ] Nur Agent kann Fangtoken abrufen.
- [ ] Position, Presence und Verstöße werden serverseitig geschrieben.
- [ ] Alle Ergebnisgründe entstehen ausschließlich serverseitig.
- [ ] Angular enthält keine direkten Firebase-Mutationen mehr.
- [ ] Angular verwendet kein Firebase `onDisconnect` mehr.
- [ ] Database Rules enthalten für App-Clients ausschließlich `.write: false`.
- [ ] Nichtmitglieder können Lobbydaten nicht direkt lesen.
- [ ] API-Tests erfolgreich.
- [ ] Angular-Unit-Tests erfolgreich.
- [ ] Firebase-Regeltests erfolgreich.
- [ ] Angular-Produktionsbuild erfolgreich.
- [ ] Android-Lint- und Release-Build erfolgreich.
- [ ] `npm audit --omit=dev` für beide Projekte dokumentiert.
- [ ] Keine echten Secrets oder Tokens im Repository/Buildartefakt.
- [ ] Kein Deployment ohne ausdrückliche Freigabe.

## 21. Übergabebericht

Der umsetzende Codex berichtet abschließend:

1. Änderungen in API und App,
2. entfernte direkte Firebase-Schreibpfade,
3. neue Datenmodellfelder und Migration,
4. ausgeführte Tests und Builds,
5. verbleibende Betriebs-/Vercel-Risiken,
6. notwendige manuelle Secret- und Deployment-Schritte,
7. exakte Reihenfolge für API-, App- und Rules-Rollout.
