/**
 * Forms for sending commands and settings. One row is drawn for each entry
 * in COMMANDS and SETTINGS (protocol.ts), so a new command only needs adding
 * there. The raw box sends any text, e.g. to test how the car handles
 * something malformed.
 */
import { useState } from "react";
import { BROADCAST_ID, COMMANDS, SETTINGS, formatCommand, type MessageDef } from "../shared/protocol.ts";

type Send = (carId: string, leaf: "cmd" | "config", text: string) => void;

interface Props {
  carId: string;
  disabled: boolean;
  send: Send;
}

export function CommandPanel({ carId, disabled, send }: Props) {
  const [toAll, setToAll] = useState(false);
  const [raw, setRaw] = useState("");
  const [rawLeaf, setRawLeaf] = useState<"cmd" | "config">("cmd");

  return (
    <section className="panel">
      <h3>Commands</h3>
      <label className="small">
        <input type="checkbox" checked={toAll} onChange={(e) => setToAll(e.target.checked)} /> Send commands to all cars
        (<code>robocar/all/cmd</code>)
      </label>
      {COMMANDS.map((def) => (
        <MessageForm
          key={def.id}
          def={def}
          disabled={disabled}
          onSend={(text) => send(toAll ? BROADCAST_ID : carId, "cmd", text)}
        />
      ))}

      <h3>Settings</h3>
      {SETTINGS.map((def) => (
        <MessageForm key={def.id} def={def} disabled={disabled} onSend={(text) => send(carId, "config", text)} />
      ))}

      <h3>Raw</h3>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (raw.trim()) send(carId, rawLeaf, raw.trim());
        }}
      >
        <select value={rawLeaf} onChange={(e) => setRawLeaf(e.target.value as "cmd" | "config")}>
          <option value="cmd">cmd</option>
          <option value="config">config</option>
        </select>
        <input
          className="grow"
          value={raw}
          placeholder="e.g. 2 60 -20 1500"
          aria-label="Raw payload"
          onChange={(e) => setRaw(e.target.value)}
        />
        <button disabled={disabled}>Send</button>
      </form>
    </section>
  );
}

function MessageForm({
  def,
  disabled,
  onSend,
}: {
  def: MessageDef;
  disabled: boolean;
  onSend: (text: string) => void;
}) {
  const [args, setArgs] = useState(() => def.args.map((a) => a.default));

  return (
    <form
      className="row"
      title={def.description}
      onSubmit={(e) => {
        e.preventDefault();
        onSend(formatCommand(def.id, args));
      }}
    >
      <span className="command-name">
        {def.name} <span className="muted">#{def.id}</span>
      </span>
      {def.args.map((a, i) => (
        <label key={a.name} className="arg">
          <span className="small muted">
            {a.name}
            {a.unit ? ` (${a.unit})` : ""}
          </span>
          <input
            type="number"
            min={a.min}
            max={a.max}
            value={args[i]}
            onChange={(e) => setArgs(args.map((v, j) => (j === i ? Number(e.target.value) : v)))}
          />
        </label>
      ))}
      <button disabled={disabled}>Send</button>
    </form>
  );
}
