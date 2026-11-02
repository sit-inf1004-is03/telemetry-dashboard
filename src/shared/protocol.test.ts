// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeTelemetry,
  encodeTelemetry,
  formatCommand,
  parseCommand,
  parseTelemetryPayload,
  parseTopic,
  TELEMETRY_FIELDS,
} from "./protocol.ts";

// The same sample as test MQ-U05 in the car (app_program/mqtt/mqtt_client_test.c).
// If this fails, protocol.ts and protocol.h disagree.
const GOLDEN_TEXT = "8024560276590111274";
const GOLDEN_FIELDS = {
  seq: 42,
  mode: 2,
  moving: 1,
  obstacle: 0,
  onLine: 1,
  batteryLow: 0,
  stoppedByTimer: 0,
  speedLeft: -35,
  speedRight: 60,
  heading: 270,
  distance: 123,
  battery: 87,
  rssi: 55,
};

test("decodes the car's golden telemetry sample", () => {
  const word = parseTelemetryPayload(GOLDEN_TEXT);
  assert.notEqual(word, null);
  assert.deepEqual(decodeTelemetry(word!), GOLDEN_FIELDS);
});

test("encodes the golden sample exactly as the car does", () => {
  assert.equal(encodeTelemetry(GOLDEN_FIELDS).toString(), GOLDEN_TEXT);
});

test("telemetry fields fit in 64 bits without overlapping", () => {
  let used = 0n;
  for (const f of TELEMETRY_FIELDS) {
    const mask = ((1n << BigInt(f.bits)) - 1n) << BigInt(f.offset);
    assert.equal(used & mask, 0n, `${f.key} overlaps another field`);
    used |= mask;
  }
  assert.ok(used < 1n << 64n);
});

test("rejects telemetry payloads that are not a 64-bit unsigned integer", () => {
  assert.equal(parseTelemetryPayload("18446744073709551616"), null);
  assert.equal(parseTelemetryPayload("-1"), null);
  assert.equal(parseTelemetryPayload("0x10"), null);
  assert.equal(parseTelemetryPayload("18446744073709551615"), 2n ** 64n - 1n);
});

test("command text round-trips with the car's rules", () => {
  assert.equal(formatCommand(2, [60, -20, 1500]), "2 60 -20 1500");
  assert.deepEqual(parseCommand("2 60 -20 1500"), { id: 2, args: [60, -20, 1500] });
  assert.deepEqual(parseCommand(" 3,2\r\n"), { id: 3, args: [2] });
  for (const bad of ["", "stop", "2 6x", "-1", "70000", "1 2147483648", "1 2 3 4 5 6"]) {
    assert.equal(parseCommand(bad), null, JSON.stringify(bad));
  }
});

test("parses robocar topics", () => {
  assert.deepEqual(parseTopic("robocar/robocar-01/log"), { carId: "robocar-01", leaf: "log" });
  assert.equal(parseTopic("robocar/x"), null);
  assert.equal(parseTopic("other/x/log"), null);
});
