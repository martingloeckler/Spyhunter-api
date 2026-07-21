import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getDatabase as getDatabaseService } from 'firebase-admin/database';
import { loadConfig } from './config.js';

let initialized = false;
let app: App | null = null;

export function getFirebaseAdmin(): App {
  if (!initialized || app == null) {
    const config = loadConfig();
    const existingApps = getApps();
    if (!existingApps.length) {
      app = initializeApp({
        credential: cert({
          projectId: config.firebaseProjectId,
          clientEmail: config.firebaseClientEmail,
          privateKey: config.firebasePrivateKey
        }),
        databaseURL: config.firebaseDatabaseUrl
      });
    } else {
      app = existingApps[0];
    }
    initialized = true;
  }
  return app;
}

export function getDatabase() {
  return getDatabaseService(getFirebaseAdmin());
}
