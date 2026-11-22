/**
 * What the car found on the course: humps (from the IMU), barcodes (from
 * Line Following) and obstacle widths (from Obstacle Scan), as cards and one
 * list in the order they happened.
 *
 * The tallest hump is kept by the dashboard, from the hump events it has
 * received since the page opened or since "Reset". The latest barcode comes
 * from the newest of the last barcode event and the telemetry, which repeats
 * the last letter in every sample, so it shows even if the event was missed.
 */
import { useEffect, useRef } from "react";
import { BARCODE_COMMANDS } from "../shared/protocol.ts";
import type { Car, Detection, HumpDetection } from "../useRobocars.ts";

export function DetectionsPanel({ car, resetTallest }: { car: Car; resetTallest: (carId: string) => void }) {
  const tallest = car.tallestHump;
  const barcode = latestBarcode(car);
  const obstacle = latestObstacle(car);

  return (
    <section className="panel">
      <h3>Detections</h3>
      <div className="tiles">
        <div className="tile">
          <div className="tile-label">Tallest hump</div>
          <div className="tile-value">{tallest ? humpHeight(tallest) : <span className="muted">none yet</span>}</div>
          {tallest && (
            <div className="tile-foot">
              <span className="muted small">at {tallest.time.toLocaleTimeString()}</span>
              <button className="link" onClick={() => resetTallest(car.id)}>
                Reset
              </button>
            </div>
          )}
        </div>
        <div className="tile">
          <div className="tile-label">Latest barcode</div>
          <div className="tile-value">
            {barcode ? barcodeText(barcode.letter) : <span className="muted">none yet</span>}
          </div>
          {barcode && (
            <div className="tile-foot muted small">
              {barcode.time ? `read at ${barcode.time.toLocaleTimeString()}` : "read before this page opened"}
            </div>
          )}
        </div>
        <div className="tile">
          <div className="tile-label">Obstacle width</div>
          <div className="tile-value">
            {obstacle ? obstacleWidth(obstacle) : <span className="muted">none yet</span>}
          </div>
          {obstacle && (
            <div className="tile-foot muted small">
              {obstacle.frontCm} cm ahead, at {obstacle.time.toLocaleTimeString()}
            </div>
          )}
        </div>
      </div>
      <DetectionList detections={car.detections} />
    </section>
  );
}

function DetectionList({ detections }: { detections: Detection[] }) {
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    if (stick.current && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [detections]);

  return (
    <div
      className="log detections"
      ref={box}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
      }}
    >
      {detections.length === 0 && <p className="muted">No hump, barcode or obstacle yet.</p>}
      {detections.map((d, i) => (
        <div key={i} className="log-line">
          <time>{d.time.toLocaleTimeString()}</time> <span className={`badge ${d.type}`}>{d.type}</span>{" "}
          {d.type === "hump"
            ? `${humpHeight(d)}, tilt ${d.tiltDeg}°`
            : d.type === "obstacle"
              ? `${obstacleWidth(d)} wide, ${d.frontCm} cm ahead`
              : barcodeText(d.letter)}
        </div>
      ))}
    </div>
  );
}

function latestBarcode(car: Car): { letter: string; time?: Date } | undefined {
  let event: Extract<Detection, { type: "barcode" }> | undefined;
  for (let i = car.detections.length - 1; i >= 0 && !event; i--) {
    const d = car.detections[i];
    if (d.type === "barcode") event = d;
  }
  const t = car.telemetry;
  const code = t?.values.barcode;
  if (event && (!t || !code || event.time >= t.time)) return event;
  if (!code) return undefined;
  const letter = String.fromCharCode(code);
  return { letter, time: event?.letter === letter ? event.time : undefined };
}

type ObstacleDetection = Extract<Detection, { type: "obstacle" }>;

function latestObstacle(car: Car): ObstacleDetection | undefined {
  for (let i = car.detections.length - 1; i >= 0; i--) {
    const d = car.detections[i];
    if (d.type === "obstacle") return d;
  }
  return undefined;
}

function obstacleWidth(o: ObstacleDetection) {
  const cm = (o.widthMm / 10).toFixed(1);
  return o.whole ? `${cm} cm` : `at least ${cm} cm`;
}

function humpHeight(h: HumpDetection) {
  return h.over ? `over ${h.heightMm} mm` : `${h.heightMm} mm`;
}

function barcodeText(letter: string) {
  const command = BARCODE_COMMANDS[letter];
  return command ? `*${letter}* → ${command}` : `*${letter}*`;
}
