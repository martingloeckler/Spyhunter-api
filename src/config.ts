import crypto from 'node:crypto';

export interface AppConfig {
  firebaseProjectId: string;
  firebaseClientEmail: string;
  firebasePrivateKey: string;
  firebaseDatabaseUrl: string;
  allowedOrigins: string[];
  cronSecret: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

export function loadConfig(): AppConfig {
  const privateKey = requireEnv('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n');
  const allowedOrigins = requireEnv('ALLOWED_ORIGINS').split(',').map((origin) => origin.trim()).filter(Boolean);

  if (!allowedOrigins.length) {
    throw new Error('ALLOWED_ORIGINS must contain at least one origin');
  }

  return {
    firebaseProjectId: requireEnv('FIREBASE_PROJECT_ID'),
    firebaseClientEmail: requireEnv('FIREBASE_CLIENT_EMAIL'),
    firebasePrivateKey: privateKey,
    firebaseDatabaseUrl: requireEnv('FIREBASE_DATABASE_URL'),
    allowedOrigins,
    cronSecret: requireEnv('CRON_SECRET')
  };
}

export const PULSE_FRESHNESS_WINDOW_MS = 60_000;
export const MAX_BODY_SIZE = 16 * 1024;
export const MAX_PLAYERS = 6;
export const MIN_PLAYERS = 2;
export const MAX_PULSE_INDEX = 30;
export const MAX_LOBBY_CODE_LENGTH = 8;
export const MIN_LOBBY_CODE_LENGTH = 6;
export const GENERIC_ERROR_MESSAGE = 'An unexpected error occurred';

export function createRequestId(): string {
  return crypto.randomUUID();
}
