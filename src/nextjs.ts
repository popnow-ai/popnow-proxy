/**
 * The Next.js adapter.
 *
 * App Router: re-export the method handlers from the route file, unchanged.
 *
 * ```ts
 * // app/api/popnow/proxy/route.ts
 * export { GET, POST, PUT, PATCH, DELETE } from "@popnow/proxy/nextjs";
 * export const runtime = "nodejs"; // see below
 * ```
 *
 * To pass options, build the handlers yourself:
 *
 * ```ts
 * export const { GET, POST } = createRoute({ timeoutMs: 60_000 });
 * ```
 *
 * `runtime` must be set to `nodejs` explicitly: the edge runtime cannot read the server-only
 * values in `process.env`, and the key lives precisely there. A project that defaults to the edge
 * discovers this only after deploying - at which point the proxy answers 500 "no key configured"
 * while everything works locally.
 */
import { createProxyHandler, type ProxyOptions } from "./core.js";

/** App Router method handlers built with the given options. */
export function createRoute(options: ProxyOptions = {}) {
  const handle = createProxyHandler(options);
  return { GET: handle, POST: handle, PUT: handle, PATCH: handle, DELETE: handle };
}

/** An App Router route with default configuration, taking its key from `POPNOW_API_KEY`. */
export const route = createRoute();

/** The default route's handlers as named exports, so a route file can re-export them in one line. */
export const { GET, POST, PUT, PATCH, DELETE } = route;
