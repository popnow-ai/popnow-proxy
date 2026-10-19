import assert from "node:assert/strict";
import test from "node:test";

import {
  createProxyHandler,
  decide,
  DEFAULT_ROUTES,
  matchesRoute,
  TARGET_URL_HEADER,
} from "../src/core.js";
import * as nextjs from "../src/nextjs.js";
import { USER_AGENT } from "../src/version.js";

const KEY = "sk-popnow-test-key";
const API = "https://api.popnow.ai";
const TARGET = `${API}/api/v1/models`;

function incoming(headers: Record<string, string>, method = "GET"): Request {
  return new Request("https://app.example/api/popnow/proxy", { method, headers });
}

void test("forwards with the server's key and always drops a client-supplied Authorization", () => {
  // Without dropping it the proxy becomes an open relay forwarding on behalf of any key: anyone can
  // use it as a jump host, and the bill lands on whoever deployed the proxy.
  const decision = decide(
    incoming({
      [TARGET_URL_HEADER]: TARGET,
      authorization: "Bearer sk-popnow-someone-elses-key",
      "x-api-key": "another-attempt",
      "x-goog-api-key": "a-third-attempt",
      cookie: "session=abc",
    }),
    { apiKey: KEY },
  );
  assert.equal(decision.ok, true);
  if (!decision.ok) return;
  assert.equal(decision.request.headers.get("authorization"), `Bearer ${KEY}`);
  assert.equal(decision.request.headers.get("x-api-key"), null);
  assert.equal(decision.request.headers.get("x-goog-api-key"), null);
  assert.equal(decision.request.headers.get("cookie"), null);
});

void test("reads the key from POPNOW_API_KEY when no apiKey option is given", () => {
  const previous = process.env.POPNOW_API_KEY;
  process.env.POPNOW_API_KEY = "  sk-popnow-from-env  ";
  try {
    const decision = decide(incoming({ [TARGET_URL_HEADER]: TARGET }));
    assert.equal(decision.ok, true);
    if (!decision.ok) return;
    assert.equal(decision.request.headers.get("authorization"), "Bearer sk-popnow-from-env");
  } finally {
    if (previous === undefined) delete process.env.POPNOW_API_KEY;
    else process.env.POPNOW_API_KEY = previous;
  }
});

void test("sends the proxy's own User-Agent instead of the client's", () => {
  // The API refuses some generic client agents; an explicit one is always sent.
  const decision = decide(
    incoming({ [TARGET_URL_HEADER]: TARGET, "user-agent": "Python-urllib/3.12" }),
    { apiKey: KEY },
  );
  assert.equal(decision.ok, true);
  if (!decision.ok) return;
  assert.equal(decision.request.headers.get("user-agent"), USER_AGENT);
  assert.match(USER_AGENT, /^popnow-proxy\/\d+\.\d+\.\d+ /);
});

void test("the browser's accept-encoding is not forwarded: the runtime negotiates its own", () => {
  const decision = decide(
    incoming({ [TARGET_URL_HEADER]: TARGET, "accept-encoding": "gzip, deflate, br, zstd" }),
    { apiKey: KEY },
  );
  assert.equal(decision.ok, true);
  if (!decision.ok) return;
  assert.equal(decision.request.headers.get("accept-encoding"), null);
});

void test("the content-encoding of an already decoded upstream body is not passed back", async () => {
  const handle = createProxyHandler({
    apiKey: KEY,
    fetch: () =>
      Promise.resolve(
        new Response('{"code":200}', {
          status: 200,
          headers: { "content-type": "application/json", "content-encoding": "br" },
        }),
      ),
  });
  const response = await handle(incoming({ [TARGET_URL_HEADER]: TARGET }));
  assert.equal(response.headers.get("content-encoding"), null);
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.equal(await response.text(), '{"code":200}');
});

void test("the Next.js entry point exports the method handlers the README re-exports", () => {
  for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"] as const) {
    assert.equal(typeof nextjs[method], "function", `${method} must be exported`);
    assert.equal(nextjs[method], nextjs.route[method]);
  }
});

void test("refuses a target origin that is not allow-listed", () => {
  // The one catastrophic failure in the design: allowing an arbitrary target means your own server
  // sends your key to a host the attacker chose, and the traffic looks entirely normal.
  for (const hostile of [
    "https://attacker.example/collect",
    "http://api.popnow.ai/api/v1/models",
    "https://api.popnow.ai.attacker.example/api/v1/models",
    "https://evil.example/?x=https://api.popnow.ai",
    "https://api.popnow.ai:8443/api/v1/models",
  ]) {
    const decision = decide(incoming({ [TARGET_URL_HEADER]: hostile }), { apiKey: KEY });
    assert.equal(decision.ok, false, `must refuse ${hostile}`);
    if (decision.ok) return;
    assert.equal(decision.status, 403);
  }
});

