/**
 * Server-side client for the internal ai-engine service.
 *
 * Trust model (Finding 2): the ai-engine authenticates the calling *service*, not the end
 * user. Every request the BFF sends to the engine carries `X-Service-Key`; the BFF itself
 * remains responsible for user authentication, session/resource ownership and rate limiting
 * BEFORE it calls this helper.
 *
 * Security properties enforced here, in one place:
 *  - The key comes from the server-only `SERVICE_API_KEY` environment variable. It is never
 *    a NEXT_PUBLIC_* variable, so Next.js will not inline it into any browser bundle. This
 *    module must only be imported from server code (route handlers / server actions);
 *    a test asserts no client component imports it.
 *  - Fail closed: if the key is missing/blank, no request is made at all.
 *  - A caller-supplied `X-Service-Key` (any casing) is discarded and replaced, so request
 *    data can never choose the credential.
 */

export class AiEngineAuthConfigError extends Error {
  constructor() {
    super('AI engine service authentication is not configured.');
    this.name = 'AiEngineAuthConfigError';
  }
}

const SERVICE_KEY_HEADER = 'X-Service-Key';

/** Returns the configured service key, or throws (fail closed). */
export function getServiceApiKey(): string {
  const value = process.env.SERVICE_API_KEY?.trim();
  if (!value) {
    throw new AiEngineAuthConfigError();
  }
  return value;
}

function toPlainHeaders(init: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!init) return out;

  const put = (k: string, v: string) => {
    // never let request-derived data pick the credential
    if (k.toLowerCase() === SERVICE_KEY_HEADER.toLowerCase()) return;
    out[k] = v;
  };

  if (typeof (init as Headers).forEach === 'function' && !Array.isArray(init)) {
    (init as Headers).forEach((v, k) => put(k, v));
  } else if (Array.isArray(init)) {
    for (const [k, v] of init) put(k, v);
  } else {
    for (const [k, v] of Object.entries(init as Record<string, string>)) put(k, v);
  }
  return out;
}

/**
 * fetch() to the ai-engine with the service credential attached.
 * Rejects with AiEngineAuthConfigError (before any network I/O) if the key is not configured.
 */
export async function aiEngineFetch(url: string | URL, init: RequestInit = {}): Promise<Response> {
  const key = getServiceApiKey();
  const headers = toPlainHeaders(init.headers);
  headers[SERVICE_KEY_HEADER] = key;
  return fetch(url, { ...init, headers });
}
