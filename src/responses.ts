export interface ApiResponse<T = Record<string, unknown>> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

export function success<T = Record<string, unknown>>(data: T): ApiResponse<T> {
  return { ok: true, data };
}

export function failure(code: string, message: string): ApiResponse {
  return { ok: false, error: { code, message } };
}
