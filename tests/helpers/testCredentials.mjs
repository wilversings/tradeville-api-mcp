// Throwaway fixture credentials, checked in deliberately: the tests only ever
// present them to a local mock. Storing them in the OS secret store is what
// exercises the per-platform backend in src/credentials.ts.

/** Not the production namespace, so tests cannot overwrite real credentials. */
export const TEST_SERVICE = "tradeville-api-mcp-test";

/** Never written to, for the missing-credentials path. */
export const UNCONFIGURED_SERVICE = "tradeville-api-mcp-test-absent";

export const TEST_USER = "ci-test-user";
export const TEST_PASS = "ci-test-pass";
