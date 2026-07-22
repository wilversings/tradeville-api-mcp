export interface TradevilleConfig {
  user: string;
  pass: string;
  demo: boolean;
}

/**
 * Raw Tradeville API response shape: cmd/prm echoed back, plus either
 * `data` (columnar table: column name -> parallel array) or an `err` string.
 */
export interface TradevilleResponse {
  cmd?: string;
  prm?: Record<string, unknown>;
  OK?: number;
  err?: string;
  data?: unknown;
  [key: string]: unknown;
}

/** A columnar table: { ColumnName: [v0, v1, ...], ... }, all arrays same length. */
export type ColumnarData = Record<string, unknown[]>;
