import crypto from 'node:crypto';

export interface AppConfig {
  firebaseProjectId: string;
  firebaseClientEmail: string;
  firebasePrivateKey: string;
  firebaseDatabaseUrl: string;
  allowedOrigins: string[];
  cronSecret: string;
  catchTokenSecret: string;
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

  const catchTokenSecret = requireEnv('CATCH_TOKEN_SECRET');
  if (Buffer.byteLength(catchTokenSecret, 'utf8') < 32) {
    throw new Error('CATCH_TOKEN_SECRET must contain at least 32 bytes');
  }

  return {
    firebaseProjectId: requireEnv('FIREBASE_PROJECT_ID'),
    firebaseClientEmail: requireEnv('FIREBASE_CLIENT_EMAIL'),
    firebasePrivateKey: privateKey,
    firebaseDatabaseUrl: requireEnv('FIREBASE_DATABASE_URL'),
    allowedOrigins,
    cronSecret: requireEnv('CRON_SECRET'),
    catchTokenSecret
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
export const NICKNAME_MAX_LENGTH = 8;
export const MAX_POSITION_ACCURACY_METERS = 30;
export const COUNTDOWN_POSITION_ACCURACY_METERS = 15;
export const POSITION_MIN_INTERVAL_MS = 1_500;
export const MAX_POSITION_SPEED_MPS = 25;
export const HUNTER_START_RADIUS_METERS = 5;
export const MIN_FIELD_SIZE_METERS = 10;
export const VIOLATION_TIMEOUT_MS = 60_000;
export const DISCONNECT_THRESHOLD_MS = 30_000;
export const DISCONNECT_ELIMINATION_MS = 60_000;
export const PULSE_GRACE_MS = 90_000;
export const PLAYER_COLORS = ['#E53935', '#1E88E5', '#43A047', '#FB8C00', '#8E24AA', '#00ACC1'] as const;

export function createRequestId(): string {
  return crypto.randomUUID();
}
