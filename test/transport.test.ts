import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { gzipSync } from "node:zlib";

import { createProxyHandler, TARGET_URL_HEADER } from "../src/core.js";
import { createExpressHandler } from "../src/express.js";
import { USER_AGENT } from "../src/version.js";

const KEY = "sk-popnow-test-key";

/** Starts a loopback server and returns its origin; the caller closes it. */
async function listen(
  handler: http.RequestListener,
): Promise<{ origin: string; close: () => void }> {
  const server = http.createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

void test(
  "a compressed upstream reply reaches the client decoded and without a content-encoding label",
  { timeout: 10_000 },
  async () => {
    // The runtime's fetch decodes a compressed body but keeps the `content-encoding` header. Passing
    // that header on labels plain JSON as compressed, and the browser fails to decode it - which is
    // what happened whenever the browser's own accept-encoding list was forwarded and the API answered
    // in one of its encodings.
    const json = JSON.stringify({ code: 200, msg: "success", data: { items: [] } });
    const seen: (string | undefined)[] = [];
    const upstream = await listen((req, res) => {
      seen.push(req.headers["accept-encoding"]);
      res.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip" });
      res.end(gzipSync(json));
    });
    try {
      const handle = createProxyHandler({ apiKey: KEY, allowedOrigins: [upstream.origin] });
      const response = await handle(
        new Request("https://app.example/api/popnow/proxy", {
          headers: {
            [TARGET_URL_HEADER]: `${upstream.origin}/api/v1/models`,
            "accept-encoding": "gzip, deflate, br, zstd",
          },
        }),
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-encoding"), null);
      assert.equal(await response.text(), json);
      // The browser's list is not what reached the API: the runtime negotiated its own.
      assert.notEqual(seen[0], "gzip, deflate, br, zstd");
    } finally {
      upstream.close();
    }
  },
);

void test(
  "timeoutMs bounds the wait for response headers, not a stream that is already flowing",
  { timeout: 10_000 },
  async () => {
    // A total timeout would cut a slow body off midway, after the API had already answered.
    const upstream = await listen((req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      let sent = 0;
      const timer = setInterval(() => {
        res.write(`data: {"n":${sent}}\n\n`);
        sent += 1;
        if (sent === 8) {
          clearInterval(timer);
          res.end("data: [DONE]\n\n");
        }
      }, 50);
      req.on("close", () => clearInterval(timer));
    });
    try {
      const handle = createProxyHandler({
        apiKey: KEY,
        allowedOrigins: [upstream.origin],
        timeoutMs: 150,
      });
      const response = await handle(
        new Request("https://app.example/api/popnow/proxy", {
          method: "POST",
          headers: { [TARGET_URL_HEADER]: `${upstream.origin}/api/v1/jobs/quote` },
          body: "{}",
        }),
      );
      assert.equal(response.status, 200);
      // The stream runs for about 400 ms, well past the 150 ms timeout, and must arrive whole.
      const text = await response.text();
      assert.match(text, /"n":7/);
      assert.match(text, /\[DONE\]/);
    } finally {
      upstream.close();
    }
  },
);

void test(
  "an upstream that sends no headers in time is a 504, an unreachable one a 502",
  { timeout: 10_000 },
  async () => {
    const silent = await listen(() => {
      // Never answers.
    });
    try {
      const handle = createProxyHandler({
        apiKey: KEY,
        allowedOrigins: [silent.origin],
        timeoutMs: 100,
      });
      const response = await handle(
        new Request("https://app.example/api/popnow/proxy", {
          headers: { [TARGET_URL_HEADER]: `${silent.origin}/api/v1/models` },
        }),
      );
      assert.equal(response.status, 504);
    } finally {
      silent.close();
    }

    // A refused connection is not a timeout; reporting it as one sends whoever investigates after a
    // slow upstream that does not exist.
    const unreachable = createProxyHandler({
      apiKey: KEY,
      fetch: () => Promise.reject(new TypeError("fetch failed")),
    });
    const response = await unreachable(
      new Request("https://app.example/api/popnow/proxy", {
        headers: { [TARGET_URL_HEADER]: "https://api.popnow.ai/api/v1/models" },
      }),
    );
    assert.equal(response.status, 502);
    const body = (await response.json()) as { code: number; msg: string };
    assert.equal(body.code, 502);
    assert.doesNotMatch(body.msg, /fetch failed/);
  },
);

void test(
  "the Express adapter streams a chunked body through in order",
  { timeout: 10_000 },
  async () => {
    const upstream = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"n":0}\n\n');
      setTimeout(() => res.end('data: {"n":1}\n\ndata: [DONE]\n\n'), 30);
    });
    const app = await listen(
      createExpressHandler({ apiKey: KEY, allowedOrigins: [upstream.origin] }),
    );
    try {
      const response = await fetch(`${app.origin}/api/popnow/proxy`, {
        method: "POST",
        headers: { [TARGET_URL_HEADER]: `${upstream.origin}/api/v1/jobs/quote` },
        body: "{}",
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "text/event-stream");
      assert.equal(await response.text(), 'data: {"n":0}\n\ndata: {"n":1}\n\ndata: [DONE]\n\n');
    } finally {
      app.close();
      upstream.close();
    }
  },
);

