// API route wrapper — uniform request ids, structured logging, error shape.
//
// Usage:
//   export const GET = withApi('scan', async (request) => { ... });
// The handler returns any Response; thrown errors become a consistent
//   { error: 'server_error', requestId }
// with the details logged server-side (never leaked to the client).

import { logRequest, newRequestId, requestLogger } from './logger';
import { clientIpOf } from './rate-limit';

type Handler = (request: Request, ctx: { requestId: string; log: ReturnType<typeof requestLogger> }) => Promise<Response> | Response;

export function withApi(route: string, handler: Handler) {
  return async (request: Request): Promise<Response> => {
    const requestId = request.headers.get('x-request-id') ?? newRequestId();
    const started = Date.now();
    let response: Response;
    try {
      response = await handler(request, { requestId, log: requestLogger(requestId) });
    } catch (error) {
      requestLogger(requestId).error(
        { route, err: error instanceof Error ? { message: error.message, stack: error.stack } : error },
        'unhandled route error',
      );
      response = Response.json(
        { error: 'server_error', requestId },
        { status: 500, headers: { 'x-request-id': requestId } },
      );
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
