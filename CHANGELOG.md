# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- Docs: PopNow credits are worth $0.001 each since 2026-10-19 (they were $0.01), so prices in credits are
  larger numbers than before. No code change.

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
