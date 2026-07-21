# Anforderung: SpyHunt Game API auf Vercel

## 1. Auftrag

Erstelle ein neues, eigenständiges Vercel-Projekt mit dem Namen `spyhunt-game-api`.
Es stellt autoritative HTTP-Endpunkte für kritische SpyHunt-Spielaktionen bereit und
greift serverseitig auf die bestehende Firebase Realtime Database zu.

Das Projekt ist ausdrücklich vom vorhandenen Vercel-Projekt
`spyhunt-token-server` zu trennen. Der bestehende Agora-Tokenserver und dessen
Deployment dürfen nicht verändert werden.

Die erste Version wird für eine geschlossene Alpha mit bekannten Teilnehmern
erstellt. Sie soll dennoch so aufgebaut sein, dass direkte Client-Schreibrechte
später schrittweise geschlossen werden können.

## 2. Ziele

- Firebase-ID-Tokens aus der App verifizieren.
- Lobby-Mitgliedschaft und Spielerrolle serverseitig prüfen.
- Kritische Änderungen atomar und idempotent ausführen.
- Gleichzeitige Aktionen korrekt behandeln (`first write wins`).
- Keine Firebase Cloud Functions und keinen Firebase-Blaze-Tarif benötigen.
- Eine tägliche Bereinigung veralteter Lobbys über Vercel Cron ermöglichen.
- Eine klar dokumentierte API für die spätere Angular-Integration bereitstellen.
- Secrets, Logs und Fehlerantworten sicher behandeln.

## 3. Nicht-Ziele der ersten Version

- Kein Deployment durch Codex ohne ausdrückliche Freigabe.
- Keine Änderung am bestehenden Agora-Tokenserver.
- Keine Änderung am Angular-/Capacitor-Projekt in diesem Auftrag.
- Keine sofortige Verschärfung der bestehenden Firebase Database Rules.
- Kein vollständiger Ersatz aller direkten Positionsschreibvorgänge der App.
- Kein eigener Benutzerbestand; Firebase Anonymous Authentication bleibt bestehen.
- Keine Abrechnung oder Einrichtung eines Google-Cloud-Billing-Kontos.

## 4. Technischer Rahmen

- Plattform: Vercel Functions
- Sprache: TypeScript im Strict Mode
- Runtime: Node.js 22
- Firebase SDK: `firebase-admin` 14.x
- Datenbank: bestehende Firebase Realtime Database
- Authentifizierung: Firebase ID Token als Bearer Token
- Tests: ein für TypeScript geeignetes Testframework; bevorzugt Vitest
- Paketmanager: npm mit eingechecktem Lockfile

Das Projekt muss unabhängig von der Angular-App gebaut und getestet werden können.

## 5. Empfohlene Projektstruktur

```text
spyhunt-game-api/
├── api/
│   ├── health.ts
│   ├── game/
│   │   ├── start.ts
│   │   ├── catch.ts
│   │   ├── pulse.ts
│   │   ├── intercept.ts
│   │   └── leave.ts
│   └── maintenance/
│       └── cleanup-lobbies.ts
├── src/
│   ├── config.ts
│   ├── firebase-admin.ts
│   ├── auth.ts
│   ├── authorization.ts
│   ├── validation.ts
│   ├── errors.ts
│   ├── responses.ts
│   ├── models.ts
│   └── game-repository.ts
├── test/
├── .env.example
├── .gitignore
├── package.json
├── package-lock.json
├── tsconfig.json
├── vercel.json
└── README.md
```

Die genaue Vercel-Verzeichnisform darf an die zum Implementierungszeitpunkt
aktuelle Vercel-Konvention angepasst werden. Fachlogik darf nicht unnötig direkt
in den HTTP-Handlern liegen.

## 6. Umgebungsvariablen und Secrets

Mindestens folgende Variablen vorsehen:

```dotenv
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
FIREBASE_DATABASE_URL=
ALLOWED_ORIGINS=
CRON_SECRET=
```

Anforderungen:

- `.env.example` enthält nur Platzhalter.
- Lokale `.env*`-Dateien mit echten Werten werden ignoriert.
- Service-Account-Schlüssel niemals einchecken oder an den Client ausliefern.
- `FIREBASE_PRIVATE_KEY` muss escaped Zeilenumbrüche korrekt verarbeiten.
- Konfiguration beim Start validieren; fehlende Variablen führen zu einem klaren
  Start-/Konfigurationsfehler ohne Ausgabe ihrer Werte.