void test(
  "an upstream that breaks off mid-stream does not crash the Express process",
  { timeout: 10_000 },
  async () => {
    // `pipe` attaches no error handler to its source, so a broken upstream body surfaced as an
    // uncaught exception and took the whole server down - every user's requests, not just this one.
    const crashes: unknown[] = [];
    const onUncaught = (error: unknown) => crashes.push(error);
    process.on("uncaughtException", onUncaught);

    const upstream = await listen((req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"n":0}\n\n');
      setTimeout(() => req.socket.destroy(), 30);
    });
    const app = await listen(
      createExpressHandler({ apiKey: KEY, allowedOrigins: [upstream.origin] }),
    );
    try {
      const broken = await fetch(`${app.origin}/api/popnow/proxy`, {
        headers: { [TARGET_URL_HEADER]: `${upstream.origin}/api/v1/models` },
      });
      assert.equal(broken.status, 200);
      // The client sees a truncated response rather than a normal end.
      await assert.rejects(broken.text());

      await sleep(50);
      assert.deepEqual(crashes, []);

      // And the same server still answers the next request.
      const next = await fetch(`${app.origin}/api/popnow/proxy`);
      assert.equal(next.status, 400);
    } finally {
      process.off("uncaughtException", onUncaught);
      app.close();
      upstream.close();
    }
  },
);

void test(
  "the Express adapter forwards the body with the server's key and the proxy's User-Agent",
  { timeout: 10_000 },
  async () => {
    const seen: { auth?: string | undefined; agent?: string | undefined; body?: string } = {};
    const upstream = await listen((req, res) => {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk: string) => (body += chunk));
      req.on("end", () => {
        seen.auth = req.headers.authorization;
        seen.agent = req.headers["user-agent"];
        seen.body = body;
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"code":200,"msg":"success","data":{"taskId":"task_1"},"request_id":"req_1"}');
      });
    });
    const app = await listen(
      createExpressHandler({ apiKey: KEY, allowedOrigins: [upstream.origin] }),
    );
    try {
      const response = await fetch(`${app.origin}/api/popnow/proxy`, {
        method: "POST",
        headers: {
          [TARGET_URL_HEADER]: `${upstream.origin}/api/v1/jobs/createTask`,
          authorization: "Bearer sk-popnow-not-the-server-key",
          "content-type": "application/json",
        },
        body: '{"model":"m","input":{"prompt":"a fox"}}',
      });
      assert.equal(response.status, 200);
      assert.match(await response.text(), /task_1/);
      assert.equal(seen.auth, `Bearer ${KEY}`);
      assert.equal(seen.agent, USER_AGENT);
      assert.equal(seen.body, '{"model":"m","input":{"prompt":"a fox"}}');
    } finally {
      app.close();
      upstream.close();
    }
  },
);
