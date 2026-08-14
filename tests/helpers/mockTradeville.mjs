// Local stand-in for the Tradeville WebSocket API:
//
//   client -> {"cmd":"Portfolio","prm":{"data":null}}
//   server -> {"cmd":"Portfolio","prm":{...},"data":{"Symbol":[...],...}}
//
// Responses go out in arrival order, matching the real API's positional (not
// id-based) correlation.

import { WebSocketServer } from "ws";

export const PROTOCOL = "apitv";

/** Columnar fixtures per command, using the columns each tool description promises. */
export const FIXTURES = {
  Portfolio: {
    Account: ["DEMO1", "DEMO1", "DEMO1"],
    Symbol: ["TLV", "SNP", "RON"],
    Quantity: [1200, 5000, 15234.55],
    AvgPrice: [24.5, 0.52, 1],
    MarketPrice: [26.1, 0.55, 1],
    PType: ["A", "A", "B"],
    Ccy: ["RON", "RON", "RON"],
  },
  SearchSymbol: {
    Symbol: ["BRD", "BRDL"],
    Name: ["BRD - Groupe Societe Generale", "BRD Leasing"],
    ISIN: ["ROBRDBACNOR2", "ROBRDLACNOR8"],
  },
  Symbol: {
    Symbol: ["BRD"],
    Name: ["BRD - Groupe Societe Generale"],
    Price: [19.86],
    Bid: [19.8],
    Ask: [19.9],
    Low: [19.72],
    High: [19.98],
    Market: ["REGS"],
    Ccy: ["RON"],
  },
  Level2: {
    Side: ["B", "B", "S", "S"],
    Level: [1, 2, 1, 2],
    Price: [19.8, 19.78, 19.9, 19.94],
    Quantity: [500, 1200, 340, 900],
    Orders: [2, 5, 1, 3],
  },
  DailyValues: {
    Symbol: ["BRD", "BRD", "BRD"],
    Date: ["2024-01-03", "2024-01-04", "2024-01-05"],
    Open: [19.5, 19.62, 19.7],
    Low: [19.42, 19.55, 19.61],
    High: [19.7, 19.8, 19.95],
    Close: [19.62, 19.7, 19.86],
    Volume: [120000, 98000, 143500],
    Value: [2354400, 1930600, 2849910],
    Trades: [310, 265, 402],
  },
  Trades: {
    Symbol: ["BRD", "BRD"],
    Date: ["2024-01-05T10:02:11", "2024-01-05T10:02:47"],
    Price: [19.84, 19.86],
    Volume: [200, 150],
    Trades: [1, 1],
    Agres: ["B", "S"],
    BidQ: [500, 480],
    Bid: [19.82, 19.84],
    Ask: [19.86, 19.88],
    AskQ: [300, 260],
  },
  Activity: {
    Date: ["2024-01-03", "2024-01-05"],
    OpType: ["Buy", "In"],
    Symbol: ["BRD", null],
    Quantity: [200, null],
    Price: [19.5, null],
    Comission: [3.9, 0],
    Ammount: [-3903.9, 10000],
    CashPos: [6096.1, 16096.1],
    InstrPos: [200, 200],
    Profit: [0, 0],
    TranzNo: [881234, 881250],
    Ccy: ["RON", "RON"],
    Obs: ["", "Transfer"],
    AvgPrice: [19.5, null],
    OrderId: [55123, null],
  },
  Orders: {
    OrderId: [55123, 55124],
    Symbol: ["BRD", "BRD"],
    Status: ["Executed", "Canceled"],
    TrdStatus: ["Filled", "Canceled"],
    Date: ["2024-01-03", "2024-01-04"],
    OpType: ["Buy", "Sell"],
    ActiveQty: [0, 0],
    Quantity: [200, 100],
    Price: [19.5, 20.5],
    NetPrice: [19.52, 20.48],
    NewPrice: [null, null],
  },
  FXBNR: {
    Ccy: ["EUR", "EUR", "EUR"],
    Date: ["2024-01-03", "2024-01-04", "2024-01-05"],
    Rate: [4.9709, 4.9722, 4.9735],
  },
};

/**
 * Starts the mock on an ephemeral loopback port.
 *
 * @param {object} [options]
 * @param {string} [options.user] Credential the mock's `login` accepts.
 * @param {string} [options.pass] Credential the mock's `login` accepts.
 * @param {number} [options.responseDelayMs] Artificial latency per response.
 */
export async function startMockTradeville(options = {}) {
  const { user, pass, responseDelayMs = 0 } = options;

  /** Every {cmd, prm} received, in arrival order, across connections. */
  const requests = [];
  const overrides = new Map();
  const sockets = new Set();
  let connectionCount = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  let rejectedProtocol = false;

  const wss = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
    handleProtocols: (protocols) => {
      if (protocols.has(PROTOCOL)) return PROTOCOL;
      rejectedProtocol = true;
      return false;
    },
  });

  await new Promise((resolve, reject) => {
    wss.once("listening", resolve);
    wss.once("error", reject);
  });

  wss.on("connection", (socket) => {
    connectionCount += 1;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => sockets.delete(socket));

    socket.on("message", async (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      requests.push(message);

      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        const response = await buildResponse(message);
        if (responseDelayMs > 0) await sleep(responseDelayMs);
        if (response !== undefined && socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify(response));
        }
      } finally {
        inFlight -= 1;
      }
    });
  });

  async function buildResponse({ cmd, prm }) {
    const override = overrides.get(cmd);
    if (override !== undefined) {
      const value = typeof override === "function" ? await override(prm) : override;
      return value === null ? undefined : value; // null means stay silent
    }

    if (cmd === "login") {
      const okUser = user === undefined || prm?.coduser === user;
      const okPass = pass === undefined || prm?.parola === pass;
      return okUser && okPass
        ? { cmd: "login", OK: 1 }
        : { cmd: "login", err: "user sau parola gresite" };
    }

    const fixture = FIXTURES[cmd];
    if (!fixture) return { cmd, prm, err: `comanda necunoscuta: ${cmd}` };
    return { cmd, prm, data: echoSymbol(fixture, prm) };
  }

  /** Echoes the requested symbol back so tests can tell responses apart. */
  function echoSymbol(fixture, prm) {
    const symbol = prm?.symbol;
    if (typeof symbol !== "string" || !Array.isArray(fixture.Symbol)) return fixture;
    return { ...fixture, Symbol: fixture.Symbol.map(() => symbol) };
  }

  const { port } = wss.address();

  return {
    url: `ws://127.0.0.1:${port}`,
    requests,
    get commands() {
      return requests.map((r) => r.cmd);
    },
    requestsFor(cmd) {
      return requests.filter((r) => r.cmd === cmd);
    },
    onlyRequestFor(cmd) {
      const matches = this.requestsFor(cmd);
      if (matches.length !== 1) {
        throw new Error(`expected exactly 1 ${cmd} request, saw ${matches.length}`);
      }
      return matches[0];
    },
    /** Response override: a fixed value, or a function of `prm`. */
    setResponse(cmd, response) {
      overrides.set(cmd, response);
    },
    get connectionCount() {
      return connectionCount;
    },
    /** High-water mark of concurrently-processing requests. */
    get maxInFlight() {
      return maxInFlight;
    },
    /** True if a client ever offered a subprotocol other than "apitv". */
    get rejectedProtocol() {
      return rejectedProtocol;
    },
    dropConnections() {
      for (const socket of sockets) socket.terminate();
      sockets.clear();
    },
    async close() {
      for (const socket of sockets) socket.terminate();
      sockets.clear();
      await new Promise((resolve) => wss.close(resolve));
    },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