- Für das neue Projekt ein eigenes, möglichst eingeschränktes Servicekonto
  verwenden. Nicht die Geheimnisse des Agora-Tokenservers übernehmen.
- Keine Tokens, QR-Geheimnisse, GPS-Koordinaten oder privaten Schlüssel loggen.

## 7. Bestehendes Datenmodell

Lobby-Pfad:

```text
lobbies/{lobbyCode}
```

Lobby-Code:

- normalisiert in Kleinbuchstaben
- 6 bis 8 Zeichen
- ausschließlich `a-z` und `0-9`

Relevantes Lobby-Modell:

```ts
type GameState = 'lobby' | 'countdown' | 'playing' | 'ended';

interface Lobby {
  createdAt: number;
  lastActivityAt: number;
  gameState: GameState;
  gameStartedAt: number | null;
  gameField: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  settings: {
    gameDurationSec: number;       // 600..3600, Schritte à 300
    countdownDurationSec: number;  // 60..600, kleiner als Spieldauer
    pulseIntervalSec: number;      // 120..900, höchstens Spieldauer
    agentInterceptEnabled: boolean;
  };
  agentBleUuid: string | null;
  players: Record<string, Player>;
  agentInterceptUsed?: boolean;
  agentPulseMarker?: {
    lat: number;
    lng: number;
    pulseIndex: number;
    timestamp: number;
  };
  result?: {
    winner: 'hunters' | 'agent' | 'none';
    reason: string;
    caughtByUid?: string;
    finalizedAt: number;
  };
}
```

Spieler-Modell:

```ts
type PlayerRole = 'agent' | 'hunter' | null;

interface Player {
  uid: string;
  nickname: string;
  color: string;
  role: PlayerRole;
  lat: number | null;
  lng: number | null;
  positionUpdatedAt: number | null;
  disconnectedAt: number | null;
  eliminated: boolean;
  eliminatedReason:
    | 'field_violation'
    | 'movement_restriction'
    | 'disconnect_timeout'
    | 'voluntary'
    | null;
  countdownViolation: boolean | null;
  fieldViolationActive: boolean | null;
}
```

Spielkonstanten:

- mindestens 2 und höchstens 6 Spieler
- genau ein Agent beim Spielstart
- alle übrigen Spieler werden beim Start zu Jägern
- QR-Fangdistanz in der App: 5 Meter
- Verstoß-/Disconnect-Schonfrist: 60 Sekunden

### 7.1 Kompatibilität der gespeicherten Spielphase

Im aktuellen Client wird beim Spielstart `gameState = 'countdown'` gespeichert.
Nach Ablauf des Countdowns wechselt nur der lokale Angular-`GameService` in die
Phase `playing`; der gespeicherte Firebase-Wert wird derzeit nicht auf `playing`
aktualisiert.

Die API darf deshalb für laufende Aktionen nicht ausschließlich
`gameState === 'playing'` prüfen. Sie muss zentral eine effektive Phase aus den
serverseitigen Daten berechnen:

```ts
function effectivePhase(lobby: Lobby, now: number): GameState {
  if (lobby.gameState === 'ended') return 'ended';
  if (lobby.gameState === 'lobby' || lobby.gameStartedAt == null) return 'lobby';

  const elapsedSec = Math.floor((now - lobby.gameStartedAt) / 1000);
  if (elapsedSec < lobby.settings.countdownDurationSec) return 'countdown';
  if (elapsedSec < lobby.settings.gameDurationSec) return 'playing';
  return 'ended';
}
```

Ein bereits gespeichertes `gameState === 'playing'` muss ebenfalls unterstützt
werden. Die Berechnung ist als gemeinsame, getestete Fachfunktion zu kapseln.
Die API soll den gespeicherten Wert im MVP nicht nebenläufig nur wegen eines
Reads ändern. Eine spätere Migration kann einen expliziten serverseitigen
Phasenübergang ergänzen.

## 8. Gemeinsamer HTTP-Vertrag

### 8.1 Authentifizierung

Alle Spielendpunkte erwarten:

