#!/usr/bin/env node
// Type-checks the project, then bundles+minifies it into a single self-contained
// dist/index.js with esbuild (bundling pulls in dependencies too, so tree shaking
// can actually drop the unused parts of them).
import { build } from "esbuild";
import { chmodSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

execFileSync("tsc", ["--noEmit"], { stdio: "inherit" });

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  minify: true,
  treeShaking: true,
  platform: "node",
  target: "node18",
  format: "esm",
  sourcemap: false,
  legalComments: "none",
  // ws requires these optional native accelerators at runtime inside a try/catch;
  // bundling them would make esbuild fail to resolve packages that aren't installed.
  external: ["bufferutil", "utf-8-validate"],
  // Bundled CJS deps call require() for Node builtins; ESM output has no global
  // require, so esbuild's runtime shim throws unless one is defined up front.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});

chmodSync("dist/index.js", 0o755);
