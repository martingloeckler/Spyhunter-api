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
