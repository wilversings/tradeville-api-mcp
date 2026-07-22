#!/usr/bin/env node
// Validates Tradeville API credentials by connecting, logging in, and exiting.
// Usage: TDV_USER=... TDV_PASS=... TDV_DEMO=true node scripts/check-credentials.mjs

import { WebSocket } from "ws";

const WS_URL = "wss://api.tradeville.ro:443";
const PROTOCOL = "apitv";

const user = process.env.TDV_USER ?? "!DemoAPITDV";
const pass = process.env.TDV_PASS ?? "DemoAPITDV";
const demo = process.env.TDV_DEMO ? process.env.TDV_DEMO.toLowerCase() === "true" : true;

const ws = new WebSocket(WS_URL, PROTOCOL);

const timer = setTimeout(() => {
  console.error("Timed out waiting for login response");
  ws.close();
  process.exit(1);
}, 15_000);

ws.once("open", () => {
  ws.send(JSON.stringify({ cmd: "login", prm: { coduser: user, parola: pass, demo } }));
});

ws.once("message", (data) => {
  clearTimeout(timer);
  const resp = JSON.parse(data.toString());
  ws.close();
  if (resp.OK) {
    console.log("Credentials OK:", resp);
    process.exit(0);
  } else {
    console.error("Login failed:", resp.err ?? resp);
    process.exit(1);
  }
});

ws.once("error", (err) => {
  clearTimeout(timer);
  console.error("Connection error:", err.message);
  process.exit(1);
});
