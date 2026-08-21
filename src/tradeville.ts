import { WebSocket } from "ws";
import { resolveCredentials } from "./credentials.js";
import type { TradevilleConfig, TradevilleResponse, TradeParams } from "./types.js";

// Overridable so the integration tests can point at a local mock.
const WS_URL = process.env.TRADEVILLE_WS_URL?.trim() || "wss://api.tradeville.ro:443";
const PROTOCOL = "apitv";
const REQUEST_TIMEOUT_MS = 15_000;
const CONNECT_TIMEOUT_MS = 15_000;
/**
 * The server enforces "maxim 20 comenzi in 10 secunde" and returns it as a
 * regular `err` response, which fails the request rather than delaying it.
 *
 * Modelled as a sliding window rather than a fixed gap so that a short burst
 * still goes out at full speed and only a sustained run slows down. This is
 * the only place in the system that meters traffic: a client sweeping the
 * whole listing quotes one symbol at a time and relies on it entirely.
 *
 * A fixed 150ms gap, which is what this was, is 67 requests per 10 seconds:
 * over three times the limit. It survived only because round-trip latency
 * padded it out, and stopped surviving the moment something started issuing
 * one request per listed symbol.
 */
const RATE_WINDOW_MS = 10_000;
const RATE_WINDOW_LIMIT = 18;
/** Small floor between requests even inside the window's allowance. */
const MIN_SPACING_MS = 60;

interface PendingRequest {
  resolve: (value: TradevilleResponse) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * WebSocket client for the Tradeville API (https://api.tradeville.ro/).
 * Handles connect+login, and serializes all requests (one in-flight at a
 * time) behind a sliding-window rate limiter that keeps the connection
 * inside the server's 20-commands-per-10-seconds budget.
 */
export class TradevilleClient {
  private config: TradevilleConfig | null = null;
  private credentialsError: string | null = null;
  private credentialsResolved = false;
  private ws: WebSocket | null = null;
  private readyPromise: Promise<void> | null = null;
  private queue: PendingRequest[] = [];
  private sendChain: Promise<TradevilleResponse | undefined> = Promise.resolve(undefined);
  private lastSendAt = 0;
  /** Send timestamps inside the current rate window, oldest first. */
  private sendTimes: number[] = [];

  constructor(config?: TradevilleConfig) {
    if (config) {
      this.config = config;
      this.credentialsResolved = true;
    }
  }

  /**
   * Deferred to the first request: reading the secret store costs two
   * synchronous PowerShell launches on Windows, which would otherwise delay
   * every server start — and the MCP handshake with it — by seconds.
   */
  private resolveConfig(): TradevilleConfig {
    if (!this.credentialsResolved) {
      this.credentialsResolved = true;
      try {
        this.config = resolveCredentials();
      } catch (err) {
        this.credentialsError = err instanceof Error ? err.message : String(err);
      }
    }
    if (!this.config) {
      throw new Error(this.credentialsError ?? "Tradeville credentials could not be resolved");
    }
    return this.config;
  }

  /** Send a command, connecting and logging in first if needed. */
  async request(cmd: string, prm: TradeParams = {}): Promise<TradevilleResponse> {
    await this.ensureReady();
    return this.send(cmd, prm);
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
    this.readyPromise = null;
    this.rejectAllPending(new Error("Tradeville connection closed"));
  }

  private ensureReady(): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = this.connectAndLogin().catch((err) => {
        this.readyPromise = null;
        throw err;
      });
    }
    return this.readyPromise;
  }

  private async connectAndLogin(): Promise<void> {
    const config = this.resolveConfig();
    await this.connect();
    const loginResp = await this.send("login", {
      coduser: config.user,
      parola: config.pass,
      demo: config.demo,
    });
    if (!loginResp.OK) {
      throw new Error(`Tradeville login failed: ${loginResp.err ?? "unknown error"}`);
    }
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(WS_URL, PROTOCOL);
      this.ws = ws;

      // A host that drops the SYN rather than refusing it fires neither `open`
      // nor `error`, and the request timeout only covers an established
      // connection — so bound the attempt itself or a tool call hangs forever.
      const cleanup = () => {
        clearTimeout(timer);
        ws.off("open", onOpen);
        ws.off("error", onError);
      };
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const timer = setTimeout(() => {
        cleanup();
        ws.terminate();
        reject(new Error(`Tradeville connection to ${WS_URL} timed out`));
      }, CONNECT_TIMEOUT_MS);

      ws.once("open", onOpen);
      ws.once("error", onError);

      ws.on("message", (data) => this.handleMessage(data.toString()));
      ws.on("close", () => {
        this.ws = null;
        this.readyPromise = null;
        this.rejectAllPending(new Error("Tradeville connection closed"));
      });
      ws.on("error", (err) => {
        this.rejectAllPending(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }

  /** Enqueue a send, serialized after all previously enqueued sends complete. */
  private send(cmd: string, prm: TradeParams): Promise<TradevilleResponse> {
    const task = this.sendChain.then(() => this.doSend(cmd, prm));
    this.sendChain = task.catch(() => undefined);
    return task;
  }

  private async doSend(cmd: string, prm: TradeParams): Promise<TradevilleResponse> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Tradeville connection is not open");
    }

    await this.awaitRateWindow();

    return new Promise<TradevilleResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.queue.findIndex((p) => p.resolve === resolve);
        if (idx !== -1) this.queue.splice(idx, 1);
        reject(new Error(`Tradeville request "${cmd}" timed out`));
      }, REQUEST_TIMEOUT_MS);

      this.queue.push({ resolve, reject, timer });
      this.lastSendAt = Date.now();
      this.sendTimes.push(this.lastSendAt);
      this.ws!.send(JSON.stringify({ cmd, prm }));
    });
  }

  /** Blocks until sending now would stay inside the server's 20-per-10s budget. */
  private async awaitRateWindow(): Promise<void> {
    for (;;) {
      const now = Date.now();
      while (this.sendTimes.length && now - this.sendTimes[0] >= RATE_WINDOW_MS) {
        this.sendTimes.shift();
      }
      const spacingWait = MIN_SPACING_MS - (now - this.lastSendAt);
      if (this.sendTimes.length < RATE_WINDOW_LIMIT) {
        if (spacingWait > 0) await sleep(spacingWait);
        return;
      }
      // Window is full: wait for the oldest send to age out of it.
      await sleep(Math.max(RATE_WINDOW_MS - (now - this.sendTimes[0]) + 10, spacingWait, 10));
    }
  }

  private handleMessage(raw: string): void {
    let parsed: TradevilleResponse;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    const pending = this.queue.shift();
    if (!pending) return;
    clearTimeout(pending.timer);

    if (parsed.err) {
      pending.reject(new Error(String(parsed.err)));
      return;
    }
    pending.resolve(parsed);
  }

  private rejectAllPending(err: Error): void {
    for (const p of this.queue.splice(0)) {
      clearTimeout(p.timer);
      p.reject(err);
    }
  }
}
