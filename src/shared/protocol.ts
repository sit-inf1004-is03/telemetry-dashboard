/**
 * What the car and the dashboard say to each other over MQTT.
 *
 * THE CAR HAS A COPY OF THIS FILE:
 *     INF2004_ProjectTemplate/app_program/protocol.h
 * Change both together, or the two sides will disagree.
 *
 * Used by the dashboard (browser), the broker's console log and the
 * simulated car (Node), so it must not import anything.
 */

// ---------------------------------------------------------------------------
// Topics: robocar/<car id>/<leaf>
// ---------------------------------------------------------------------------

export const BROADCAST_ID = "all";

export const topics = {
  /** car -> dashboard: "online" / "offline" (retained; "offline" is the last will) */
  status: (carId: string) => `robocar/${carId}/status`,
  /** car -> dashboard: one unsigned 64-bit integer in decimal, packed as TELEMETRY_FIELDS */
  telemetry: (carId: string) => `robocar/${carId}/telemetry`,
  /** car -> dashboard: one line of text */
  log: (carId: string) => `robocar/${carId}/log`,
  /** dashboard -> car: "<command id> [arg ...]"; carId "all" reaches every car */
  cmd: (carId: string) => `robocar/${carId}/cmd`,
  /** dashboard -> car: "<setting id> <value>" */
  config: (carId: string) => `robocar/${carId}/config`,
};

/** Splits "robocar/<car id>/<leaf>" into its parts, or null for any other topic. */
export function parseTopic(topic: string): { carId: string; leaf: string } | null {
  const parts = topic.split("/");
  if (parts.length !== 3 || parts[0] !== "robocar") return null;
  return { carId: parts[1], leaf: parts[2] };
}

export const STATUS_ONLINE = "online";
export const STATUS_OFFLINE = "offline";

// ---------------------------------------------------------------------------
// Commands (robocar/<id>/cmd) and settings (robocar/<id>/config)
//
// Both are sent as decimal integers separated by spaces, the identifier first:
// "2 60 -20 1500" is CMD_DRIVE at 60 % speed, 20 % left, for 1.5 s.
// The dashboard draws a form for every entry below, so adding one here is all
// the dashboard needs; the car needs it in protocol.h and a task that acts on it.
// ---------------------------------------------------------------------------

export interface ArgDef {
  name: string;
  min: number;
  max: number;
  default: number;
  unit?: string;
}

export interface MessageDef {
  id: number;
  name: string;
  description: string;
  args: ArgDef[];
}

/** Command identifiers: CMD_* in protocol.h */
export const CMD = { PING: 0, STOP: 1, DRIVE: 2, SET_MODE: 3 } as const;

/** Setting identifiers: CFG_* in protocol.h */
export const CFG = { TELEMETRY_PERIOD: 1, TELEMETRY_ENABLE: 2 } as const;

/** Car limit: at most this many arguments after the identifier. */
export const MAX_ARGS = 4;

export const MODES = ["idle", "manual", "line", "avoid"] as const;

export const COMMANDS: MessageDef[] = [
  {
    id: CMD.PING,
    name: "Ping",
    description: 'The car answers "pong <token>" in its log.',
    args: [{ name: "token", min: 0, max: 999999, default: 1 }],
  },
  { id: CMD.STOP, name: "Stop", description: "Both wheels to 0.", args: [] },
  {
    id: CMD.DRIVE,
    name: "Drive",
    description: "Negative steer turns left. Stops after the time, or never if 0.",
    args: [
      { name: "speed", min: -100, max: 100, default: 50, unit: "%" },
      { name: "steer", min: -100, max: 100, default: 0, unit: "%" },
      { name: "time", min: 0, max: 600000, default: 1000, unit: "ms" },
    ],
  },
  {
    id: CMD.SET_MODE,
    name: "Set mode",
    description: MODES.map((m, i) => `${i} = ${m}`).join(", "),
    args: [{ name: "mode", min: 0, max: MODES.length - 1, default: 1 }],
  },
];

export const SETTINGS: MessageDef[] = [
  {
    id: CFG.TELEMETRY_PERIOD,
    name: "Telemetry period",
    description: "Time between telemetry samples.",
    args: [{ name: "period", min: 100, max: 60000, default: 1000, unit: "ms" }],
  },
  {
    id: CFG.TELEMETRY_ENABLE,
    name: "Telemetry on/off",
    description: "0 = stop sending telemetry, 1 = send.",
    args: [{ name: "enable", min: 0, max: 1, default: 1 }],
  },
];

/** [2, 60, -20, 1500] -> "2 60 -20 1500" */
export function formatCommand(id: number, args: number[]): string {
  return [id, ...args].map((n) => String(Math.trunc(n))).join(" ");
}

/**
 * "2 60 -20 1500" -> { id: 2, args: [60, -20, 1500] }, or null if the car
 * would reject it. Same rules as mqtt_parse_cmd() in the car.
 */
