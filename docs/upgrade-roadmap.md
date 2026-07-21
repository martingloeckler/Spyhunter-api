# Upgrade-Roadmap

## Ziel

Die Abhängigkeitslage der API schrittweise verbessern, ohne die aktuelle Funktionalität zu gefährden.

## Empfohlene Reihenfolge

1. Firebase Admin und Google Storage-Stack prüfen
   - Haupttreiber der Audit-Beschwerden.
   - Vor einem Upgrade sollten die bestehenden Auth-/Database-Integrationstests erneut laufen.

2. Separaten Upgrade-Branch anlegen
   - Änderungen an Abhängigkeiten getrennt von der eigentlichen Feature-Entwicklung pflegen.
   - So lassen sich Regressionen sauber isolieren.

3. Kleine, kontrollierte Upgrades testen
   - Zuerst patch-level oder minor-version-Updates.
   - Wenn das nicht reicht, gezielte major-version-Tests für firebase-admin.

4. Nach jedem Upgrade erneut prüfen
   - `npm run build`
   - `npm test`
   - `npm audit --omit=dev`

## Konkrete Kandidaten

- firebase-admin
- @google-cloud/storage
- retry-request
- teeny-request
- gaxios
- uuid

## Risiko

Ein Upgrade von firebase-admin kann das Admin-SDK-Verhalten ändern und erfordert zusätzliche Regressionstests, vor allem für:

- Firebase Auth
- Realtime Database
- Initialisierung der Admin-App

## Empfehlung für diesen Stand

Für den aktuellen Implementierungsstand ist ein großes, direktes Upgrade nicht sinnvoll. Stattdessen sollte die Abhängigkeitslage in einem separaten PR schrittweise und mit Regressionstests behandelt werden.

## Umsetzungsstand vom 21.07.2026

- Der Upgrade-Stand liegt auf dem separaten Branch `chore/dependency-upgrades`.
- `firebase-admin` ist als produktive Laufzeitabhängigkeit deklariert.
- Die nicht direkt verwendeten Abhängigkeiten `gaxios` und `uuid` wurden aus den direkten Abhängigkeiten entfernt.
- `firebase-admin` bleibt auf 14.2.0 und `@google-cloud/storage` auf 7.21.0, da für diesen Stand kein reguläres Update verfügbar ist.
- Für die von `gaxios` 6.7.1 und `teeny-request` 9.0.0 angeforderte, verwundbare `uuid`-Version wird vorübergehend die CommonJS-kompatible Version 11.1.1 erzwungen. Der Override kann entfallen, sobald der Storage-Stack selbst eine behobene Version anfordert.
- Vitest wurde von 2.1.4 auf 4.1.10 aktualisiert; die Testsuche ist auf die TypeScript-Tests im Verzeichnis `test` begrenzt.
- Regressionstests decken die Authentifizierung, den Cron-Secret-Pfad, die Initialisierung der Firebase-Admin-App und die Wiederverwendung einer bestehenden Admin-App ab.

Aktueller Prüfstand:

- `npm ci`: erfolgreich
- `npm run build`: erfolgreich
- `npm test`: 5 Testdateien und 18 Tests erfolgreich
- `npm audit --omit=dev`: 0 Schwachstellen
- `npm audit`: 0 Schwachstellen

Noch offen ist ein echter Emulator-Integrationstest gegen Firebase Auth und Realtime Database. Die vorhandenen Regressionstests isolieren das SDK über Mocks und benötigen deshalb keine Firebase-Zugangsdaten.
