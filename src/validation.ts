import {
  MAX_POSITION_ACCURACY_METERS,
  MIN_FIELD_SIZE_METERS,
  NICKNAME_MAX_LENGTH,
  PLAYER_COLORS
} from './config.js';
import { HttpError } from './errors.js';
import type { GameField, GameSettings } from './types.js';

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_COLORS = new Set<string>(PLAYER_COLORS);

export function normalizeLobbyCode(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9]{6,8}$/.test(normalized) ? normalized : null;
}

export function normalizeNickname(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > NICKNAME_MAX_LENGTH || CONTROL_CHARACTER_PATTERN.test(normalized)) {
    return null;
  }
  return normalized;
}

export function normalizePlayerColor(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  return ALLOWED_COLORS.has(normalized) ? normalized : null;
}

export function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function isValidGameField(value: unknown): value is GameField {
  if (!isPlainObject(value)) return false;
  const { north, south, east, west } = value;
  if (![north, south, east, west].every(Number.isFinite)) return false;
  if (!(Number(north) <= 90 && Number(north) > Number(south) && Number(south) >= -90
    && Number(east) <= 180 && Number(east) > Number(west) && Number(west) >= -180)) return false;
  const midLatitude = (Number(north) + Number(south)) / 2;
  return distanceMeters(Number(north), Number(west), Number(south), Number(west)) >= MIN_FIELD_SIZE_METERS
    && distanceMeters(midLatitude, Number(west), midLatitude, Number(east)) >= MIN_FIELD_SIZE_METERS;
}

export function isValidGameSettings(value: unknown): value is GameSettings {
  if (!isPlainObject(value)) return false;
  const gameDurationSec = Number(value.gameDurationSec);
  const countdownDurationSec = Number(value.countdownDurationSec);
  const pulseIntervalSec = Number(value.pulseIntervalSec);
  return Number.isInteger(gameDurationSec) && gameDurationSec >= 600 && gameDurationSec <= 3_600 && gameDurationSec % 300 === 0
    && Number.isInteger(countdownDurationSec) && countdownDurationSec >= 60 && countdownDurationSec <= 600 && countdownDurationSec % 60 === 0
    && countdownDurationSec < gameDurationSec
    && Number.isInteger(pulseIntervalSec) && pulseIntervalSec >= 120 && pulseIntervalSec <= 900 && pulseIntervalSec % 60 === 0
    && pulseIntervalSec <= gameDurationSec
    && typeof value.agentInterceptEnabled === 'boolean';
}

export function isValidPosition(lat: unknown, lng: unknown, accuracy: unknown): boolean {
  return typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90
    && typeof lng === 'number' && Number.isFinite(lng) && lng >= -180 && lng <= 180
    && typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= MAX_POSITION_ACCURACY_METERS;
}

export function assertOnlyFields(value: unknown, allowedFields: readonly string[], label = 'body'): asserts value is Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new HttpError(400, 'INVALID_INPUT', `${label} must be an object`);
  }
  const unknownField = Object.keys(value).find((field) => !allowedFields.includes(field));
  if (unknownField) {
    throw new HttpError(400, 'UNKNOWN_FIELD', `Unknown ${label} field: ${unknownField}`);
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const radians = Math.PI / 180;
  const deltaLat = (lat2 - lat1) * radians;
  const deltaLng = (lng2 - lng1) * radians;
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(deltaLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
