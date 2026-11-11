/**
 * A pretend car: speaks the same MQTT protocol as the Pico W firmware, so
 * the dashboard can be developed and demonstrated without the hardware.
 *
 *   npm run simulate                    one car called "robocar-sim"
 *   npm run simulate -- robocar-02      a car with another id
 *   BROKER=mqtt://192.168.1.10 npm run simulate
 *
 * It imitates, roughly, the firmware's Navigation (app_program/navigation):
 * Start makes it follow the line; now and then it meets an obstacle, stops,
 * goes around it and finds the line again, and sometimes does not and stops
 * in FAULT until Clear faults. Stop brakes it. On the way it rides over
 * humps and reads barcodes (A-D, each followed by a junction), and reports
 * them as events. Telemetry is packed exactly as
 * app_program/telemetry/telemetry.c does.
 */
import mqtt from "mqtt";
import {
  BROADCAST_ID,
  CFG,
  CMD,
  EVT,
  FAULTS,
  STATUS_OFFLINE,
  STATUS_ONLINE,
  TELEMETRY_LAYOUT,
  encodeTelemetry,
  formatCommand,
  formatTelemetryPayload,
  parseCommand,
  topics,
} from "../src/shared/protocol.ts";

const carId = process.argv[2] ?? "robocar-sim";
const brokerUrl = process.env.BROKER ?? "mqtt://localhost:1883";

// Numbers as in the firmware's navigation.h and motion.h
const STATE = { IDLE: 0, LINE_FOLLOW: 1, JUNCTION: 2, OBSTACLE: 3, BYPASS: 4, STOPPED: 5, FAULT: 6 } as const;
const REASON = { NONE: 0, FAULT_BIT: 1, MOTION: 2, LINE_NOT_FOUND: 3, REMOTE_STOP: 4 } as const;
const FAULT = { LINE_LOST: 1 << 2, WIFI_LOSS: 1 << 7 } as const;
const MOTION = { IDLE: 0, STRAIGHT: 1, PIVOT: 2 } as const;
const LINE = { ON: 0, LOST: 1, SEARCHING: 2 } as const;
// imu_pack.h
const IMU_MOTION = { STATIONARY: 0, ACCELERATING: 1, CRUISING: 2, TURNING: 3 } as const;
const TERRAIN = { LEVEL: 0, CLIMBING: 1, DESCENDING: 2, HUMP_CLOSED: 3 } as const;

const car = {
  state: STATE.IDLE as number,
  reason: REASON.NONE as number,
  faults: 0,
  motion: MOTION.IDLE as number,
  line: LINE.ON as number,
  speedLeft: 0,
  speedRight: 0,
  obstacleCm: 511,
  imuMotion: IMU_MOTION.STATIONARY as number,
  terrain: TERRAIN.LEVEL as number,
  humpMm: 0, // height of the hump being climbed
  distanceCm: 0,
  barcode: 0, // ASCII code of the last letter read
  barcodeCount: 0,
  stateTicks: 0, // samples spent in the current state
  seq: 0,
  periodMs: 1000,
  enabled: true,
  wasOnline: false,
};
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
  if (car.wasOnline) car.faults |= FAULT.WIFI_LOSS; // as remote.c does on a reconnect
  car.wasOnline = true;
  client.subscribe([topics.cmd(carId), topics.cmd(BROADCAST_ID), topics.config(carId)], { qos: 1 });
  client.publish(topics.status(carId), STATUS_ONLINE, { qos: 1, retain: true });
  log(`net: online as ${carId} (simulated)`);
  restartSampling();
});
client.on("error", (err) => console.error(`mqtt: ${err.message}`));

client.on("message", (topic, payload) => {
  const msg = parseCommand(payload.toString());
  if (!msg) {
    log(`remote: ignored a message on ${topic}: not "<id> [arg ...]"`);
    return;
  }
  const from = topic === topics.cmd(BROADCAST_ID) ? " (broadcast)" : "";
  if (topic === topics.config(carId)) applySetting(msg.id, msg.args);
  else runCommand(msg.id, msg.args, from);
});

function sendEvent(id: number, args: number[]) {
  client.publish(topics.event(carId), formatCommand(id, args));
}

/** Line Following reads a barcode A-D; Navigation turns at the junction after it */
function readBarcode() {
  const letter = "ABCD"[Math.floor(Math.random() * 4)];
  car.barcode = letter.charCodeAt(0);
  car.barcodeCount = (car.barcodeCount + 1) & 0xf;
  log(`[BC] read *${letter}* (simulated)`);
  sendEvent(EVT.BARCODE, [car.barcode]);
}

/** The IMU's terrain region: level -> climbing -> descending -> hump closed -> level */
function stepTerrain() {
  switch (car.terrain) {
    case TERRAIN.LEVEL:
      if (car.state === STATE.LINE_FOLLOW && Math.random() < 0.06) {
        car.terrain = TERRAIN.CLIMBING;
        car.humpMm = 15 + Math.round(Math.random() * 60);
      }
      break;
    case TERRAIN.CLIMBING:
      car.terrain = TERRAIN.DESCENDING;
      break;
    case TERRAIN.DESCENDING: {
      car.terrain = TERRAIN.HUMP_CLOSED;
      const tiltDeg = Math.min(31, Math.round(car.humpMm / 4));
      sendEvent(EVT.HUMP, [car.humpMm, 0, tiltDeg]);
      break;
    }
    default: // HUMP_CLOSED shows for one sample
      car.terrain = TERRAIN.LEVEL;
  }
}

