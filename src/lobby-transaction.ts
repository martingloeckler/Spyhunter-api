import { HttpError } from './errors.js';
import type { Lobby } from './types.js';

interface DatabaseSnapshot {
  val(): unknown;
}

interface DatabaseReference {
  transaction(update: (current: Lobby | null) => Lobby | null | undefined): Promise<{
    committed: boolean;
    snapshot?: DatabaseSnapshot;
  }>;
}

type TransactionDecision<T> =
  | { kind: 'commit'; value: Lobby | null; data: T }
  | { kind: 'reject'; error: HttpError };

export function commitLobby<T>(value: Lobby | null, data: T): TransactionDecision<T> {
  return { kind: 'commit', value, data };
}

export function rejectLobby<T = never>(status: number, code: string, message: string): TransactionDecision<T> {
  return { kind: 'reject', error: new HttpError(status, code, message) };
}

export async function runLobbyTransaction<T>(
  reference: DatabaseReference,
  decide: (current: Lobby | null) => TransactionDecision<T>
): Promise<T> {
  let rejection: HttpError | undefined;
  let responseData: T | undefined;
  let hasResponseData = false;

  const result = await reference.transaction((current) => {
    const decision = decide(current);
    if (decision.kind === 'reject') {
      rejection = decision.error;
      return undefined;
    }
    rejection = undefined;
    responseData = decision.data;
    hasResponseData = true;
    return decision.value;
  });

  if (!result.committed) {
    throw rejection ?? new HttpError(409, 'TRANSACTION_CONFLICT', 'Transaction could not be completed');
  }
  if (!hasResponseData) {
    throw new HttpError(500, 'INTERNAL_ERROR', 'Transaction completed without an outcome');
  }
  return responseData as T;
}
