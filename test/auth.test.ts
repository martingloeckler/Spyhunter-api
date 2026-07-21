import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '../src/errors.js';

const { mockGetAuth, mockVerifyIdToken } = vi.hoisted(() => ({
  mockGetAuth: vi.fn(),
  mockVerifyIdToken: vi.fn()
}));

vi.mock('firebase-admin/auth', () => ({
  getAuth: mockGetAuth
}));

import { authenticateRequest } from '../src/auth.js';

describe('authenticateRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuth.mockReturnValue({ verifyIdToken: mockVerifyIdToken });
  });

  it('rejects requests without a bearer token', async () => {
    await expect(authenticateRequest({ headers: {} })).rejects.toEqual(
      new HttpError(401, 'UNAUTHORIZED', 'Authorization token missing')
    );
    expect(mockGetAuth).not.toHaveBeenCalled();
  });

  it('accepts the maintenance secret without calling Firebase Auth', async () => {
    await expect(
      authenticateRequest({ headers: { authorization: 'Bearer cron-secret' } }, 'cron-secret')
    ).resolves.toBe('cron');
    expect(mockGetAuth).not.toHaveBeenCalled();
  });

  it('returns the uid from a verified Firebase token', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-123' });

    await expect(
      authenticateRequest({ headers: { authorization: 'Bearer firebase-token' } })
    ).resolves.toBe('user-123');
    expect(mockVerifyIdToken).toHaveBeenCalledWith('firebase-token');
  });

  it('normalizes Firebase verification failures to an unauthorized response', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('token expired'));

    await expect(
      authenticateRequest({ headers: { authorization: 'Bearer expired-token' } })
    ).rejects.toEqual(new HttpError(401, 'UNAUTHORIZED', 'Invalid Firebase token'));
  });
});
