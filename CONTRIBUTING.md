# Contributing

Thanks for helping improve the PopNow proxy.

1. Fork the repository and create a branch.
2. `npm install`, then make your change.
3. Run `npm run typecheck && npm test`. Tests use loopback servers and injected `fetch` functions and never
   call the live API.
4. Open a pull request that explains what changed and why, and add a line to `CHANGELOG.md`.

Guidelines:

- Follow the public API contract at [popnow.ai/docs/openapi.yaml](https://popnow.ai/docs/openapi.yaml).
  `DEFAULT_ROUTES` lists exactly the routes documented there; do not add others.
- Security first: a change must never let the key reach an origin or route that is not allow-listed.
- Keep runtime dependencies at zero.
- All text in the repository is English; a test fails on CJK characters.

For questions about the API itself (accounts, billing, models), contact [PopNow support](https://popnow.ai/contact).