void test("forwards every documented route with its documented method", () => {
  const examples: Array<[string, string]> = [
    ["POST", "/api/v1/jobs/quote"],
    ["POST", "/api/v1/jobs/createTask"],
    ["GET", "/api/v1/jobs/recordInfo?taskId=task_123"],
    ["POST", "/api/v1/jobs/retry"],
    ["POST", "/api/v1/jobs/purge"],
    ["GET", "/api/v1/jobs?limit=20"],
    ["GET", "/api/v1/models"],
    ["GET", "/api/v1/models/kling/3.0/text-to-video"],
    ["GET", "/api/v1/models/kling%2F3.0%2Ftext-to-video"],
    ["GET", "/api/v1/usage"],
    ["GET", "/api/v1/chat/credit"],
    ["POST", "/api/v1/common/upload-url"],
    ["POST", "/api/v1/files/fil_abc/commit"],
    ["POST", "/api/v1/files/import"],
    ["POST", "/api/v1/common/download-url"],
    ["GET", "/api/v1/assets"],
    ["POST", "/api/v1/assets"],
    ["GET", "/api/v1/assets/usage"],
    ["GET", "/api/v1/assets/ast_1"],
    ["PATCH", "/api/v1/assets/ast_1"],
    ["DELETE", "/api/v1/assets/ast_1"],
    ["GET", "/api/v1/assets/entities"],
    ["GET", "/api/v1/assets/entities/ent_1"],
    ["GET", "/v1/models"],
    ["POST", "/v1/videos"],
    ["GET", "/v1/videos/vid_1"],
    ["GET", "/v1/videos/vid_1/content"],
  ];
  for (const [method, path] of examples) {
    const decision = decide(incoming({ [TARGET_URL_HEADER]: `${API}${path}` }, method), {
      apiKey: KEY,
    });
    assert.equal(decision.ok, true, `must forward ${method} ${path}`);
  }
  // Every default route is covered by an example above.
  assert.equal(DEFAULT_ROUTES.length, examples.length - 1);
});

void test("refuses routes the public API contract does not document", () => {
  const refused: Array<[string, string]> = [
    ["POST", "/v1/chat/completions"],
    ["POST", "/v1/responses"],
    ["POST", "/v1/messages"],
    ["POST", "/v1beta/models/some-model:generateContent"],
    ["GET", "/api/v1/jobs/stream"],
    ["GET", "/api/v1/jobs/createTask"],
    ["DELETE", "/api/v1/jobs"],
    ["POST", "/api/v1/files//commit"],
    ["GET", "/api/v1/../admin"],
    ["GET", "/admin"],
    ["GET", "/"],
  ];
  for (const [method, path] of refused) {
    const decision = decide(incoming({ [TARGET_URL_HEADER]: `${API}${path}` }, method), {
      apiKey: KEY,
    });
    assert.equal(decision.ok, false, `must refuse ${method} ${path}`);
    if (decision.ok) return;
    assert.equal(decision.status, 403);
    assert.match(decision.message, /route is not allowed/);
  }
});

void test("allowedRoutes narrows what is forwarded, and an empty list throws", () => {
  const options = {
    apiKey: KEY,
    allowedRoutes: [{ method: "POST", path: "/api/v1/jobs/createTask" }] as const,
  };
  assert.equal(
    decide(incoming({ [TARGET_URL_HEADER]: `${API}/api/v1/jobs/createTask` }, "POST"), options).ok,
    true,
  );
  assert.equal(decide(incoming({ [TARGET_URL_HEADER]: TARGET }), options).ok, false);
  assert.throws(
    () => decide(incoming({ [TARGET_URL_HEADER]: TARGET }), { apiKey: KEY, allowedRoutes: [] }),
    /must not be empty/,
  );
});

