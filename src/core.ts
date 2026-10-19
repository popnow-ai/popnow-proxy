/**
 * A server-side proxy that lets client applications call the PopNow API without ever holding an API
 * key.
 *
 * JavaScript in a browser, an iOS or Android app, a desktop app - none of these can keep a secret.
 * A key shipped inside a bundle is a public key: an attacker decompiles it, or captures one
 * request, and then spends credits until the balance is gone.
 *
 * The right shape is for the client to call the developer's own server, and for that layer to add
 * the key and forward the request. This module is that layer, mounted inside a Next.js, Express or
 * any other fetch runtime.
 *
 * ## The protocol
 *
 * The client puts the destination in an `x-popnow-target-url` header and calls whichever route its
 * own backend agreed on (`/api/popnow/proxy` by convention). The proxy validates the target origin
 * and the API route, adds `Authorization`, forwards the request and passes the response straight
 * back.
 *
 * ## Why the destination must be allow-listed rather than "forward to whatever the header says"
 *
 * This is the one place in the design where getting it wrong is catastrophic. Without validation,
 * anyone can put `https://attacker.example` in that header and have your server send them your key
 * - one request leaks it, and the traffic looks entirely normal, because your own server sent it.
 *
 * So `allowedOrigins` defaults to `https://api.popnow.ai` alone, and the comparison is on the
 * exact origin rather than a prefix: `https://api.popnow.ai.attacker.example` starts with our
 * domain too.
 *
 * On top of the origin, only the documented public API routes are forwarded by default (see
 * `DEFAULT_ROUTES`), each with its documented method.
 */

import { USER_AGENT } from "./version.js";

/** The header carrying the destination. Lower-case throughout, as HTTP/2 accepts nothing else. */
export const TARGET_URL_HEADER = "x-popnow-target-url";

/** The conventional route. Not mandatory, but keeping it consistent lets front-end configuration
 * be copied as-is. */
export const DEFAULT_PROXY_ROUTE = "/api/popnow/proxy";

/** The API's production entry point. */
export const DEFAULT_ALLOWED_ORIGIN = "https://api.popnow.ai";

/**
 * One forwardable API route.
 *
 * `path` is matched segment by segment against the target URL's path (the query string is ignored).
 * `{name}` matches exactly one non-empty segment; `{name+}` matches one or more segments and may
 * only appear last (model identifiers such as `kling/3.0/text-to-video` contain slashes).
 */
export interface RouteRule {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
}

/**
 * Every route of the public PopNow API contract (https://popnow.ai/docs/openapi.yaml), with the
 * method it documents. Anything else on the API origin is refused, so a leaked proxy URL cannot be
 * used to reach endpoints the contract does not promise.
 */
export const DEFAULT_ROUTES: readonly RouteRule[] = Object.freeze([
  // Tasks
  { method: "POST", path: "/api/v1/jobs/quote" },
  { method: "POST", path: "/api/v1/jobs/createTask" },
  { method: "GET", path: "/api/v1/jobs/recordInfo" },
  { method: "POST", path: "/api/v1/jobs/retry" },
  { method: "POST", path: "/api/v1/jobs/purge" },
  { method: "GET", path: "/api/v1/jobs" },
  // Models and account
  { method: "GET", path: "/api/v1/models" },
  { method: "GET", path: "/api/v1/models/{model+}" },
  { method: "GET", path: "/api/v1/usage" },
  { method: "GET", path: "/api/v1/chat/credit" },
  // Media
  { method: "POST", path: "/api/v1/common/upload-url" },
  { method: "POST", path: "/api/v1/files/{fileId}/commit" },
  { method: "POST", path: "/api/v1/files/import" },
  { method: "POST", path: "/api/v1/common/download-url" },
  // Asset library
  { method: "GET", path: "/api/v1/assets" },
  { method: "POST", path: "/api/v1/assets" },
  { method: "GET", path: "/api/v1/assets/usage" },
  { method: "GET", path: "/api/v1/assets/entities" },
  { method: "GET", path: "/api/v1/assets/entities/{entityId}" },
  { method: "GET", path: "/api/v1/assets/{assetId}" },
  { method: "PATCH", path: "/api/v1/assets/{assetId}" },
  { method: "DELETE", path: "/api/v1/assets/{assetId}" },
  // OpenAI-compatible
  { method: "GET", path: "/v1/models" },
  { method: "POST", path: "/v1/videos" },
  { method: "GET", path: "/v1/videos/{videoId}" },
  { method: "GET", path: "/v1/videos/{videoId}/content" },
] satisfies RouteRule[]);

