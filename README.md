<p align="center">
  <a href="https://popnow.ai">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="assets/popnow-wordmark-dark.png">
      <source media="(prefers-color-scheme: light)" srcset="assets/popnow-wordmark.png">
      <img alt="PopNow" src="assets/popnow-wordmark.png" width="280">
    </picture>
  </a>
</p>

<h1 align="center">PopNow Proxy — Call the AI Video &amp; Image API from the Browser Without Exposing Your Key</h1>

<p align="center">
  <strong><code>@popnow/proxy</code> is a small server-side proxy for the PopNow API</strong>: it lets a browser,
  mobile or desktop app generate AI video, images and music through your own backend, while the API key stays
  on the server.
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="TypeScript" src="https://img.shields.io/badge/language-TypeScript-3178c6.svg">
  <img alt="Node 22.12+" src="https://img.shields.io/badge/node-%3E%3D22.12-339933.svg">
  <a href="https://popnow.ai"><img alt="Website" src="https://img.shields.io/badge/site-popnow.ai-ff5c8a.svg"></a>
  <a href="https://popnow.ai/docs"><img alt="Docs" src="https://img.shields.io/badge/docs-popnow.ai%2Fdocs-111.svg"></a>
</p>

PopNow is a browser-based AI studio for videos, images and music: image-to-video, text-to-video, AI images,
music and speech, one-tap trending video effects and image styles, with models such as Kling, Seedance, Wan,
Vidu, MiniMax, Nano Banana, GPT Image, Flux and Suno.

A key compiled into a client is a public key. Anyone can open the bundle or watch one request, and then spend
your credits until they run out. The fix is not obfuscation; it is to never put the key there. The app calls
**your** server, and your server adds the credential. This package is that server-side hop, for Next.js,
Express and any runtime that speaks `fetch`'s `Request` and `Response`. It has no runtime dependencies.

## Quickstart

**1. Install** (Node.js 22.12 or newer). The npm release is coming soon; until then, install from GitHub:

```bash
npm install github:popnow-ai/popnow-proxy
```

npm builds the package on install (the `prepare` script), so nothing else is needed.

