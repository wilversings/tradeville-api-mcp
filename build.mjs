#!/usr/bin/env node
// One output: dist/index.js, the MCP server binary. Bundled and minified into
// a single self-contained file so `npx tradeville-api-mcp` starts without
// installing anything transitive.
//
// This package publishes a server and nothing else — no library entry point,
// no exports map. Everything in src/ exists to serve a tool, and every tool
// forwards one API command or reads one local file. Analysis built on top of
// those tools belongs to whatever is calling them, not to this package — see
// wilversings/bond-ladder-web for an example client.
import { build } from "esbuild";
import { chmodSync, cpSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

// Run tsc's JS entrypoint directly: the .bin shim is tsc.cmd on Windows, which
// execFileSync refuses to spawn without a shell.
const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
execFileSync(process.execPath, [tsc, "--noEmit"], { stdio: "inherit" });

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

// Read at runtime (not bundled) since it's data, not code — see src/stockscreen.ts.
cpSync("staticdata", "dist/staticdata", { recursive: true });
