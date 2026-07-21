import { getAuth } from 'firebase-admin/auth';
import { HttpError } from './errors.js';

export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
}

export async function authenticateRequest(req: AuthenticatedRequest, cronSecret?: string): Promise<string> {
  const authHeader = req.headers.authorization;
  const rawHeader = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  const token = typeof rawHeader === 'string' ? rawHeader.replace(/^Bearer\s+/i, '').trim() : '';

  if (!token) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Authorization token missing');
  }

  if (cronSecret && token === cronSecret) {
    return 'cron';
  }

  try {
    const decoded = await getAuth().verifyIdToken(token);
    if (!decoded.uid) {
      throw new HttpError(401, 'UNAUTHORIZED', 'Invalid Firebase token');
    }
    return decoded.uid;
  } catch {
    throw new HttpError(401, 'UNAUTHORIZED', 'Invalid Firebase token');
  }
}
