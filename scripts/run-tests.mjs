#!/usr/bin/env node
// Enumerates the test files and hands them to node --test as explicit paths.
// `--test <dir>` is not supported and a glob pattern leaves discovery up to
// shell and platform path handling; this behaves identically everywhere.

import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const testsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tests");

const files = readdirSync(testsDir, { recursive: true })
  .filter((entry) => entry.endsWith(".test.mjs"))
  .map((entry) => path.join(testsDir, entry))
  .sort();

if (files.length === 0) {
  console.error(`No *.test.mjs files under ${testsDir}`);
  process.exit(1);
}

const { status, error } = spawnSync(
  process.execPath,
  ["--test", "--test-reporter=spec", ...files],
  { stdio: "inherit" }
);

if (error) {
  console.error(error.message);
  process.exit(1);
}
process.exit(status ?? 1);
