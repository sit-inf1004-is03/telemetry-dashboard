/**
 * The car's log lines, interleaved with what this dashboard sent to it.
 * Stays scrolled to the newest line unless you scroll up to read.
 */
import { useEffect, useRef } from "react";
import type { LogLine } from "../useRobocars.ts";

export function LogPanel({ logs }: { logs: LogLine[] }) {
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    if (stick.current && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [logs]);

  return (
    <section className="panel">
      <h3>Log</h3>
      <div
        className="log"
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
        }}
      >
        {logs.length === 0 && <p className="muted">Nothing yet.</p>}
        {logs.map((line, i) => (
          <div key={i} className={`log-line ${line.kind}`}>
            <time>{line.time.toLocaleTimeString()}</time> {line.text}
          </div>
        ))}
      </div>
    </section>
  );
}