function enter(state: number) {
  car.state = state;
  car.stateTicks = 0;
}

function halted() {
  return car.state === STATE.IDLE || car.state === STATE.STOPPED || car.state === STATE.FAULT;
}

/** Navigation's rules for the remote commands (nav_on_remote) */
function runCommand(id: number, [a0 = 0]: number[], from: string) {
  switch (id) {
    case CMD.PING:
      return log(`remote: pong ${a0}${from}`);
    case CMD.START:
      if (halted() && car.state !== STATE.FAULT) {
        car.reason = REASON.NONE;
        enter(STATE.LINE_FOLLOW);
      }
      return log(`remote: START to navigation${from}`);
    case CMD.STOP:
      if (!halted()) {
        car.reason = REASON.REMOTE_STOP;
        enter(STATE.STOPPED);
      }
      return log(`remote: STOP to navigation${from}`);
    case CMD.CLEAR:
      if (car.state === STATE.FAULT) {
        car.faults = 0;
        car.reason = REASON.NONE;
        enter(STATE.IDLE);
      }
      return log(`remote: CLEAR to navigation${from}`);
    default:
      return log(`remote: unknown command ${id}`);
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

const jitter = (n: number) => n + Math.round((Math.random() - 0.5) * n * 0.2);

/** One step of the pretend car, once per sample */
function step() {
  const seconds = (car.stateTicks * car.periodMs) / 1000;
  car.stateTicks++;

  switch (car.state) {
    case STATE.LINE_FOLLOW:
      car.motion = MOTION.STRAIGHT;
      car.line = LINE.ON;
      car.speedLeft = jitter(300);
      car.speedRight = jitter(300);
      if (car.obstacleCm === 511 && Math.random() < 0.08) car.obstacleCm = 150; // something ahead
      if (car.obstacleCm !== 511) car.obstacleCm -= 25;
      if (car.obstacleCm !== 511 && car.obstacleCm <= 20) enter(STATE.OBSTACLE);
      else if (seconds > 4 && Math.random() < 0.05) {
        readBarcode();
        enter(STATE.JUNCTION);
      }
      break;
    case STATE.JUNCTION:
      car.motion = MOTION.PIVOT;
      car.speedLeft = 150;
      car.speedRight = 150;
      if (seconds >= 1) enter(STATE.LINE_FOLLOW);
      break;
    case STATE.OBSTACLE: // braked; Obstacle Scan scans
      car.motion = MOTION.IDLE;
      car.speedLeft = car.speedRight = 0;
      if (seconds >= 2) enter(STATE.BYPASS);
      break;
    case STATE.BYPASS:
      car.motion = seconds < 1 ? MOTION.PIVOT : MOTION.STRAIGHT;
      car.line = seconds < 1 ? LINE.LOST : LINE.SEARCHING;
      car.speedLeft = jitter(200);
      car.speedRight = jitter(200);
      car.obstacleCm = 511;
      if (seconds >= 3) {
        if (Math.random() < 0.25) {
          car.faults |= FAULT.LINE_LOST;
          car.reason = REASON.LINE_NOT_FOUND;
          enter(STATE.FAULT);
          log("navigation: line not found after the bypass (simulated)");
        } else {
          enter(STATE.LINE_FOLLOW);
        }
      }
      break;
    default: // IDLE, STOPPED, FAULT
      car.motion = MOTION.IDLE;
      car.speedLeft = car.speedRight = 0;
      car.obstacleCm = 511;
  }

  const meanMmPerS = (car.speedLeft + car.speedRight) / 2;
  car.distanceCm += (meanMmPerS * car.periodMs) / 1000 / 10;
  if (meanMmPerS === 0) car.imuMotion = IMU_MOTION.STATIONARY;
  else if (car.motion === MOTION.PIVOT) car.imuMotion = IMU_MOTION.TURNING;
  else car.imuMotion = car.stateTicks <= 1 ? IMU_MOTION.ACCELERATING : IMU_MOTION.CRUISING;
  stepTerrain();
}

function sample() {
  step();
  if (!car.enabled || !client.connected) return;
  const words = encodeTelemetry({
    seq: car.seq,
    navState: car.state,
    navReason: car.reason,
    ...Object.fromEntries(FAULTS.map(([key], bit) => [key, (car.faults >> bit) & 1])),
    motion: car.motion,
    line: car.line,
    speedLeft: Math.min(car.speedLeft, 1023),
    speedRight: Math.min(car.speedRight, 1023),
    obstacle: car.obstacleCm,
    rssi: 50 + Math.round(Math.random() * 8),
    version: TELEMETRY_LAYOUT,
    imuMotion: car.imuMotion,
    imuTerrain: car.terrain,
    imuOk: 1,
    barcode: car.barcode,
    barcodeCount: car.barcodeCount,
    distance: Math.min(Math.floor(car.distanceCm), 1048575),
  });
  car.seq = (car.seq + 1) & 0xff;
  client.publish(topics.telemetry(carId), formatTelemetryPayload(words));
}

process.on("SIGINT", () => {
  // A clean exit says "offline" itself; a crash leaves it to the last will
  client.publish(topics.status(carId), STATUS_OFFLINE, { qos: 1, retain: true }, () =>
    client.end(false, () => process.exit(0)),
  );
});
