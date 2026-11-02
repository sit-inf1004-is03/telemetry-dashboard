/**
 * The MQTT broker (Aedes, running inside this Node process).
 *
 * Aedes only routes messages; it needs no knowledge of the robocar topics.
 * What is added here is a readable console log of the traffic, so you can
 * see what the cars and the dashboard are doing without any other tool.
 */
import { Aedes } from "aedes";
import { parseTopic } from "../src/shared/protocol.ts";

/** Set VERBOSE=1 to also log every telemetry sample (one per car per second by default). */
const VERBOSE = process.env.VERBOSE === "1";

export async function createBroker(): Promise<Aedes> {
  const broker = await Aedes.createBroker();

  broker.on("client", (client) => log(`${client.id} connected`));
  broker.on("clientDisconnect", (client) => log(`${client.id} disconnected`));
  broker.on("clientError", (client, err) => log(`${client.id} error: ${err.message}`));

  broker.on("subscribe", (subscriptions, client) => {
    log(`${client.id} subscribed to ${subscriptions.map((s) => s.topic).join(", ")}`);
  });

  broker.on("publish", (packet, client) => {
    // No client = published by the broker itself ($SYS heartbeats, last wills)
    if (packet.topic.startsWith("$SYS/")) return;
    const parsed = parseTopic(packet.topic);
    if (parsed?.leaf === "telemetry" && !VERBOSE) return;

    const from = client?.id ?? "broker";
    log(`${from} -> ${packet.topic}: ${packet.payload.toString()}${packet.retain ? " (retained)" : ""}`);
  });

  return broker;
}

function log(line: string) {
  console.log(`${new Date().toISOString().slice(11, 23)} [mqtt] ${line}`);
}
