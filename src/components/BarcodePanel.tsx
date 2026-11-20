/**
 * Barcode plan (Ruien): every barcode for the day in one list, and what each
 * one means at the next T. "Send all" makes the car ignore everything, then
 * sets each row, then asks for the map, so the car ends up with exactly this
 * list and its log shows it. The list is kept in this browser, so after a car
 * restart one click sends it again.
 */
import { useState } from "react";
import { BARCODE_CFG, BARCODE_CHARS, BARCODE_DIRS, formatCommand } from "../shared/protocol.ts";

interface BarcodeRow {
  code: number; // ASCII code of '0'-'9' / 'A'-'Z'
  dir: number; // BARCODE_DIRS value
}

const PLAN_KEY = "barcodePlan";

// The car queues only 4 settings (its telemetry task's message buffer), so
// Send all spaces them out.
const SEND_GAP_MS = 200;

function loadPlan(): BarcodeRow[] {
  try {
    const saved = JSON.parse(localStorage.getItem(PLAN_KEY) ?? "null");
    if (Array.isArray(saved)) return saved as BarcodeRow[];
  } catch {
    // No storage here (private window): start with one row.
  }
  return [{ code: 65, dir: 0 }];
}

export function BarcodePanel({ disabled, onSend }: { disabled: boolean; onSend: (text: string) => void }) {
  const [rows, setRows] = useState<BarcodeRow[]>(loadPlan);

  const update = (next: BarcodeRow[]) => {
    setRows(next);
    try {
      localStorage.setItem(PLAN_KEY, JSON.stringify(next));
    } catch {
      // Not saved; the list still works until the page is closed.
    }
  };

  const sendAll = () => {
    const texts = [
      formatCommand(BARCODE_CFG.CLEAR, []),
      ...rows.map((r) => formatCommand(BARCODE_CFG.DIR, [r.code, r.dir])),
      formatCommand(BARCODE_CFG.SHOW, []),
    ];
    texts.forEach((text, i) => setTimeout(() => onSend(text), i * SEND_GAP_MS));
  };

  return (
    <>
      <h3>Barcode plan</h3>
      <p className="small muted">
        All of the day's barcodes. <b>Send all</b> replaces the car's whole list; send it again after the car
        restarts. The car's log shows its list, e.g. <code>barcodes: A=L K=R</code>.
      </p>
      {rows.map((r, i) => (
        <div className="row" key={i}>
          <label className="arg">
            <span className="small muted">barcode</span>
            <select
              value={r.code}
              onChange={(e) => update(rows.map((x, j) => (j === i ? { ...x, code: Number(e.target.value) } : x)))}
            >
              {BARCODE_CHARS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="arg">
            <span className="small muted">direction</span>
            <select
              value={r.dir}
              onChange={(e) => update(rows.map((x, j) => (j === i ? { ...x, dir: Number(e.target.value) } : x)))}
            >
              {BARCODE_DIRS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" aria-label="Remove this barcode" onClick={() => update(rows.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      <div className="row">
        <button type="button" onClick={() => update([...rows, { code: 65, dir: 0 }])}>
          + Add barcode
        </button>
        <button type="button" disabled={disabled || rows.length === 0} onClick={sendAll}>
          Send all ({rows.length})
        </button>
        <button type="button" disabled={disabled} onClick={() => onSend(formatCommand(BARCODE_CFG.SHOW, []))}>
          Show car's list
        </button>
        <button type="button" disabled={disabled} onClick={() => onSend(formatCommand(BARCODE_CFG.CLEAR, []))}>
          Ignore all
        </button>
      </div>
    </>
  );
}
