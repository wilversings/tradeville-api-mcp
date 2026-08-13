// Fixture credentials for the integration tests, shared between the setup
// script (scripts/setup-test-credentials.mjs) and the tests themselves.
//
// These are throwaway values checked into the repo on purpose: the tests talk
// to a local mock, never to Tradeville, so there is nothing here worth
// protecting. The point of storing them in the OS secret store at all is to
// exercise the real per-platform credential backend in src/credentials.ts.

/**
 * Deliberately NOT the production "tradeville-api-mcp" namespace, so running
 * the tests can never overwrite a developer's real stored credentials.
 */
export const TEST_SERVICE = "tradeville-api-mcp-test";

/** A namespace nothing ever writes to, for the "credentials missing" path. */
export const UNCONFIGURED_SERVICE = "tradeville-api-mcp-test-absent";

export const TEST_USER = "ci-test-user";
export const TEST_PASS = "ci-test-pass";
