// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CMD,
  decodeTelemetry,
  encodeTelemetry,
  formatCommand,
  parseCommand,
  parseTelemetryPayload,
  parseTopic,
  TELEMETRY_FIELDS,
  TELEMETRY_LAYOUT,
} from "./protocol.ts";

// The same sample as test CO-U05 in the car (app_program/comms/comms_test.c).
// If this fails, protocol.ts and protocol.h disagree.
const GOLDEN_TEXT = "6601995533221430314";
const GOLDEN_FIELDS = {
  seq: 42,
  navState: 4, // bypass
  navReason: 0,
  faultMotorStall: 0,
  faultEncoder: 0,
  faultLineLost: 1, // fault bit 2
  faultImu: 0,
  faultEstop: 0,
  faultNoEcho: 0,
  faultScanError: 0,
  faultWifiLoss: 1, // fault bit 7
  motion: 1, // straight
  line: 2, // searching
  speedLeft: 345,
  speedRight: 1023,
  obstacle: 123,
  rssi: 55,
  version: 1,
};

test("decodes the car's golden telemetry sample", () => {
  const word = parseTelemetryPayload(GOLDEN_TEXT);
  assert.notEqual(word, null);
  assert.deepEqual(decodeTelemetry(word!), GOLDEN_FIELDS);
});

test("encodes the golden sample exactly as the car does", () => {
  assert.equal(encodeTelemetry(GOLDEN_FIELDS).toString(), GOLDEN_TEXT);
});

test("the layout version matches the car's TLM_LAYOUT", () => {
  assert.equal(GOLDEN_FIELDS.version, TELEMETRY_LAYOUT);
});

test("remote commands keep Navigation's NAV_REMOTE_* numbers", () => {
  assert.deepEqual([CMD.START, CMD.STOP, CMD.CLEAR], [1, 2, 3]);
});

test("telemetry fields fit in 64 bits without overlapping", () => {
  let used = 0n;
  for (const f of TELEMETRY_FIELDS) {
    const mask = ((1n << BigInt(f.bits)) - 1n) << BigInt(f.offset);
    assert.equal(used & mask, 0n, `${f.key} overlaps another field`);
    used |= mask;
  }
  assert.equal(used, (1n << 64n) - 1n, "every bit of the word is a field");
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
