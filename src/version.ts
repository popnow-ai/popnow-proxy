/** The package version, sent in the User-Agent. A test keeps it equal to package.json. */
export const VERSION = "0.1.0";

/**
 * The User-Agent sent on every forwarded request. The API refuses some generic client agents, and an
 * explicit one also tells the PopNow team which integration a request came through.
 */
export const USER_AGENT = `popnow-proxy/${VERSION} (+https://github.com/popnow-ai/popnow-proxy)`;
