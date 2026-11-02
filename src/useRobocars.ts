/**
 * The dashboard's MQTT client and everything it has heard, as React state.
 *
 * The browser connects to the broker over WebSocket (ws://<host>/mqtt, see
 * server/main.ts), subscribes to every car's status, telemetry and log, and
 * keeps one Car record per car id it sees. Components only read that state
 * and call send(); nothing else in the dashboard touches MQTT.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import mqtt, { type MqttClient } from "mqtt";
import {
  BROADCAST_ID,
  STATUS_ONLINE,
  decodeTelemetry,
  parseTelemetryPayload,
  parseTopic,
  topics,
  type Telemetry,
} from "./shared/protocol.ts";

/** Samples kept per car for the charts */
export const HISTORY_LENGTH = 120;
/** Log lines kept per car */
const LOG_LENGTH = 500;

export type Connection = "connecting" | "connected" | "disconnected";

export interface LogLine {
  time: Date;
  text: string;
  /** "car": from the car's log topic. "sent": what this dashboard sent. */
  kind: "car" | "sent";
}

export interface Car {
  id: string;
  online: boolean;
  /** latest sample */
  telemetry?: { word: bigint; values: Telemetry; time: Date };
  /** oldest first, at most HISTORY_LENGTH */
  history: Telemetry[];
  /** samples missing from the sequence numbers since the dashboard opened */
  lostSamples: number;
  logs: LogLine[];
}

type Cars = Record<string, Car>;

type Action =
  | { type: "message"; topic: string; text: string; time: Date }
  | { type: "sent"; carId: string; text: string; time: Date };

function emptyCar(id: string): Car {
  return { id, online: false, history: [], lostSamples: 0, logs: [] };
}

function keepLast<T>(list: T[], item: T, max: number): T[] {
  return [...list.slice(-(max - 1)), item];
}

function reducer(cars: Cars, action: Action): Cars {
  if (action.type === "sent") {
    // A broadcast goes in the log of every car we know of
    const ids = action.carId === BROADCAST_ID ? Object.keys(cars) : [action.carId];
    const next = { ...cars };
    for (const id of ids) {
      const car = next[id] ?? emptyCar(id);
      next[id] = {
        ...car,
        logs: keepLast(car.logs, { time: action.time, text: action.text, kind: "sent" }, LOG_LENGTH),
      };
    }
    return next;
  }

  const parsed = parseTopic(action.topic);
  if (!parsed || parsed.carId === BROADCAST_ID) return cars;
  const car = cars[parsed.carId] ?? emptyCar(parsed.carId);

  switch (parsed.leaf) {
    case "status":
      return { ...cars, [car.id]: { ...car, online: action.text === STATUS_ONLINE } };

    case "log":
      return {
        ...cars,
        [car.id]: {
          ...car,
          logs: keepLast(car.logs, { time: action.time, text: action.text, kind: "car" }, LOG_LENGTH),
        },
      };

    case "telemetry": {
      const word = parseTelemetryPayload(action.text);
      if (word === null) return cars;
      const values = decodeTelemetry(word);
      const previous = car.telemetry?.values.seq;
      const gap = previous === undefined ? 0 : (values.seq - previous - 1 + 256) % 256;
      return {
        ...cars,
        [car.id]: {
          ...car,
          online: true, // a car that sends is online, even if its status message was missed
          telemetry: { word, values, time: action.time },
          history: keepLast(car.history, values, HISTORY_LENGTH),
          lostSamples: car.lostSamples + gap,
        },
      };
    }
  }
  return cars;
}

export function useRobocars() {
  const [connection, setConnection] = useState<Connection>("connecting");
  const [cars, dispatch] = useReducer(reducer, {});
  const clientRef = useRef<MqttClient | null>(null);

  useEffect(() => {
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/mqtt`;
    const client = mqtt.connect(url, {
      clientId: `dashboard-${Math.random().toString(16).slice(2, 10)}`,
      reconnectPeriod: 2000,
    });
    clientRef.current = client;

    client.on("connect", () => {
      setConnection("connected");
      client.subscribe(["robocar/+/status", "robocar/+/telemetry", "robocar/+/log"]);
    });
    client.on("reconnect", () => setConnection("connecting"));
    client.on("close", () => setConnection("disconnected"));
    client.on("message", (topic, payload) => {
      dispatch({ type: "message", topic, text: payload.toString(), time: new Date() });
    });

    return () => {
      client.end(true);
    };
  }, []);

  /** Publish a command (leaf "cmd") or setting (leaf "config") to a car, or to "all". */
  const send = useCallback((carId: string, leaf: "cmd" | "config", text: string) => {
    const client = clientRef.current;
    if (!client?.connected) return;
    // Never retained: a retained command would run again on every reconnect
    client.publish(topics[leaf](carId), text, { qos: 1, retain: false });
    const target = carId === BROADCAST_ID ? "all cars" : carId;
    dispatch({ type: "sent", carId, text: `sent ${leaf} "${text}" to ${target}`, time: new Date() });
  }, []);

  return { connection, cars, send };
}
