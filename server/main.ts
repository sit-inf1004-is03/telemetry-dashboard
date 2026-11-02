/**
 * One process, two doors into the same MQTT broker:
 *
 *   tcp://<this machine>:1883          MQTT, for the cars
 *   http://<this machine>:8080/        the dashboard (static files)
 *   ws://<this machine>:8080/mqtt      MQTT over WebSocket, for the dashboard
 *
 * The dashboard is itself an MQTT client: the browser subscribes and
 * publishes through the WebSocket door. This server holds no state of its
 * own beyond what the broker keeps (retained messages).
 *
 *   node server/main.ts         serve the built dashboard (npm run build first)
 *   node server/main.ts --dev   serve the dashboard from source, reloading on edit
 *
 * Ports can be changed with the MQTT_PORT and HTTP_PORT environment variables.
 */
import net from "node:net";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import express from "express";
import { WebSocketServer, createWebSocketStream } from "ws";
import { createBroker } from "./broker.ts";

const MQTT_PORT = Number(process.env.MQTT_PORT ?? 1883);
const HTTP_PORT = Number(process.env.HTTP_PORT ?? 8080);
const DEV = process.argv.includes("--dev");

const broker = await createBroker();

// MQTT over TCP, for the cars
const mqttServer = net.createServer(broker.handle);
mqttServer.listen(MQTT_PORT, "0.0.0.0");

// HTTP, for the dashboard
const app = express();
const httpServer = http.createServer(app);

// MQTT over WebSocket on /mqtt. Other WebSocket upgrades (Vite's live
// reload in --dev) are left to their own listeners.
const wss = new WebSocketServer({ noServer: true });
httpServer.on("upgrade", (req, socket, head) => {
  if (new URL(req.url ?? "/", "http://localhost").pathname !== "/mqtt") return;
  wss.handleUpgrade(req, socket, head, (ws) => {
    broker.handle(createWebSocketStream(ws), req);
  });
});

if (DEV) {
  // Vite compiles src/ on request and reloads the page when a file changes
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true, hmr: { server: httpServer } },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.join(import.meta.dirname, "..", "dist")));
}

httpServer.listen(HTTP_PORT, "0.0.0.0", () => {
  console.log(`MQTT broker  tcp://0.0.0.0:${MQTT_PORT}`);
  console.log(`Dashboard    http://localhost:${HTTP_PORT}/${DEV ? "  (dev mode)" : ""}`);
  console.log("Put one of these in the car's config/wifi_secrets.h as MQTT_BROKER_IP:");
  for (const address of lanAddresses()) console.log(`    #define MQTT_BROKER_IP "${address}"`);
});

function lanAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i!.address);
}

// Ctrl-C: close the broker so cars see a clean disconnect
process.on("SIGINT", () => {
  broker.close(() => process.exit(0));
});
