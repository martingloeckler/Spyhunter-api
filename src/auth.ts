import { getAuth } from 'firebase-admin/auth';
import crypto from 'node:crypto';
import { HttpError } from './errors.js';
import { getFirebaseAdmin } from './firebase-admin.js';

export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
}

function bearerToken(req: AuthenticatedRequest): string {
  const authHeader = req.headers.authorization;
  const rawHeader = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  return typeof rawHeader === 'string' ? rawHeader.replace(/^Bearer\s+/i, '').trim() : '';
}

export async function authenticateRequest(req: AuthenticatedRequest): Promise<string> {
  const token = bearerToken(req);

  if (!token) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Authorization token missing');
  }

  const auth = getAuth(getFirebaseAdmin());
  try {
    const decoded = await auth.verifyIdToken(token);
    if (!decoded.uid) {
      throw new HttpError(401, 'UNAUTHORIZED', 'Invalid Firebase token');
    }
    return decoded.uid;
  } catch {
    throw new HttpError(401, 'UNAUTHORIZED', 'Invalid Firebase token');
  }
}

export function authenticateCronRequest(req: AuthenticatedRequest, cronSecret: string): void {
  const token = bearerToken(req);
  const tokenBuffer = Buffer.from(token, 'utf8');
  const secretBuffer = Buffer.from(cronSecret, 'utf8');
  if (!token || tokenBuffer.length !== secretBuffer.length || !crypto.timingSafeEqual(tokenBuffer, secretBuffer)) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Invalid maintenance token');
  }
}
