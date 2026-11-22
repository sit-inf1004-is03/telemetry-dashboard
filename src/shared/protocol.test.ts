// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CMD,
  barcodeMeaning,
  decodeTelemetry,
  encodeTelemetry,
  formatBarcodeMap,
  formatCommand,
  formatTelemetryPayload,
  parseBarcodeMap,
  parseCommand,
  parseEvent,
  parseTelemetryPayload,
  parseTopic,
  TELEMETRY_FIELDS,
  TELEMETRY_LAYOUT,
  TELEMETRY_WORDS,
} from "./protocol.ts";

// The same sample as tests CO-U05 and CO-U10 in the car
// (app_program/comms/comms_test.c). If this fails, protocol.ts and protocol.h disagree.
const GOLDEN_TEXT = "11213681551648818218 8090835030";
const GOLDEN_WORD0_FIELDS = {
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
  version: 2,
};
const GOLDEN_FIELDS = {
  ...GOLDEN_WORD0_FIELDS,
  imuMotion: 2, // cruising
  imuTerrain: 1, // climbing
  imuOk: 1,
  barcode: 66, // "B"
  barcodeCount: 5,
  distance: 123456, // cm
};

test("decodes the car's golden telemetry sample", () => {
  const words = parseTelemetryPayload(GOLDEN_TEXT);
  assert.notEqual(words, null);
  assert.deepEqual(decodeTelemetry(words!), GOLDEN_FIELDS);
});

test("encodes the golden sample exactly as the car does", () => {
  assert.equal(formatTelemetryPayload(encodeTelemetry(GOLDEN_FIELDS)), GOLDEN_TEXT);
});

test("the layout version matches the car's TLM_LAYOUT", () => {
  assert.equal(GOLDEN_FIELDS.version, TELEMETRY_LAYOUT);
});

test("a layout 1 payload (word 0 alone) still decodes, without the word 1 fields", () => {
  const layout1 = 6601995533221430314n; // the layout 1 golden sample
  assert.deepEqual(decodeTelemetry(parseTelemetryPayload(layout1.toString())!), { ...GOLDEN_WORD0_FIELDS, version: 1 });
});

test("remote commands keep Navigation's NAV_REMOTE_* numbers", () => {
  assert.deepEqual([CMD.START, CMD.STOP, CMD.CLEAR], [1, 2, 3]);
});

test("telemetry fields fit in their 64-bit words without overlapping", () => {
  const used = Array.from({ length: TELEMETRY_WORDS }, () => 0n);
  for (const f of TELEMETRY_FIELDS) {
    const w = f.word ?? 0;
    assert.ok(w < TELEMETRY_WORDS && f.offset + f.bits <= 64, `${f.key} is outside the words`);
    const mask = ((1n << BigInt(f.bits)) - 1n) << BigInt(f.offset);
    assert.equal(used[w] & mask, 0n, `${f.key} overlaps another field`);
    used[w] |= mask;
  }
  assert.equal(used[0], (1n << 64n) - 1n, "every bit of word 0 is a field");
  assert.equal(used[1], (1n << 36n) - 1n, "word 1 uses bits 0-35, as in protocol.h");
});

test("rejects telemetry payloads that are not one or two 64-bit unsigned integers", () => {
  assert.equal(parseTelemetryPayload("18446744073709551616"), null);
  assert.equal(parseTelemetryPayload("1 18446744073709551616"), null);
  assert.equal(parseTelemetryPayload("-1"), null);
  assert.equal(parseTelemetryPayload("0x10"), null);
  assert.equal(parseTelemetryPayload("1 2 3"), null);
  assert.equal(parseTelemetryPayload(""), null);
  assert.deepEqual(parseTelemetryPayload("18446744073709551615"), [2n ** 64n - 1n]);
  assert.deepEqual(parseTelemetryPayload(" 1  2\n"), [1n, 2n]);
});

test("parses the car's hump, barcode and obstacle events", () => {
  assert.deepEqual(parseEvent("0 42 0 9"), { type: "hump", heightMm: 42, over: false, tiltDeg: 9 });
  assert.deepEqual(parseEvent("0 127 1 31"), { type: "hump", heightMm: 127, over: true, tiltDeg: 31 });
  assert.deepEqual(parseEvent("1 65"), { type: "barcode", letter: "A" });
  assert.deepEqual(parseEvent("2 152 13 1"), { type: "obstacle", widthMm: 152, frontCm: 13, whole: true });
  assert.deepEqual(parseEvent("2 300 14 0"), { type: "obstacle", widthMm: 300, frontCm: 14, whole: false });
  for (const bad of ["", "hump", "0 200 0 0", "1 0", "1 200", "7 1"]) {
    assert.equal(parseEvent(bad), null, JSON.stringify(bad));
  }
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

test("reads the car's barcode map from its log line (telemetry.c, barcode_map_text)", () => {
  const map = parseBarcodeMap("barcodes: A=L B=R K=S 7=U");
  assert.deepEqual(map, { dirs: { A: "Left", B: "Right", K: "Straight", "7": "U-turn" }, complete: true });
  assert.equal(barcodeMeaning(map!, "K"), "Straight");
  assert.equal(barcodeMeaning(map!, "Z"), "Ignored");
  assert.equal(barcodeMeaning(undefined, "A"), undefined, "no map yet: meaning unknown, not a guess");

  assert.deepEqual(parseBarcodeMap("barcodes: none (all ignored)"), { dirs: {}, complete: true });
  const cut = parseBarcodeMap("barcodes: 0=L 1=R ...");
  assert.equal(cut?.complete, false);
  assert.equal(barcodeMeaning(cut!, "Z"), undefined, "past the cut: unknown");

  assert.equal(parseBarcodeMap("[BC] read *A* -> LEFT"), null);
  assert.equal(parseBarcodeMap("barcodes: A=Q"), null);
});

test("the simulated car writes the map as the car does", () => {
  assert.equal(formatBarcodeMap({ A: 0, B: 1, C: 2, D: 3, E: 4 }), "barcodes: A=L B=R C=S D=U");
  assert.equal(formatBarcodeMap({ K: 1, "3": 0 }), "barcodes: 3=L K=R");
  assert.equal(formatBarcodeMap({}), "barcodes: none (all ignored)");
});