/**
 * Hop-by-hop headers: they describe this particular connection rather than the message, so
 * forwarding them is meaningless and possibly harmful. See RFC 9110 section 7.6.1. `host` is a
 * separate case - it has to be recomputed for the destination, and copying it confuses the origin.
 */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

/**
 * These headers are dropped whatever the client sends, so that it cannot influence the
 * authentication decision made on its behalf.
 *
 * `authorization` matters most: without dropping it, a client could supply its own and override the
 * one we add, turning the proxy into an open relay that forwards on behalf of any key at all.
 * `x-api-key` and `x-goog-api-key` are where common SDKs put a key; they are dropped too, so no
 * credential the client chose ever reaches the API. `user-agent` is replaced with the proxy's own.
 */
const CLIENT_CONTROLLED = new Set([
  "authorization",
  "cookie",
  "x-api-key",
  "x-goog-api-key",
  "user-agent",
]);

/**
 * Not forwarded upstream: the runtime's fetch negotiates compression for its own connection and
 * hands back a decoded body. Forwarding the browser's list instead lets the API answer in an
 * encoding the runtime then decodes, while the response still claims to be compressed.
 */
const NEGOTIATED_BY_RUNTIME = new Set(["accept-encoding"]);

/**
 * Not passed back to the client: the body the runtime's fetch returns is already decoded, so the
 * upstream `content-encoding` no longer describes it. Passing it on labels plain bytes as `br` or
 * `gzip`, and the browser fails to decode the response.
 */
const DESCRIBES_UPSTREAM_BODY = new Set(["content-encoding"]);

export interface ProxyOptions {
  /**
   * The API key (`sk-popnow-...`). Read from `POPNOW_API_KEY` by default.
   *
   * Passing a function supports rotation: it is consulted on every request, so no restart is
   * needed.
   */
  apiKey?: string | (() => string | undefined);
  /** Origins this proxy may forward to. The production entry point alone by default; only local
   * development needs it widened. */
  allowedOrigins?: string[];
  /**
   * API routes this proxy may forward, `DEFAULT_ROUTES` by default. Narrow it to what your app
   * actually calls, for example only `jobs/quote`, `jobs/createTask` and `jobs/recordInfo`.
   */
  allowedRoutes?: readonly RouteRule[];
  /**
   * How long to wait for the upstream response headers, 120 seconds by default. Once the headers
   * have arrived the body is passed through for as long as it takes.
   */
  timeoutMs?: number;
  /** An injected fetch, for tests. It must decode compressed bodies, as the standard fetch does. */
  fetch?: typeof fetch;
}

export class ProxyConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProxyConfigurationError";
  }
}

/** The proxy's decision: either allow, with the request to send, or refuse, with the status to
 * answer. */
export type ProxyDecision =
  { ok: true; request: Request } | { ok: false; status: number; message: string };

function resolveKey(options: ProxyOptions): string | undefined {
  const raw = typeof options.apiKey === "function" ? options.apiKey() : options.apiKey;
  const key = (raw ?? process.env.POPNOW_API_KEY)?.trim();
  return key || undefined;
}

function allowedOrigins(options: ProxyOptions): string[] {
  const list = options.allowedOrigins ?? [DEFAULT_ALLOWED_ORIGIN];
  if (list.length === 0) {
    throw new ProxyConfigurationError(
      "allowedOrigins must not be empty; an empty list would forward your API key anywhere",
    );
  }
  return list;
}

function allowedRoutes(options: ProxyOptions): readonly RouteRule[] {
  const list = options.allowedRoutes ?? DEFAULT_ROUTES;
  if (list.length === 0) {
    throw new ProxyConfigurationError(
      "allowedRoutes must not be empty; pass DEFAULT_ROUTES or the routes your app calls",
    );
  }
  return list;
}

/** Splits a path into segments, ignoring a single trailing slash. */
function segments(path: string): string[] {
  const trimmed = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  return trimmed.split("/").slice(1);
}

/** Whether a URL path matches a route pattern; see `RouteRule` for the syntax. */
export function matchesRoute(pattern: string, path: string): boolean {
  const want = segments(pattern);
  const have = segments(path);
  for (let i = 0; i < want.length; i += 1) {
    const part = want[i] as string;
    const actual = have[i];
    if (part.startsWith("{") && part.endsWith("+}")) {
      // A greedy parameter: the rest of the path, at least one non-empty segment.
      const rest = have.slice(i);
      return i === want.length - 1 && rest.length > 0 && rest.every((s) => s.length > 0);
    }
    if (actual === undefined) return false;
    if (part.startsWith("{") && part.endsWith("}")) {
      if (actual.length === 0) return false;
      continue;
    }
    if (part !== actual) return false;
  }
  return want.length === have.length;
}

