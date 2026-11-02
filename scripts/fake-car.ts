/**
 * A pretend car: speaks the same MQTT protocol as the Pico W firmware, so
 * the dashboard can be developed and demonstrated without the hardware.
 *
 *   npm run simulate                    one car called "robocar-sim"
 *   npm run simulate -- robocar-02      a car with another id
 *   BROKER=mqtt://192.168.1.10 npm run simulate
 *
 * It mirrors what the firmware does in app_program/motion and
 * app_program/telemetry, in simplified form.
 */
import mqtt from "mqtt";
import {
  BROADCAST_ID,
  CFG,
  CMD,
  MODES,
  STATUS_OFFLINE,
  STATUS_ONLINE,
  encodeTelemetry,
  parseCommand,
  topics,
} from "../src/shared/protocol.ts";

const carId = process.argv[2] ?? "robocar-sim";
const brokerUrl = process.env.BROKER ?? "mqtt://localhost:1883";

const car = {
  speedLeft: 0,
  speedRight: 0,
  mode: 0,
  stoppedByTimer: false,
  heading: 0,
  distance: 150,
  battery: 100,
  seq: 0,
  periodMs: 1000,
  enabled: true,
};
let stopTimer: NodeJS.Timeout | undefined;
let sampleTimer: NodeJS.Timeout | undefined;

const client = mqtt.connect(brokerUrl, {
  clientId: carId,
  keepalive: 30,
  will: { topic: topics.status(carId), payload: Buffer.from(STATUS_OFFLINE), qos: 1, retain: true },
});

function log(line: string) {
  console.log(line);
  client.publish(topics.log(carId), line);
}

client.on("connect", () => {
  client.subscribe([topics.cmd(carId), topics.cmd(BROADCAST_ID), topics.config(carId)], { qos: 1 });
  client.publish(topics.status(carId), STATUS_ONLINE, { qos: 1, retain: true });
  log(`net: online as ${carId} (simulated)`);
  restartSampling();
});
client.on("error", (err) => console.error(`mqtt: ${err.message}`));

client.on("message", (topic, payload) => {
  const msg = parseCommand(payload.toString());
  if (!msg) {
    log(`net: ignored a message on ${topic}: not "<id> [arg ...]"`);
    return;
  }
  const from = topic === topics.cmd(BROADCAST_ID) ? " (broadcast)" : "";
  if (topic === topics.config(carId)) applySetting(msg.id, msg.args);
  else runCommand(msg.id, msg.args, from);
});

function setMotors(left: number, right: number, byTimer = false) {
  car.speedLeft = left;
  car.speedRight = right;
  car.stoppedByTimer = byTimer;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function runCommand(id: number, [a0 = 0, a1 = 0, a2 = 0]: number[], from: string) {
  switch (id) {
    case CMD.PING:
      return log(`motion: pong ${a0}${from}`);
    case CMD.STOP:
      clearTimeout(stopTimer);
      setMotors(0, 0);
      return log(`motion: stop${from}`);
    case CMD.DRIVE: {
      const speed = clamp(a0, -100, 100);
      const steer = clamp(a1, -100, 100);
      const time = clamp(a2, 0, 600000);
      clearTimeout(stopTimer);
      setMotors(clamp(speed + steer, -100, 100), clamp(speed - steer, -100, 100));
      if (time > 0) {
        stopTimer = setTimeout(() => {
          setMotors(0, 0, true);
          log("motion: drive time up, stopped");
        }, time);
      }
      return log(`motion: drive speed ${speed} steer ${steer} for ${time} ms${from}`);
    }
    case CMD.SET_MODE:
      if (a0 < 0 || a0 >= MODES.length) return log(`motion: no mode ${a0}`);
      car.mode = a0;
      return log(`motion: mode ${a0}${from}`);
    default:
      return log(`motion: unknown command ${id}`);
  }
}

function applySetting(id: number, [value = 0]: number[]) {
  if (id === CFG.TELEMETRY_PERIOD) {
    if (value < 100 || value > 60000) return log(`telemetry: period ${value} ms is outside 100..60000`);
    car.periodMs = value;
    restartSampling();
    return log(`telemetry: every ${value} ms`);
  }
  if (id === CFG.TELEMETRY_ENABLE) {
    car.enabled = value !== 0;
    return log(`telemetry: ${car.enabled ? "on" : "off"}`);
  }
  log(`telemetry: unknown setting ${id}`);
}

function restartSampling() {
  clearInterval(sampleTimer);
  sampleTimer = setInterval(sample, car.periodMs);
}

function sample() {
  const dt = car.periodMs / 1000;
  const forward = (car.speedLeft + car.speedRight) / 2;
  const turn = car.speedLeft - car.speedRight;
  car.heading = (((car.heading + turn * 0.45 * dt) % 360) + 360) % 360;
  car.distance -= forward * 0.5 * dt;
  if (car.distance < 5) car.distance = 80 + Math.random() * 300;
  car.battery = clamp(car.battery + (forward || turn ? -0.04 : 0.2) * dt, 0, 100);

  if (!car.enabled || !client.connected) return;
  const word = encodeTelemetry({
    seq: car.seq,
    mode: car.mode,
    moving: car.speedLeft || car.speedRight ? 1 : 0,
    obstacle: car.distance < 20 ? 1 : 0,
    onLine: Math.floor(car.heading / 30) % 2 === 0 ? 1 : 0,
    batteryLow: car.battery < 20 ? 1 : 0,
    stoppedByTimer: car.stoppedByTimer ? 1 : 0,
    speedLeft: car.speedLeft,
    speedRight: car.speedRight,
    heading: car.heading,
    distance: car.distance >= 400 ? 511 : car.distance,
    battery: car.battery,
    rssi: 50 + Math.round(Math.random() * 8),
  });
  car.seq = (car.seq + 1) & 0xff;
  client.publish(topics.telemetry(carId), word.toString());
}

process.on("SIGINT", () => {
  // A clean exit says "offline" itself; a crash leaves it to the last will
  client.publish(topics.status(carId), STATUS_OFFLINE, { qos: 1, retain: true }, () =>
    client.end(false, () => process.exit(0)),
  );
});
