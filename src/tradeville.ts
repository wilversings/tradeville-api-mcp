import { WebSocket } from "ws";
import { resolveCredentials } from "./credentials.js";
import type { TradevilleConfig, TradevilleResponse, TradeParams } from "./types.js";

// Overridable so the integration tests can point at a local mock.
const WS_URL = process.env.TRADEVILLE_WS_URL?.trim() || "wss://api.tradeville.ro:443";
const PROTOCOL = "apitv";
const REQUEST_TIMEOUT_MS = 15_000;
const CONNECT_TIMEOUT_MS = 15_000;
// Docs specify a limit of ~20 commands / 10s; keep well under that.
const MIN_SPACING_MS = 150;

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
 * time, with minimum spacing) to stay within the documented rate limit.
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

    const wait = MIN_SPACING_MS - (Date.now() - this.lastSendAt);
    if (wait > 0) {
      await sleep(wait);
    }

    return new Promise<TradevilleResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.queue.findIndex((p) => p.resolve === resolve);
        if (idx !== -1) this.queue.splice(idx, 1);
        reject(new Error(`Tradeville request "${cmd}" timed out`));
      }, REQUEST_TIMEOUT_MS);

      this.queue.push({ resolve, reject, timer });
      this.lastSendAt = Date.now();
      this.ws!.send(JSON.stringify({ cmd, prm }));
    });
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
