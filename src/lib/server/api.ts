// API route wrapper — uniform request ids, structured logging, error shape.
//
// Usage:
//   export const GET = withApi('scan', async (request) => { ... });
//   throw new ApiError(404, 'not_found');            // inside a handler
//   return apiError(400, 'bad_request', 'message');  // direct return
//
// THE error shape across every route:
//   { error: { code: string, message: string }, requestId?: string }
// Details are logged server-side and never leaked to the client.

import { logRequest, newRequestId, requestLogger } from './logger';
import { clientIpOf } from './rate-limit';

type Handler = (request: Request, ctx: { requestId: string; log: ReturnType<typeof requestLogger> }) => Promise<Response> | Response;

// ---------------------------------------------------------------------------
// Error shape — { error: { code, message } }
// ---------------------------------------------------------------------------

const DEFAULT_MESSAGES: Record<string, string> = {
  bad_request: 'The request is malformed or missing required fields.',
  bad_id: 'That id is not valid.',
  bad_imdb: 'That IMDB id is not valid.',
  unauthorized: 'You need to sign in to do that.',
  forbidden: 'You do not have permission to do that.',
  not_found: 'Not found.',
  conflict: 'That already exists.',
  too_many_requests: 'Too many requests — slow down a little.',
  internal_error: 'Something went wrong on our side. Please try again.',
  invalid_credentials: 'Wrong email or password.',
  weak_password: 'That password is too weak.',
  invalid_code: 'That code is not valid.',
  invalid_token: 'That link is no longer valid.',
  pending_expired: 'That session expired — sign in again.',
  email_taken: 'An account with that email already exists.',
  rate_limited: 'Too many requests — slow down a little.',
  meta_unreachable: 'Metadata provider is unreachable right now.',
  channels_unreachable: 'Channel guide is unreachable right now.',
  iptv_unreachable: 'IPTV source is unreachable right now.',
  home_required: 'A home parameter is required.',
  sport_home_away_required: 'Home and away stream parameters are required.',
  totp_not_setup: 'Two-factor authentication is not set up yet.',
  totp_not_enabled: 'Two-factor authentication is not enabled.',
  totp_already_enabled: 'Two-factor authentication is already enabled.',
};

/** Normalized API error — throw inside any withApi handler. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;
  constructor(status: number, code: string, message?: string, extra: Record<string, unknown> = {}) {
    super(message ?? DEFAULT_MESSAGES[code] ?? code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/** Build the standard `{ error: { code, message } }` Response. */
export function apiError(status: number, code: string, message?: string, extra: Record<string, unknown> = {}): Response {
  const body = {
    error: { code, message: message ?? DEFAULT_MESSAGES[code] ?? code },
    ...extra,
  };
  return Response.json(body, { status });
}

export function withApi(route: string, handler: Handler) {
  return async (request: Request): Promise<Response> => {
    const requestId = request.headers.get('x-request-id') ?? newRequestId();
    const started = Date.now();
    let response: Response;
    try {
      response = await handler(request, { requestId, log: requestLogger(requestId) });
    } catch (error) {
      if (error instanceof ApiError) {
        response = Response.json(
          { error: { code: error.code, message: error.message }, ...error.extra },
          { status: error.status },
        );
      } else {
        requestLogger(requestId).error(
          { route, err: error instanceof Error ? { message: error.message, stack: error.stack } : error },
          'unhandled route error',
        );
        response = Response.json(
          { error: { code: 'internal_error', message: DEFAULT_MESSAGES.internal_error }, requestId },
          { status: 500 },
        );
      }
    }
    response.headers.set('x-request-id', requestId);
    logRequest({
      requestId,
      method: request.method,
      path: new URL(request.url).pathname,
      status: response.status,
      durationMs: Date.now() - started,
      ip: clientIpOf(request),
    });
    return response;
  };
}
