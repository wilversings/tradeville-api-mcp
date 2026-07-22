import { WebSocket } from "ws";
import type { TradevilleConfig, TradevilleResponse, TradeParams } from "./types.js";

const WS_URL = "wss://api.tradeville.ro:443";
const PROTOCOL = "apitv";
const REQUEST_TIMEOUT_MS = 15_000;
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
  private readonly config: TradevilleConfig;
  private ws: WebSocket | null = null;
  private readyPromise: Promise<void> | null = null;
  private queue: PendingRequest[] = [];
  private sendChain: Promise<TradevilleResponse | undefined> = Promise.resolve(undefined);
  private lastSendAt = 0;

  constructor(config?: Partial<TradevilleConfig>) {
    this.config = {
      user: config?.user ?? process.env.TDV_USER ?? "!DemoAPITDV",
      pass: config?.pass ?? process.env.TDV_PASS ?? "DemoAPITDV",
      demo:
        config?.demo ??
        (process.env.TDV_DEMO ? process.env.TDV_DEMO.toLowerCase() === "true" : true),
    };
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
    await this.connect();
    const loginResp = await this.send("login", {
      coduser: this.config.user,
      parola: this.config.pass,
      demo: this.config.demo,
    });
    if (!loginResp.OK) {
      throw new Error(`Tradeville login failed: ${loginResp.err ?? "unknown error"}`);
    }
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(WS_URL, PROTOCOL);
      this.ws = ws;

      const onOpen = () => {
        ws.off("error", onError);
        resolve();
      };
      const onError = (err: Error) => {
        ws.off("open", onOpen);
        reject(err);
      };

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