**2. Set your API key on the server** from [popnow.ai/api/console/keys](https://popnow.ai/api/console/keys).
It is read from `POPNOW_API_KEY` and never sent to the client.

```bash
POPNOW_API_KEY="sk-popnow-..."
```

**3. Add one route** (Next.js App Router shown) and call it from the browser:

```ts
// app/api/popnow/proxy/route.ts
export { GET, POST, PUT, PATCH, DELETE } from "@popnow/proxy/nextjs";
export const runtime = "nodejs";
```

```ts
// In the browser: create an image task. The key never leaves your server.
const response = await fetch("/api/popnow/proxy", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-popnow-target-url": "https://api.popnow.ai/api/v1/jobs/createTask",
    "idempotency-key": crypto.randomUUID(),
  },
  body: JSON.stringify({
    model: "alibaba/z-image-turbo/text-to-image",
    input: { prompt: "A small red fox curled up in a teacup, soft morning light" },
  }),
});
const { code, msg, data } = await response.json();
if (code !== 200) throw new Error(msg);
console.log(data.taskId); // poll GET /api/v1/jobs/recordInfo?taskId=... through the same route
```

## Features

| Feature                   | What it does                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| Key stays on the server   | Adds `Authorization: Bearer $POPNOW_API_KEY`; client-supplied credentials are always dropped     |
| Origin allow-list         | Forwards only to `https://api.popnow.ai` by default, compared on the exact origin               |
| Route allow-list          | Forwards only the documented public API routes, each with its documented method                 |
| Framework adapters        | Next.js App Router, Express, and a generic `(Request) => Promise<Response>` handler             |
| Streaming pass-through    | Request and response bodies are streamed, not buffered; redirects are passed back, not followed |
| Envelope-shaped refusals  | Refusals use the API's `{code, msg, request_id}` envelope, so clients need one parsing path     |
| Explicit User-Agent       | Every forwarded request says `popnow-proxy/<version>`                                          |
| Key rotation              | `apiKey` can be a function, read on every request                                               |

## Forwarded routes

By default the proxy forwards exactly the routes of the public API contract
([openapi.yaml](https://popnow.ai/docs/openapi.yaml)) and refuses everything else with `403`:

| Method               | Path                                    | Purpose                                     |
| -------------------- | --------------------------------------- | ------------------------------------------- |
| `POST`               | `/api/v1/jobs/quote`                    | Price a request without holding credits     |
| `POST`               | `/api/v1/jobs/createTask`               | Create a generation task                    |
| `GET`                | `/api/v1/jobs/recordInfo`               | Poll one task                               |
| `GET`                | `/api/v1/jobs`                          | List tasks                                  |
| `POST`               | `/api/v1/jobs/retry`                    | Create a new task from a failed one         |
| `POST`               | `/api/v1/jobs/purge`                    | Destroy a finished task's stored content    |
| `GET`                | `/api/v1/models`, `/api/v1/models/{model}` | Models, prices and input schemas         |
| `GET`                | `/api/v1/usage`, `/api/v1/chat/credit`  | Usage and credit balance                    |
| `POST`               | `/api/v1/common/upload-url`             | Upload ticket                               |
| `POST`               | `/api/v1/files/{fileId}/commit`         | Commit an uploaded file                     |
| `POST`               | `/api/v1/files/import`                  | Import LoRA weights from a link             |
| `POST`               | `/api/v1/common/download-url`           | Signed download link for a result           |
| `GET` `POST`         | `/api/v1/assets`                        | List or save assets                         |
| `GET`                | `/api/v1/assets/usage`, `/api/v1/assets/entities`, `/api/v1/assets/entities/{entityId}` | Library usage and characters |
| `GET` `PATCH` `DELETE` | `/api/v1/assets/{assetId}`            | Get, rename or delete one asset             |
| `GET`                | `/v1/models`                            | OpenAI-compatible model list                |
| `POST`               | `/v1/videos`                            | OpenAI-compatible video creation            |
| `GET`                | `/v1/videos/{videoId}`, `/v1/videos/{videoId}/content` | OpenAI-compatible status and download |

Narrow the list to what your app actually calls:

```ts
import { createRoute } from "@popnow/proxy/nextjs";

export const { GET, POST } = createRoute({
  allowedRoutes: [
    { method: "POST", path: "/api/v1/jobs/quote" },
    { method: "POST", path: "/api/v1/jobs/createTask" },
    { method: "GET", path: "/api/v1/jobs/recordInfo" },
  ],
});
export const runtime = "nodejs";
```

Patterns match whole path segments; `{name}` matches one segment and `{name+}` (last only) matches the rest
of the path. `DEFAULT_ROUTES` is exported if you want to extend the defaults instead.

## Usage

### Next.js (App Router)

```ts
// app/api/popnow/proxy/route.ts
export { GET, POST, PUT, PATCH, DELETE } from "@popnow/proxy/nextjs";
export const runtime = "nodejs";
```

`runtime = "nodejs"` is not optional. Edge runtimes do not see server-only environment variables, so the proxy
would answer `500` in production while working perfectly on your machine. To pass options, build the handlers
yourself with `createRoute({ ... })` as shown above.

### Express

```ts
import { createExpressHandler } from "@popnow/proxy/express";

app.all("/api/popnow/proxy", createExpressHandler());
```

Mount it **before** any body parser. `express.json()` consumes the request body, and the proxy would then
forward an empty one, which surfaces as a missing-parameter error that points nowhere near your middleware
order.

### Any fetch runtime

```ts
import { createProxyHandler } from "@popnow/proxy";

const handle = createProxyHandler({ apiKey: () => process.env.POPNOW_API_KEY });
// handle(request: Request) => Promise<Response>
```

### Uploading a file from the browser

An upload is three requests, and only two of them go through the proxy:

```ts
async function viaProxy(target: string, body?: unknown) {
  const response = await fetch("/api/popnow/proxy", {
    method: "POST",
    headers: { "content-type": "application/json", "x-popnow-target-url": target },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = await response.json();
  if (json.code !== 200) throw new Error(json.msg);
  return json.data;
}

// `file` is a File, for example from <input type="file">.
// 1. A ticket, through the proxy. contentType must be a type the API accepts (image/png, video/mp4, ...).
const ticket = await viaProxy("https://api.popnow.ai/api/v1/common/upload-url", {
  contentType: file.type,
  bytes: file.size,
});

// 2. The bytes, straight to storage - NOT through the proxy.
const headers = new Headers(ticket.headers);
headers.delete("Content-Length"); // browsers derive it from the File
const put = await fetch(ticket.uploadUrl, { method: ticket.method, headers, body: file });
if (!put.ok) throw new Error(`upload failed with HTTP ${put.status}`);

// 3. Commit, through the proxy. Its `uri` (popnow://f/...) goes into the task input, e.g. `image_url`.
const { uri } = await viaProxy(`https://api.popnow.ai/api/v1/files/${ticket.fileId}/commit`);
```

Step 2 must not go through the proxy, and the proxy refuses it anyway: the presigned `uploadUrl` points at a
storage host, not at `https://api.popnow.ai`, and it is a credential in its own right.

`GET /v1/videos/{videoId}/content` answers with a redirect to a short-lived signed download link. The proxy
passes the redirect back unchanged, so the browser downloads the file directly from storage, without your key.

## Configuration

| Option           | Default                      | Meaning                                                            |
| ---------------- | ---------------------------- | ------------------------------------------------------------------ |
| `apiKey`         | `process.env.POPNOW_API_KEY` | A string, or a function read on every request (for rotation)       |
| `allowedOrigins` | `["https://api.popnow.ai"]`  | Origins it may forward to; widen only for local development        |
| `allowedRoutes`  | `DEFAULT_ROUTES`             | Method and path patterns it may forward                            |
| `timeoutMs`      | `120000`                     | How long to wait for the upstream **response headers**             |
| `fetch`          | `globalThis.fetch`           | An injected fetch, for tests                                       |

An empty `allowedOrigins` or `allowedRoutes` throws a `ProxyConfigurationError` instead of meaning "allow
everything". `timeoutMs` covers only the wait for the response headers; once they arrive, the body is passed
through for as long as it takes.

## Error handling

| Situation                                  | Status |
| ------------------------------------------ | ------ |
| No `x-popnow-target-url` header, or not a URL | `400` |
| Target origin not allow-listed             | `403`  |
| Method and path not allow-listed           | `403`  |
| No key configured on the server            | `500`  |
| Upstream could not be reached              | `502`  |
| Upstream sent no headers in time           | `504`  |

Refusals use the API's envelope, `{"code": 403, "msg": "...", "request_id": null}`, so a client needs no
separate parsing path. Every other status and body comes from the PopNow API itself; see
[popnow.ai/docs/errors](https://popnow.ai/docs/errors) for its codes.

**The origin allow-list is the whole point.** Forwarding to whatever the header says would let a stranger make
your server hand your key to a host they control. The comparison is on the exact origin, never a prefix:
`https://api.popnow.ai.attacker.example` starts with our domain too.

Client-supplied `authorization`, `x-api-key`, `x-goog-api-key`, `cookie` and `user-agent` headers are dropped
before forwarding, so the proxy cannot be turned into an open relay for someone else's credentials.

### Headers it rewrites

- The client's `accept-encoding` is not forwarded. The server-side fetch negotiates compression itself and
  decodes the reply, so the upstream `content-encoding` is not passed back either.
- Hop-by-hop headers (`connection`, `transfer-encoding`, `host`, `content-length` and the like) are recomputed
  for each hop rather than copied.
- `user-agent` is set to `popnow-proxy/<version> (+https://github.com/popnow-ai/popnow-proxy)`.
- Everything else, such as `content-type`, `idempotency-key`, `x-popnow-retention` and response headers like
  `retry-after`, passes through unchanged.

## Limits

This hop authenticates to PopNow. It does **not** authenticate your users: anyone who can reach the route can
spend your credits. Put your own session check, rate limit and per-user quota in front of it, exactly as you
would for any endpoint that costs money. Use `allowedRoutes` to expose only what your app needs, for example
no `jobs/purge` or asset deletion.

## FAQ

### How do I call an AI image or video API from the browser without exposing my API key?

Put the key on your server and forward the browser's requests through a route that adds it. With this package
that is one Next.js route file or one Express line; the browser sends the real API URL in the
`x-popnow-target-url` header and never sees `sk-popnow-...`.

### How do I generate a video from an image in a web app?

Upload the image through the proxy (ticket and commit) with the bytes going straight to storage, then call
`POST /api/v1/jobs/createTask` with an image-to-video model and the committed `popnow://f/...` URI as
`image_url`, and poll `GET /api/v1/jobs/recordInfo?taskId=...`. The live model list is `GET /api/v1/models`.

### Can someone use my proxy to call any URL with my key?

No. Only `https://api.popnow.ai` (exact origin) and the documented API routes are forwarded; everything else is
refused with `403` before the key is attached. It is still your endpoint, so add your own user authentication
and rate limits in front of it.

### Does it work on Vercel, Netlify or Cloudflare Workers?

On any runtime with the standard `Request`, `Response` and `fetch` and access to a server-side secret. On
Next.js set `runtime = "nodejs"`; on other runtimes pass the key explicitly with
`createProxyHandler({ apiKey: () => env.POPNOW_API_KEY })`.

### How do I show the price before the user generates?

Forward `POST /api/v1/jobs/quote` with the same `model` and `input` first; it returns the price in credits
without holding anything (1 credit = $0.01, see [popnow.ai/pricing](https://popnow.ai/pricing)).

### Does the proxy retry or deduplicate requests?

No; it forwards each request once. Send an `Idempotency-Key` with `createTask` so a retried request from the
browser never creates a second task.

## Development

```bash
git clone https://github.com/popnow-ai/popnow-proxy && cd popnow-proxy
npm install
npm run typecheck && npm test
```

Tests use loopback servers and injected `fetch` functions and never call the live API.

## Links

- Website: [popnow.ai](https://popnow.ai) · Pricing: [popnow.ai/pricing](https://popnow.ai/pricing)
- Docs: [popnow.ai/docs](https://popnow.ai/docs) · API reference: [popnow.ai/docs/openapi](https://popnow.ai/docs/openapi) ([openapi.yaml](https://popnow.ai/docs/openapi.yaml)) · [llms.txt](https://popnow.ai/llms.txt)
- MCP server for AI assistants: [popnow.ai/mcp](https://popnow.ai/mcp)
- Other PopNow repositories:
  [popnow-js](https://github.com/popnow-ai/popnow-js) ·
  [popnow-cli](https://github.com/popnow-ai/popnow-cli) ·
  [popnow-mcp](https://github.com/popnow-ai/popnow-mcp) ·
  [popnow-skills](https://github.com/popnow-ai/popnow-skills) ·
  [popnow-python](https://github.com/popnow-ai/popnow-python) ·
  [popnow-api](https://github.com/popnow-ai/popnow-api) ·
  [popnow-blender](https://github.com/popnow-ai/popnow-blender) ·
  [popnow-comfyui](https://github.com/popnow-ai/popnow-comfyui) ·
  [n8n-nodes-popnow](https://github.com/popnow-ai/n8n-nodes-popnow) ·
  [popnow-go](https://github.com/popnow-ai/popnow-go) ·
  [popnow-php](https://github.com/popnow-ai/popnow-php)

## License

[MIT](LICENSE) © PopNow