/**
 * Turns an incoming request into either "forward this" or "refuse".
 *
 * This function never touches the network, so every framework adapter shares it and tests can
 * assert on the decision directly without standing up a real HTTP server.
 */
export function decide(incoming: Request, options: ProxyOptions = {}): ProxyDecision {
  const target = incoming.headers.get(TARGET_URL_HEADER);
  if (!target) {
    return { ok: false, status: 400, message: `missing ${TARGET_URL_HEADER} header` };
  }

  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return { ok: false, status: 400, message: `${TARGET_URL_HEADER} is not a valid absolute URL` };
  }

  // Exact origin comparison. A prefix match would admit https://api.popnow.ai.attacker.example.
  if (!allowedOrigins(options).includes(url.origin)) {
    return { ok: false, status: 403, message: `target origin is not allowed: ${url.origin}` };
  }

  // `new URL` has already resolved `.` and `..` segments, so the path compared here is the path
  // that will be requested.
  const method = incoming.method.toUpperCase();
  const routes = allowedRoutes(options);
  if (!routes.some((rule) => rule.method === method && matchesRoute(rule.path, url.pathname))) {
    return {
      ok: false,
      status: 403,
      message: `route is not allowed through this proxy: ${method} ${url.pathname}`,
    };
  }

  const key = resolveKey(options);
  if (!key) {
    // This is a deployment problem rather than the caller's mistake, so it must not be a 4xx.
    return { ok: false, status: 500, message: "the proxy has no PopNow API key configured" };
  }

  const headers = new Headers();
  for (const [name, value] of incoming.headers) {
    const lower = name.toLowerCase();
    if (lower === TARGET_URL_HEADER) continue;
    if (HOP_BY_HOP.has(lower)) continue;
    if (CLIENT_CONTROLLED.has(lower)) continue;
    if (NEGOTIATED_BY_RUNTIME.has(lower)) continue;
    headers.set(name, value);
  }
  headers.set("authorization", `Bearer ${key}`);
  headers.set("user-agent", USER_AGENT);

  return {
    ok: true,
    request: new Request(url, {
      method,
      headers,
      body: incoming.body,
      // What is forwarded is a new request and must not inherit the caller's redirect policy.
      redirect: "manual",
      // Node's undici requires duplex to be declared explicitly for a streaming body. It is not
      // part of the standard RequestInit, so only this fragment is asserted rather than the whole
      // literal - asserting the literal would switch off type checking for every field above.
      ...(incoming.body ? ({ duplex: "half" } as RequestInit) : {}),
    }),
  };
}

/** Answers with a refusal shaped like the API's error envelope, so a client needs no separate
 * parsing path for the proxy. */
function refuse(status: number, message: string): Response {
  return new Response(JSON.stringify({ code: status, msg: message, request_id: null }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

/**
 * The generic handler: takes a `Request` and returns a `Response`.
 *
 * Framework adapters are responsible only for converting their own request object into a `Request`;
 * the decision and the forwarding both happen here.
 */
export function createProxyHandler(options: ProxyOptions = {}) {
  const doFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 120_000;

  return async function handle(incoming: Request): Promise<Response> {
    const decision = decide(incoming, options);
    if (!decision.ok) return refuse(decision.status, decision.message);

    // The timer covers the wait for the response headers and is cleared as soon as they arrive. A
    // signal such as AbortSignal.timeout() would stay attached to the body and cut a slow download
    // off midway.
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), timeoutMs);
    let upstream: Response;
    try {
      upstream = await doFetch(decision.request, { signal: timeout.signal });
    } catch {
      // Do not return the upstream error verbatim: it may carry an internal hostname.
      if (timeout.signal.aborted) {
        return refuse(504, "the upstream request did not complete in time");
      }
      return refuse(502, "the upstream request failed");
    } finally {
      clearTimeout(timer);
    }

    const headers = new Headers();
    for (const [name, value] of upstream.headers) {
      const lower = name.toLowerCase();
      if (HOP_BY_HOP.has(lower)) continue;
      if (DESCRIBES_UPSTREAM_BODY.has(lower)) continue;
      headers.set(name, value);
    }
    // The body is handed over as the same stream, unbuffered. When the client goes away the
    // framework cancels this stream, and the cancel reaches the upstream connection.
    return new Response(upstream.body, { status: upstream.status, headers });
  };
}