void test("route patterns match whole segments", () => {
  assert.equal(matchesRoute("/api/v1/files/{fileId}/commit", "/api/v1/files/fil_1/commit"), true);
  assert.equal(matchesRoute("/api/v1/files/{fileId}/commit", "/api/v1/files/a/b/commit"), false);
  assert.equal(matchesRoute("/api/v1/models", "/api/v1/models/"), true);
  assert.equal(matchesRoute("/api/v1/models", "/api/v1/modelsx"), false);
  assert.equal(matchesRoute("/api/v1/models/{model+}", "/api/v1/models/a/b/c"), true);
  assert.equal(matchesRoute("/api/v1/models/{model+}", "/api/v1/models/a//c"), false);
  assert.equal(matchesRoute("/api/v1/models/{model+}", "/api/v1/models"), false);
});

void test("a missing target header is a 400, a missing key is a 500", () => {
  // The first is the caller's mistake, the second the deployer's; keeping them apart sends whoever
  // investigates to the right place.
  const missingTarget = decide(incoming({}), { apiKey: KEY });
  assert.equal(missingTarget.ok, false);
  if (!missingTarget.ok) assert.equal(missingTarget.status, 400);

  const previous = process.env.POPNOW_API_KEY;
  delete process.env.POPNOW_API_KEY;
  try {
    const missingKey = decide(incoming({ [TARGET_URL_HEADER]: TARGET }), {
      apiKey: () => undefined,
    });
    assert.equal(missingKey.ok, false);
    if (!missingKey.ok) assert.equal(missingKey.status, 500);
  } finally {
    if (previous !== undefined) process.env.POPNOW_API_KEY = previous;
  }
});

void test("hop-by-hop headers are not forwarded, nor is the target header itself", () => {
  const decision = decide(
    incoming({
      [TARGET_URL_HEADER]: TARGET,
      connection: "keep-alive",
      "transfer-encoding": "chunked",
      host: "app.example",
      "content-type": "application/json",
      "x-popnow-retention": "3600",
    }),
    { apiKey: KEY },
  );
  assert.equal(decision.ok, true);
  if (!decision.ok) return;
  for (const dropped of ["connection", "transfer-encoding", TARGET_URL_HEADER]) {
    assert.equal(decision.request.headers.get(dropped), null, `${dropped} must not be forwarded`);
  }
  // Business headers stay - stripping too much breaks content negotiation and retention control.
  assert.equal(decision.request.headers.get("content-type"), "application/json");
  assert.equal(decision.request.headers.get("x-popnow-retention"), "3600");
  assert.equal(new URL(decision.request.url).host, "api.popnow.ai");
});

void test("the idempotency key is forwarded verbatim: it is the caller's lock against paying twice", () => {
  const decision = decide(
    incoming(
      { [TARGET_URL_HEADER]: `${API}/api/v1/jobs/createTask`, "idempotency-key": "abc-123" },
      "POST",
    ),
    { apiKey: KEY },
  );
  assert.equal(decision.ok, true);
  if (!decision.ok) return;
  assert.equal(decision.request.headers.get("idempotency-key"), "abc-123");
});

void test("passes the upstream response straight back, and refuses in the API's envelope shape", async () => {
  const handle = createProxyHandler({
    apiKey: KEY,
    fetch: () =>
      Promise.resolve(
        new Response(JSON.stringify({ code: 200, msg: "success", data: { items: [] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
  });

  const ok = await handle(incoming({ [TARGET_URL_HEADER]: TARGET }));
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as { code: number }).code, 200);

  const refused = await handle(incoming({ [TARGET_URL_HEADER]: "https://attacker.example" }));
  assert.equal(refused.status, 403);
  const body = (await refused.json()) as { code: number; msg: string; request_id: null };
  assert.equal(body.code, 403);
  assert.match(body.msg, /not allowed/);
  assert.equal(body.request_id, null);
});

void test("a redirect is passed back to the client rather than followed", async () => {
  // GET /v1/videos/{id}/content answers 302 to a signed storage URL; the browser should fetch the
  // file directly, without the key.
  let seenRedirect: RequestRedirect | undefined;
  const handle = createProxyHandler({
    apiKey: KEY,
    fetch: (input) => {
      seenRedirect = (input as Request).redirect;
      return Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: "https://storage.example/video.mp4?sig=1", "cache-control": "no-store" },
        }),
      );
    },
  });
  const response = await handle(incoming({ [TARGET_URL_HEADER]: `${API}/v1/videos/vid_1/content` }));
  assert.equal(seenRedirect, "manual");
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://storage.example/video.mp4?sig=1");
});

void test("an empty allowedOrigins array throws rather than meaning allow-everything", () => {
  assert.throws(
    () => decide(incoming({ [TARGET_URL_HEADER]: TARGET }), { apiKey: KEY, allowedOrigins: [] }),
    /must not be empty/,
  );
});
