/**
 * The Express adapter.
 *
 * ```ts
 * app.all("/api/popnow/proxy", createExpressHandler());
 * ```
 *
 * Express req/res are Node streams rather than fetch's `Request` and `Response`, so all this layer
 * does is convert between the two; the decision and the forwarding stay in core.
 *
 * Do not mount body-parsing middleware ahead of this route (`express.json()` and friends): it
 * consumes the request body, so what gets forwarded is a request with an empty body, and the error
 * surfaces upstream as a missing-parameter error - which points nowhere near middleware ordering. Either
 * mount the proxy before the parser, or skip the parser for this path.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { createProxyHandler, type ProxyOptions } from "./core.js";

type ExpressLike = IncomingMessage & { originalUrl?: string; body?: unknown };

export function createExpressHandler(options: ProxyOptions = {}) {
  const handle = createProxyHandler(options);

  return async function middleware(
    req: ExpressLike,
    res: ServerResponse,
    next?: (error?: unknown) => void,
  ): Promise<void> {
    let response: Response;
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (value === undefined) continue;
        headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      }

      const hasBody = req.method !== "GET" && req.method !== "HEAD";
      response = await handle(
        new Request(`http://proxy.invalid${req.originalUrl ?? req.url ?? "/"}`, {
          method: req.method,
          headers,
          ...(hasBody ? { body: Readable.toWeb(req) as ReadableStream, duplex: "half" } : {}),
        } as RequestInit),
      );

      res.statusCode = response.status;
      response.headers.forEach((value, name) => res.setHeader(name, value));
    } catch (error) {
      if (next) next(error);
      else {
        res.statusCode = 500;
        res.end();
      }
      return;
    }

    if (!response.body) {
      res.end();
      return;
    }

    // `pipeline` rather than `pipe`. `pipe` leaves the source without an error handler, so an
    // upstream that broke off mid-stream would raise an uncaught exception and took the whole process
    // down. `pipeline` destroys both ends instead - and when the client disconnects, destroying the
    // source cancels the upstream read rather than leaving it running.
    try {
      await pipeline(
        Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
        res,
      );
    } catch {
      // The status line has already been sent, so there is no error response left to give: the
      // client sees the response end early, which is the honest signal for a broken stream.
    }
  };
}
