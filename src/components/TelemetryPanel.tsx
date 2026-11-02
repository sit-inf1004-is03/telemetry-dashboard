/**
 * The latest telemetry sample: one tile per field in TELEMETRY_FIELDS, with a
 * chart of its recent history where the field asks for one. Flags (1-bit
 * fields) are shown together as a row of on/off badges.
 */
import { useEffect, useState } from "react";
import { TELEMETRY_FIELDS, formatField } from "../shared/protocol.ts";
import type { Car } from "../useRobocars.ts";
import { Sparkline } from "./Sparkline.tsx";

export function TelemetryPanel({ car }: { car: Car }) {
  const now = useNow(1000);
  const t = car.telemetry;
  if (!t) {
    return (
      <section className="panel">
        <h3>Telemetry</h3>
        <p className="muted">No sample received yet.</p>
      </section>
    );
  }

  const flags = TELEMETRY_FIELDS.filter((f) => f.kind === "flag");
  const others = TELEMETRY_FIELDS.filter((f) => f.kind !== "flag");
  const age = Math.max(0, (now - t.time.getTime()) / 1000);

  return (
    <section className="panel">
      <h3>Telemetry</h3>
      <p className="muted small">
        Last sample {age.toFixed(0)} s ago · {car.lostSamples} lost since this page opened · raw{" "}
        <code title="as received">{t.word.toString()}</code> ={" "}
        <code title="the same, in hex">0x{t.word.toString(16).padStart(16, "0")}</code>
      </p>

      <div className="flags">
        {flags.map((f) => (
          <span key={f.key} className={`flag ${t.values[f.key] ? "on" : ""}`}>
            {t.values[f.key] ? "● " : "○ "}
            {f.label}
          </span>
        ))}
      </div>

      <div className="tiles">
        {others.map((f) => (
          <div key={f.key} className="tile">
            <div className="tile-label">{f.label}</div>
            <div className="tile-value">{formatField(f, t.values[f.key])}</div>
            {f.chart && (
              <Sparkline
                label={f.label}
                values={car.history.map((h) => h[f.key])}
                min={f.chart.min}
                max={f.chart.max}
                format={(v) => formatField(f, v)}
              />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/** The current time, updated every `ms`, so "x s ago" keeps counting. */
function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}