```http
Authorization: Bearer <Firebase-ID-Token>
Content-Type: application/json
```

Der Server muss das Token mit `verifyIdToken()` verifizieren. Die UID wird
ausschließlich aus dem verifizierten Token übernommen, niemals aus dem Body.

Der Cleanup-Endpunkt verwendet statt eines Benutzer-Tokens:

```http
Authorization: Bearer <CRON_SECRET>
```

### 8.2 Request-Grundregeln

- Nur dokumentierte HTTP-Methoden akzeptieren.
- JSON-Body begrenzen; Zielgröße maximal 16 KiB.
- Unbekannte Felder entweder verwerfen oder konsistent mit `400` ablehnen.
- Lobby-Code trimmen, kleinschreiben und gegen `/^[a-z0-9]{6,8}$/` prüfen.
- Keine Client-Zeitstempel für sicherheitsrelevante Entscheidungen verwenden.
- Serverseitige Zeitstempel verwenden.

### 8.3 Erfolgsantwort

```json
{
  "ok": true,
  "data": {}
}
```

### 8.4 Fehlerantwort

```json
{
  "ok": false,
  "error": {
    "code": "LOBBY_NOT_FOUND",
    "message": "Lobby not found"
  }
}
```

Keine Stacktraces, Firebase-Fehlerdetails oder Secrets an Clients ausgeben.

Vorgesehene Statuscodes:

- `200`: erfolgreich oder idempotent bereits im Zielzustand
- `400`: ungültige Eingabe
- `401`: Token fehlt, ist ungültig oder abgelaufen
- `403`: kein Mitglied oder falsche Rolle
- `404`: Lobby nicht vorhanden
- `409`: fachlicher Zustandskonflikt
- `429`: Plattform-/Rate-Limit
- `500`: unerwarteter interner Fehler

### 8.5 CORS

- Nur konfigurierte Origins erlauben.
- Erforderliche Capacitor-/Entwicklungs-Origins dokumentieren.
- CORS ist kein Ersatz für Tokenprüfung und Autorisierung.

## 9. Endpunkte des MVP

### 9.1 `GET /api/health`

Zweck: Deployment- und Monitoring-Prüfung.

Antwortet ohne Datenbankinhalte und ohne Konfigurationsdetails:

```json
{
  "ok": true,
  "data": {
    "service": "spyhunt-game-api"
  }
}
```

Keine Secrets, Versionslisten oder Umgebungsvariablen ausgeben.

### 9.2 `POST /api/game/start`

Body:

```json
{
  "lobbyCode": "abc123"
}
```

Prüfungen innerhalb einer atomaren Transaktion:

1. Lobby existiert.
2. Aufrufer ist in `players/{uid}` eingetragen.
3. `gameState === 'lobby'`.
4. Spielerzahl liegt zwischen 2 und 6.
5. Genau ein nicht eliminierter Spieler hat Rolle `agent`.
6. Einstellungen und Spielfeld sind plausibel.

Änderungen in derselben Transaktion:

- alle Nicht-Agenten erhalten Rolle `hunter`
- `gameState = 'countdown'`
- `gameStartedAt = serverseitige aktuelle Zeit`
- `agentBleUuid = crypto.randomUUID()`
- `lastActivityAt = serverseitige aktuelle Zeit`
- altes `result`, `agentPulseMarker` und `agentInterceptUsed` entfernen bzw.
  initialisieren, sofern das Datenmodell dies verlangt

Ein paralleler zweiter Start darf keinen neuen QR-Token erzeugen. Wenn das Spiel
bereits gestartet ist, mit `409 GAME_ALREADY_STARTED` antworten.

Hinweis zur Host-Rolle: Das aktuelle Datenmodell enthält kein `hostUid`; aktuell
kann daher jedes Lobby-Mitglied starten. Der Endpunkt soll diese bestehende
Semantik im MVP beibehalten. Eine spätere App-/Schema-Migration ergänzt
`hostUid`, danach muss dieser Endpunkt ausschließlich den Host akzeptieren.

### 9.3 `POST /api/game/catch`

Body:

