import crypto from 'node:crypto';

const TOKEN_PREFIX = 'v1.';
const TOKEN_PATTERN = /^v1\.[A-Za-z0-9_-]{43}$/;

export function deriveCatchToken(secret: string, lobbyCode: string, gameStartedAt: number, agentUid: string): string {
  const payload = `${lobbyCode}\n${gameStartedAt}\n${agentUid}`;
  const signature = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('base64url');
  return `${TOKEN_PREFIX}${signature}`;
}

export function isCatchTokenFormatValid(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

export function catchTokensEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}
