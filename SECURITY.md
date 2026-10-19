# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems.

- Open a [private security advisory](https://github.com/popnow-ai/popnow-proxy/security/advisories/new) on GitHub, or
- email **support@popnow.ai** with "Security" in the subject.

Include a description, steps to reproduce and the package version. We aim to acknowledge reports within a few
business days. Never include API keys, signed URLs, private media or customer data in a report.

## Keeping your API key safe

- Set `POPNOW_API_KEY` as a server-side secret only. Never expose it to client code (for example through a
  `NEXT_PUBLIC_` variable).
- The proxy does not authenticate your users. Put a session check, rate limit and per-user quota in front of
  the route, and narrow `allowedRoutes` to what your app calls.
- Keep `allowedOrigins` at its default in production.
- If a key leaks, revoke it in the [API console](https://popnow.ai/api/console/keys) and create a new one.
