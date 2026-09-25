import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { log, withLogContext, type Fields, type Level } from "./log";

const http = log.child({ scope: "http" });
const g = globalThis as unknown as { __lensRequestNotes?: AsyncLocalStorage<Fields>; __lensLoggedErrors?: WeakSet<object> };
const notes = (g.__lensRequestNotes ??= new AsyncLocalStorage<Fields>());
// Errors already logged with their request, so instrumentation's onRequestError doesn't log them twice.
const logged = (g.__lensLoggedErrors ??= new WeakSet<object>());

export const REQUEST_ID_HEADER = "x-request-id";
// A proxy's id is kept when it looks like one; anything else could be used to forge log lines.
const SAFE_ID = /^[A-Za-z0-9._-]{1,64}$/;

export function requestId(request: Request): string {
  const given = request.headers.get(REQUEST_ID_HEADER);
  return given && SAFE_ID.test(given) ? given : randomBytes(4).toString("hex");
}

// Adds fields (a key, a count, a decision) to the current request's log line.
export function noteRequest(fields: Fields): void {
  const store = notes.getStore();
  if (store) Object.assign(store, fields);
}

export function wasLogged(e: unknown): boolean {
  return typeof e === "object" && e !== null && logged.has(e);
}

function levelFor(status: number, quiet: boolean): Level {
  if (status >= 500) return "error";
  if (status >= 400) return "warn";
  return quiet ? "debug" : "info";
}

function withHeader(res: Response, id: string): Response {
  try {
    res.headers.set(REQUEST_ID_HEADER, id);
    return res;
  } catch {
    // Response.redirect() and fetched responses have immutable headers.
    const copy = new Response(res.body, res);
    copy.headers.set(REQUEST_ID_HEADER, id);
    return copy;
  }
}

export interface RequestLogOptions {
  // Successful requests log at debug (media byte ranges, polled endpoints).
  quiet?: boolean;
}

// Logs one line per request (method, path without the query, status, ms to the response headers) and
// returns the request id as `x-request-id`. Lines logged inside the handler carry the same `req`.
export function withRequestLog<R extends Request, A extends unknown[]>(
  handler: (request: R, ...rest: A) => Response | Promise<Response>,
  { quiet = false }: RequestLogOptions = {},
): (request: R, ...rest: A) => Promise<Response> {
  return (request, ...rest) => {
    const id = requestId(request);
    const method = request.method;
    const path = new URL(request.url).pathname;
    const start = performance.now();
    const fields: Fields = {};
    return withLogContext({ req: id }, () =>
      notes.run(fields, async () => {
        try {
          const res = await handler(request, ...rest);
          const ms = Math.round(performance.now() - start);
          http.log(levelFor(res.status, quiet), `${method} ${path} ${res.status}`, { method, path, status: res.status, ms, ...fields });
          return withHeader(res, id);
        } catch (e) {
          const ms = Math.round(performance.now() - start);
          http.error(`${method} ${path} threw`, { method, path, status: 500, ms, ...fields, err: e });
          if (typeof e === "object" && e !== null) logged.add(e);
          throw e;
        }
      }),
    );
  };
}