```json
{
  "lobbyCode": "abc123",
  "scannedToken": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

Prüfungen innerhalb einer atomaren Transaktion:

1. Lobby existiert.
2. Aufrufer ist aktiver, nicht eliminierter Spieler der Lobby.
3. Aufrufer hat Rolle `hunter`.
4. Die zentral berechnete effektive Phase ist `playing`.
5. `scannedToken` ist ein syntaktisch gültiger UUID-Wert.
6. `scannedToken === agentBleUuid` mit exaktem Vergleich.
7. Es existiert noch kein endgültiges Ergebnis.

Erfolgreiche atomare Änderung:

```ts
gameState = 'ended';
result = {
  winner: 'hunters',
  reason: 'caught',
  caughtByUid: authenticatedUid,
  finalizedAt: serverNow
};
lastActivityAt = serverNow;
```

Bei gleichzeitigen Scans gewinnt nur die erste erfolgreiche Transaktion. Ein
späterer Scan darf das bestehende Ergebnis nicht überschreiben.

Der gescannte Token darf weder in Erfolgs- noch Fehlerlogs erscheinen.

### 9.4 `POST /api/game/pulse`

Body:

```json
{
  "lobbyCode": "abc123",
  "pulseIndex": 1
}
```

Prüfungen:

- Aufrufer ist aktiver Agent der Lobby.
- Die zentral berechnete effektive Phase ist `playing`.
- Pulsindex ist ganzzahlig, mindestens 1 und höchstens 30.
- Pulsindex ist größer als der zuletzt veröffentlichte Pulsindex.
- Der planmäßige Zeitpunkt des Pulses
  `gameStartedAt + pulseIndex * pulseIntervalSec` ist nach Serverzeit erreicht;
  vorzeitige Pulse werden abgelehnt, verspätete Pulse bleiben möglich, solange
  das Spiel effektiv läuft.
- Position und `positionUpdatedAt` des Agenten sind vorhanden und hinreichend
  aktuell. Das konkrete Frischefenster als benannte Konstante definieren und im
  README dokumentieren; Vorschlag für die Alpha: 60 Sekunden.

Der Client darf keine GPS-Koordinaten für diesen Endpunkt vorgeben. Der Server
übernimmt die aktuelle Position aus `players/{uid}` und schreibt atomar:

```ts
agentPulseMarker = {
  lat: player.lat,
  lng: player.lng,
  pulseIndex,
  timestamp: serverNow
};
lastActivityAt = serverNow;
```

### 9.5 `POST /api/game/intercept`

Body:

```json
{
  "lobbyCode": "abc123"
}
```

Prüfungen und atomare Änderung:

- Aufrufer ist der aktive Agent.
- Die zentral berechnete effektive Phase ist `playing`.
- `settings.agentInterceptEnabled === true`.
- `agentInterceptUsed !== true`.
- anschließend `agentInterceptUsed = true` und `lastActivityAt = serverNow`.

Der zweite Aufruf liefert `409 INTERCEPT_ALREADY_USED`.

Der eigentliche Agora-Listen-in-Vorgang bleibt im bestehenden Tokenserver bzw.
Client. Dieser Endpunkt autorisiert nur die einmalige Spielaktion.

### 9.6 `POST /api/game/leave`

Body:

```json
{
  "lobbyCode": "abc123"
}
```

Semantik:

- Aufrufer muss Lobby-Mitglied sein.
- In Phase `lobby` darf nur der eigene Spielereintrag entfernt werden.
- Ist danach kein Spieler mehr vorhanden, wird die gesamte Lobby gelöscht.
- Während `countdown` oder `playing` wird ein Jäger atomar mit
  `eliminated = true` und `eliminatedReason = 'voluntary'` markiert.
- Verlässt der Agent ein laufendes Spiel, wird das Spiel atomar mit
  `winner = 'none'` und `reason = 'agent_left'` beendet.
- Fallen weniger als zwei aktive Spieler verbleibend, wird das Spiel mit
  `winner = 'none'` und `reason = 'too_few_players'` beendet.
- Wiederholte Aufrufe müssen idempotent sein.

## 10. Kein generischer Endpunkt für beliebige Ergebnisse

In der ersten Version darf es keinen Endpunkt geben, über den ein Client frei
`winner`, `reason`, `caughtByUid` oder `finalizedAt` setzen kann.

Jeder Spielausgang benötigt eine eigene, prüfbare Aktion. Weitere Gründe aus der
aktuellen App werden in späteren Schritten einzeln migriert:

- `time_up`
- `agent_offline_pulse`
- `agent_disconnected`
- `field_violation`
- `movement_restriction`
- `disconnect_timeout`
- `too_few_players`

Bis zur jeweiligen Migration bleiben diese Abläufe in der geschlossenen Alpha
clientseitig. Der API-Entwurf soll ihre spätere Ergänzung nicht blockieren.

## 11. Lobby-Bereinigung

### `GET /api/spyhuntgame`

- Ausschließlich mit gültigem `CRON_SECRET` aufrufbar.
- Nur `GET` akzeptieren, passend zu Vercel Cron.
- Lobbys suchen, deren `createdAt` älter als zwei Stunden ist.
- Vor dem Löschen nochmals aktuellen Snapshot prüfen.
- Löschungen begrenzen und bei Bedarf in Batches ausführen.
- Antwort enthält nur Anzahl geprüfter und gelöschter Lobbys, keine Lobbydaten.
- Strukturierte Logs enthalten Lobby-Codes höchstens gehasht oder gekürzt.
- Fehler einer Lobby dürfen die Bereinigung anderer Lobbys nicht verhindern.

Vercel-Hobby-Cron läuft höchstens einmal täglich und kann innerhalb der geplanten
Stunde verzögert sein. Deshalb können Lobbys trotz Zwei-Stunden-Grenze ungefähr
einen weiteren Tag bestehen bleiben. Das ist für die Alpha akzeptiert und im
README zu dokumentieren.

Beispiel für `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/maintenance/cleanup-lobbies",
      "schedule": "0 3 * * *"
    }
  ]
}
```

Vercel Cron verwendet UTC.

## 12. Firebase-Zugriff

- Firebase Admin nur einmal pro Serverprozess initialisieren.
- Wiederverwendung bei warmen Vercel-Instanzen unterstützen.
- Alle mutierenden Spielaktionen mit Realtime-Database-Transaktionen umsetzen.
- Keine sicherheitsrelevanten Read-then-Write-Sequenzen außerhalb einer
  Transaktion verwenden.
- Admin SDK umgeht Database Rules: Jede API-Aktion muss deshalb selbst alle
  fachlichen Berechtigungen und Werte prüfen.
- Repository-Schicht so kapseln, dass HTTP-Handler keine beliebigen Pfade
  schreiben können.

## 13. Logging und Betrieb

Strukturiert loggen:

- Request-ID
- Endpunkt/Aktion
- HTTP-Status bzw. stabiler Fehlercode
- Laufzeit
- anonymisierte UID, falls für Diagnose erforderlich

Nicht loggen:

- Authorization-Header oder Firebase-ID-Token
- `agentBleUuid` oder gescannte QR-Tokens
- Service-Account-Daten
- vollständige GPS-Koordinaten
- vollständige Request-Bodies

Ein In-Memory-Rate-Limit gilt in serverlosen Instanzen nicht als verlässliche
Sicherheitsmaßnahme. Falls ein Rate-Limit umgesetzt wird, muss die technische
Grenze dokumentiert oder ein persistenter/Plattform-basierter Mechanismus
verwendet werden.

## 14. Tests

Tests dürfen keine produktive Firebase-Instanz und keine echten Secrets benötigen.
Firebase-, Auth- und Repository-Abhängigkeiten müssen mockbar bzw. über Emulatoren
testbar sein.

Mindestens folgende Fälle automatisieren:

### Authentifizierung

- fehlender Bearer Token → `401`
- ungültiger oder abgelaufener Token → `401`
- gültiger Token, aber kein Lobby-Mitglied → `403`

### Spielstart

- gültiger Start setzt Rollen, Countdown, Startzeit und UUID
- weniger als zwei Spieler → `409`
- kein oder mehrere Agenten → `409`
- bereits gestartete Lobby → `409`
- parallele Starts erzeugen nur einen Spielstart/Token
- effektive Phase wird vor, während und nach dem Countdown korrekt berechnet

### Fang

- nur aktive Jäger dürfen fangen
- falscher QR-Token beendet das Spiel nicht
- korrekter Token beendet das Spiel
- `caughtByUid` stammt aus Auth, nicht aus Request-Daten
- parallele Scans überschreiben das erste Ergebnis nicht
- bereits beendetes Spiel bleibt unverändert
- Fang während des Countdowns oder nach Ablauf der Spieldauer wird abgelehnt

### Puls und Intercept

- nur Agent erlaubt
- veraltete oder fehlende Position verhindert Puls
- doppelter/veralteter Pulsindex wird abgelehnt
- Intercept kann nur einmal aktiviert werden

### Verlassen

- Spieler entfernt nur sich selbst
- Agent-Austritt beendet das Spiel korrekt
- zu wenige aktive Spieler beenden das Spiel korrekt
- wiederholter Aufruf bleibt idempotent

### Cleanup

- falsches Cron-Secret → `401`
- junge Lobby bleibt erhalten
- alte Lobby wird gelöscht
- fehlerhafte Lobby blockiert andere Löschungen nicht

## 15. README-Anforderungen

Das README muss enthalten:

- Zweck und Abgrenzung zum Agora-Tokenserver
- lokale Installation und Start
- benötigte Node-Version
- Umgebungsvariablen ohne echte Werte
- lokale Tests und Build
- API-Endpunkte mit Request-/Response-Beispielen
- Fehlercodes
- Einrichtung eines separaten Firebase-Servicekontos
- Einrichtung der Vercel-Umgebungsvariablen
- Einrichtung und Grenzen des täglichen Cron Jobs
- Deployment-Schritte als Dokumentation, aber kein automatisches Deployment
- Sicherheitsannahmen und bekannte Alpha-Einschränkungen

## 16. Migrationsreihenfolge zur Angular-App

Diese Reihenfolge dokumentieren, aber nicht im API-Auftrag ausführen:

1. API vollständig lokal bauen und testen.
2. Neues Vercel-Projekt mit eigenen Secrets deployen.
3. Angular-Konfiguration um `gameApiUrl` ergänzen.
4. Angular `GameApiService` mit Firebase Bearer Token ergänzen.
5. Aktionen einzeln migrieren: Start → Fang → Puls → Intercept → Leave.
6. Nach jeder Aktion Mehrgeräte- und Race-Condition-Tests durchführen.
7. Erst danach den jeweiligen direkten Client-Schreibpfad aus den Firebase Rules
   entfernen.
8. Später `hostUid` im Lobby-Modell ergänzen und den Spielstart auf den Host
   beschränken.

Während der Migration bleiben Reads und Echtzeit-Listener direkt über Firebase.
Nur privilegierte Mutationen laufen über die API.

## 17. Abnahmekriterien

- [ ] Eigenständiges Projekt `spyhunt-game-api` erstellt.
- [ ] Bestehender Agora-Tokenserver nicht verändert.
- [ ] Node 22, TypeScript Strict Mode und Firebase Admin 14 verwendet.
- [ ] Keine echten Secrets im Repository.
- [ ] Konfiguration wird beim Start validiert.
- [ ] Gemeinsame Auth-, Fehler- und Response-Schicht implementiert.
- [ ] Alle MVP-Endpunkte implementiert und dokumentiert.
- [ ] Alle kritischen Mutationen atomar und idempotent.
- [ ] UID ausschließlich aus verifiziertem Firebase-ID-Token übernommen.
- [ ] Kein generischer frei parametrierbarer Spielende-Endpunkt vorhanden.
- [ ] Cleanup-Endpunkt durch `CRON_SECRET` geschützt.
- [ ] Tests für Auth, Rollen, Zustände und Race Conditions vorhanden.
- [ ] `npm test` erfolgreich.
- [ ] `npm run build` erfolgreich.
- [ ] `npm audit --omit=dev` geprüft und Ergebnis dokumentiert.
- [ ] README und `.env.example` vollständig.
- [ ] Kein Deployment ohne ausdrückliche Freigabe durchgeführt.

## 18. Übergabebericht des umsetzenden Codex

Der Abschlussbericht soll knapp angeben:

1. implementierte Endpunkte,
2. verwendete Sicherheitsmaßnahmen,
3. ausgeführte Tests und deren Ergebnis,
4. noch offene Entscheidungen oder Risiken,
5. benötigte manuelle Schritte in Firebase/Vercel,
6. konkrete Integrationsschritte für die Angular-App.
