# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-11-01

### Changed

- The PopNow API bills in USD from its own API balance, separate from website credits. The README and
  `llms.txt` now describe the USD quote flow (`maxChargeUsd`, confirmed with `quoteId` and `expectedCostUsd`),
  API billing and API pricing links, and mark the credit fields as deprecated. The proxy forwards request and
  response bodies unchanged, so no code change is needed for the USD fields.
- Links point to the developer MCP server (`popnow.ai/api/mcp`, `popnow-ai/popnow-api-mcp`) and developer
  skills (`popnow.ai/api/skills`).
- The User-Agent now reports `popnow-proxy/0.2.0`.

## [0.1.0] - 2026-10-19

### Added

- First release of `@popnow/proxy`, a server-side proxy for the PopNow API.
- Adapters for the Next.js App Router (`@popnow/proxy/nextjs`), Express (`@popnow/proxy/express`) and any
  fetch runtime (`createProxyHandler`).
- Exact-origin allow-list (`https://api.popnow.ai` by default) and a method-and-path allow-list covering the
  documented public API routes (`DEFAULT_ROUTES`, `allowedRoutes`).
- The server's `POPNOW_API_KEY` replaces any client-supplied credential; an explicit
  `popnow-proxy/<version>` User-Agent is sent on every request.
- Streaming pass-through of request and response bodies, redirects passed back unfollowed, and refusals in the
  API's `{code, msg, request_id}` envelope.