export function parseCommand(text: string): { id: number; args: number[] } | null {
  const words = text.split(/[\s,]+/).filter((w) => w !== "");
  if (words.length === 0 || words.length > 1 + MAX_ARGS) return null;
  if (!words.every((w) => /^[+-]?\d+$/.test(w))) return null;
  const numbers = words.map(Number);
  if (!numbers.every((n) => n >= -2147483648 && n <= 2147483647)) return null;
  const [id, ...args] = numbers;
  if (id < 0 || id > 0xffff) return null;
  return { id, args };
}

// ---------------------------------------------------------------------------
// Telemetry: one 64-bit word, fields packed from bit 0 upwards.
// Mirrors the TLM_* lines in protocol.h. The dashboard shows every field
// listed here, so a new field only needs adding here (and in the car).
// ---------------------------------------------------------------------------

export interface TelemetryField {
  key: string;
  label: string;
  offset: number;
  bits: number;
  /** two's complement within its width */
  signed?: boolean;
  unit?: string;
  /** "flag": 1 bit, shown as on/off. "enum": shown by name from `names`. */
  kind?: "number" | "flag" | "enum";
  names?: readonly string[];
  /** how to show a raw value (e.g. RSSI is sent as -dBm) */
  display?: (raw: number) => string;
  /** plot the history of this field on this fixed scale */
  chart?: { min: number; max: number };
}

export const TELEMETRY_FIELDS: TelemetryField[] = [
  { key: "seq", label: "Sample", offset: 0, bits: 8 },
  { key: "mode", label: "Mode", offset: 8, bits: 3, kind: "enum", names: MODES },
  { key: "moving", label: "Moving", offset: 11, bits: 1, kind: "flag" },
  { key: "obstacle", label: "Obstacle", offset: 12, bits: 1, kind: "flag" },
  { key: "onLine", label: "On line", offset: 13, bits: 1, kind: "flag" },
  { key: "batteryLow", label: "Battery low", offset: 14, bits: 1, kind: "flag" },
  { key: "stoppedByTimer", label: "Stopped by timer", offset: 15, bits: 1, kind: "flag" },
  {
    key: "speedLeft",
    label: "Left wheel",
    offset: 16,
    bits: 8,
    signed: true,
    unit: "%",
    chart: { min: -100, max: 100 },
  },
  {
    key: "speedRight",
    label: "Right wheel",
    offset: 24,
    bits: 8,
    signed: true,
    unit: "%",
    chart: { min: -100, max: 100 },
  },
  { key: "heading", label: "Heading", offset: 32, bits: 9, unit: "°", chart: { min: 0, max: 359 } },
  {
    key: "distance",
    label: "Obstacle distance",
    offset: 41,
    bits: 9,
    unit: "cm",
    chart: { min: 0, max: 400 },
    display: (raw) => (raw === 511 ? "none" : `${raw} cm`),
  },
  { key: "battery", label: "Battery", offset: 50, bits: 7, unit: "%", chart: { min: 0, max: 100 } },
  {
    key: "rssi",
    label: "Wi-Fi signal",
    offset: 57,
    bits: 7,
    unit: "dBm",
    display: (raw) => (raw === 0 ? "unknown" : `-${raw} dBm`),
  },
];

export type Telemetry = Record<string, number>;

/** Unpacks every field of a telemetry word. Signed fields come out negative where they should. */
export function decodeTelemetry(word: bigint): Telemetry {
  const values: Telemetry = {};
  for (const f of TELEMETRY_FIELDS) {
    let v = Number((word >> BigInt(f.offset)) & ((1n << BigInt(f.bits)) - 1n));
    if (f.signed && v >= 2 ** (f.bits - 1)) v -= 2 ** f.bits;
    values[f.key] = v;
  }
  return values;
}

/** Packs fields into a telemetry word (the car does this in C; the simulator and tests use this). */
export function encodeTelemetry(values: Partial<Telemetry>): bigint {
  let word = 0n;
  for (const f of TELEMETRY_FIELDS) {
    const v = BigInt(Math.trunc(values[f.key] ?? 0));
    const mask = (1n << BigInt(f.bits)) - 1n;
    word |= (BigInt.asUintN(64, v) & mask) << BigInt(f.offset);
  }
  return word;
}

/** "8024560276590111274" -> 8024560276590111274n, or null if not a 64-bit unsigned decimal. */
export function parseTelemetryPayload(text: string): bigint | null {
  if (!/^\d{1,20}$/.test(text.trim())) return null;
  const word = BigInt(text.trim());
  return word < 1n << 64n ? word : null;
}

/** How a field's value is shown to a person. */
export function formatField(f: TelemetryField, raw: number): string {
  if (f.display) return f.display(raw);
  if (f.kind === "flag") return raw ? "yes" : "no";
  if (f.kind === "enum") return f.names?.[raw] ?? `#${raw}`;
  return f.unit ? `${raw} ${f.unit}` : String(raw);
}
