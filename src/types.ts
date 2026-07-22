export interface TradevilleConfig {
  user: string;
  pass: string;
  demo: boolean;
}

/** A scalar value accepted by/returned in Tradeville API command params. */
export type TradeParamValue = string | number | boolean | null;

/** Params sent alongside a Tradeville command. */
export type TradeParams = Record<string, TradeParamValue>;

/** Any value that can appear in a JSON-encoded Tradeville API response. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * Raw Tradeville API response shape: cmd/prm echoed back, plus either
 * `data` (columnar table: column name -> parallel array) or an `err` string.
 */
export interface TradevilleResponse {
  cmd?: string;
  prm?: TradeParams;
  OK?: number;
  err?: string;
  data?: JsonValue;
  [key: string]: JsonValue | undefined;
}

/** A columnar table: { ColumnName: [v0, v1, ...], ... }, all arrays same length. */
export type ColumnarData = Record<string, JsonValue[]>;
