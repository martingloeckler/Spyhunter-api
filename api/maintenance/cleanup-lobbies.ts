import { createApiHandler } from '../../src/http.js';
import { getDatabase } from '../../src/firebase-admin.js';
import { authenticateCronRequest } from '../../src/auth.js';
import { loadConfig } from '../../src/config.js';
import { success } from '../../src/responses.js';

export default createApiHandler(async (req, res) => {
  const config = loadConfig();
  authenticateCronRequest(req, config.cronSecret);

  const db = getDatabase();
  const lobbiesRef = db.ref('lobbies');
  const now = Date.now();
  const cutoff = now - 2 * 60 * 60 * 1000;
  const snapshot = await lobbiesRef.orderByChild('createdAt').endAt(cutoff).limitToFirst(100).once('value');
  let checked = 0;
  let deleted = 0;

  const entries = snapshot.val() ?? {};
  for (const [code, lobby] of Object.entries(entries as Record<string, any>)) {
    try {
      checked += 1;
      if ((lobby.createdAt ?? 0) > cutoff) {
        continue;
      }
      const latest = await db.ref(`lobbies/${code}`).once('value');
      if ((latest.val()?.createdAt ?? 0) <= cutoff) {
        await db.ref(`lobbies/${code}`).remove();
        deleted += 1;
      }
    } catch {
      // continue with other lobbies
    }
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(success({ checked, deleted })));
}, { methods: ['GET'] });
