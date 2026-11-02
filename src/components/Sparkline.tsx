/**
 * A small line chart of one field's recent values, on a fixed scale so that
 * the line means the same thing from one moment to the next. Hover to read
 * a value.
 */
import { useState, type PointerEvent } from "react";
import { HISTORY_LENGTH } from "../useRobocars.ts";

const WIDTH = 200;
const HEIGHT = 40;
const PAD = 3; // keeps the 2px line from being clipped at the edges

interface Props {
  label: string;
  values: number[];
  min: number;
  max: number;
  format: (v: number) => string;
}

export function Sparkline({ label, values, min, max, format }: Props) {
  const [hover, setHover] = useState<number | null>(null);

  const x = (i: number) => PAD + (i / (HISTORY_LENGTH - 1)) * (WIDTH - 2 * PAD);
  const y = (v: number) => {
    const clamped = Math.min(max, Math.max(min, v));
    return HEIGHT - PAD - ((clamped - min) / (max - min)) * (HEIGHT - 2 * PAD);
  };
  // Newest sample at the right edge
  const first = HISTORY_LENGTH - values.length;
  const points = values.map((v, i) => `${x(first + i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const zero = min < 0 && max > 0 ? y(0) : null;

  function onPointerMove(e: PointerEvent<SVGSVGElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const slot = Math.round(((e.clientX - box.left) / box.width) * (HISTORY_LENGTH - 1));
    const i = slot - first;
    setHover(i >= 0 && i < values.length ? i : null);
  }

  return (
    <div className="sparkline">
      <div className="sparkline-plot">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${label}, last ${values.length} samples`}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHover(null)}
        >
          {zero !== null && <line className="baseline" x1={0} x2={WIDTH} y1={zero} y2={zero} />}
          <polyline className="series" points={points} />
          {hover !== null && (
            <line className="crosshair" x1={x(first + hover)} x2={x(first + hover)} y1={0} y2={HEIGHT} />
          )}
        </svg>
        {hover !== null && (
          // Drawn outside the SVG, which is stretched to fit and would squash a circle
          <span
            className="marker"
            style={{ left: `${(x(first + hover) / WIDTH) * 100}%`, top: `${(y(values[hover]) / HEIGHT) * 100}%` }}
          />
        )}
      </div>
      <div className="sparkline-readout small muted">
        {hover !== null
          ? `${format(values[hover])}, ${values.length - 1 - hover} samples ago`
          : `${format(min)} … ${format(max)}`}
      </div>
    </div>
  );
}
