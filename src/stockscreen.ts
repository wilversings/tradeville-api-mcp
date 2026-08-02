import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { JsonValue } from "./types.js";

// Copied alongside dist/index.js by the build (see build.mjs), so this path
// resolves the same way whether running from src (via tsx) or dist.
const CSV_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "staticdata", "stockscreen.csv");

let cachedRows: Record<string, JsonValue>[] | null = null;

/** Excel-style numeric-string coercion: empty -> null, numeric -> number, else left as string. */
function coerce(value: string): JsonValue {
  if (value === "") return null;
  const n = Number(value);
  return Number.isNaN(n) ? value : n;
}

/**
 * Parses the tab-separated BVB stock screener snapshot — a CSV export from the
 * stock screener on the Tradeville web portal (portal.tradeville.ro), not the
 * api.tradeville.ro WebSocket API the rest of this server talks to. The file
 * starts with an Excel "SEP=" hint line (Excel's own CSV export format),
 * followed by a tab-separated header row and data rows (CRLF line endings).
 */
function loadStockScreen(): Record<string, JsonValue>[] {
  if (cachedRows) return cachedRows;

  const text = readFileSync(CSV_PATH, "utf8");
  const lines = text.split(/\r\n|\n/).filter((line) => line.length > 0);
  const [, headerLine, ...dataLines] = lines;
  const headers = headerLine.split("\t");

  cachedRows = dataLines.map((line) => {
    const cells = line.split("\t");
    const row: Record<string, JsonValue> = {};
    headers.forEach((header, i) => {
      row[header] = coerce(cells[i] ?? "");
    });
    return row;
  });
  return cachedRows;
}

export function getStockScreen(symbols?: string[]): Record<string, JsonValue>[] {
  const rows = loadStockScreen();
  if (!symbols || symbols.length === 0) return rows;

  const wanted = new Set(symbols);
  return rows.filter((row) => typeof row.Simbol === "string" && wanted.has(row.Simbol));
}
