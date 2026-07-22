import type { TradevilleResponse, JsonValue } from "./types.js";

/**
 * Tradeville responses carry tabular data nested under a `data` property, as a
 * columnar object: each key is a column name, each value a parallel array of
 * equal length. Transpose that into an array of row objects, which is far
 * easier for an LLM to consume.
 *
 * Non-tabular responses (e.g. an ack like `{ OK: 1 }`, with no `data`) are
 * returned as-is, stripped of the `cmd`/`prm` envelope.
 */
export function columnarToRows(
  raw: TradevilleResponse
): JsonValue[] | Record<string, JsonValue | undefined> {
  const { cmd, prm, data, ...rest } = raw;
  void cmd;
  void prm;

  const table = transposeIfColumnar(data);
  if (table !== undefined) return table;

  // Fall back to treating the whole envelope (minus cmd/prm) as columnar,
  // in case a command ever returns the table at the top level instead.
  const table2 = transposeIfColumnar(rest as JsonValue);
  if (table2 !== undefined) return table2;

  return data !== undefined ? (data as Record<string, JsonValue>) : rest;
}

function transposeIfColumnar(value: JsonValue | undefined): JsonValue[] | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;

  const obj = value;
  const keys = Object.keys(obj);
  if (keys.length === 0) return undefined;

  const values = keys.map((k) => obj[k]);
  const allArrays = values.every((v) => Array.isArray(v));
  if (!allArrays) return undefined;

  const length = (values[0] as JsonValue[]).length;
  const sameLength = values.every((v) => (v as JsonValue[]).length === length);
  if (!sameLength) return undefined;

  const rows: Record<string, JsonValue>[] = [];
  for (let i = 0; i < length; i++) {
    const row: Record<string, JsonValue> = {};
    for (const k of keys) row[k] = (obj[k] as JsonValue[])[i];
    rows.push(row);
  }
  return rows;
}
