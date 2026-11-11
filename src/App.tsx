import { useState } from "react";
import { useRobocars } from "./useRobocars.ts";
import { BROADCAST_ID, CMD, formatCommand } from "./shared/protocol.ts";
import { TelemetryPanel } from "./components/TelemetryPanel.tsx";
import { DetectionsPanel } from "./components/DetectionsPanel.tsx";
import { CommandPanel } from "./components/CommandPanel.tsx";
import { LogPanel } from "./components/LogPanel.tsx";

export function App() {
  const { connection, cars, send, resetTallest } = useRobocars();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const carList = Object.values(cars).sort((a, b) => a.id.localeCompare(b.id));
  const selected = (selectedId && cars[selectedId]) || carList[0];

  return (
    <div className="app">
      <header className="topbar">
        <h1>Robocar dashboard</h1>
        <span className={`pill ${connection}`}>broker {connection}</span>
        <button
          className="danger"
          disabled={connection !== "connected"}
          onClick={() => send(BROADCAST_ID, "cmd", formatCommand(CMD.STOP, []))}
        >
          Stop all cars
        </button>
      </header>

      <div className="layout">
        <nav className="cars" aria-label="Cars">
          <h2>Cars</h2>
          {carList.length === 0 && <p className="muted">None yet.</p>}
          {carList.map((car) => (
            <button
              key={car.id}
              className={`car-tab ${car.id === selected?.id ? "selected" : ""}`}
              onClick={() => setSelectedId(car.id)}
            >
              <span className={`dot ${car.online ? "online" : "offline"}`} aria-hidden />
              {car.id}
              <span className="muted">{car.online ? "online" : "offline"}</span>
            </button>
          ))}
        </nav>

        {selected ? (
          <main className="car">
            <h2>
              {selected.id}{" "}
              <span className={`pill ${selected.online ? "connected" : "disconnected"}`}>
                {selected.online ? "online" : "offline"}
              </span>
            </h2>
            <TelemetryPanel car={selected} />
            <DetectionsPanel car={selected} resetTallest={resetTallest} />
            <div className="columns">
              <CommandPanel carId={selected.id} disabled={connection !== "connected"} send={send} />
              <LogPanel logs={selected.logs} />
            </div>
          </main>
        ) : (
          <main className="car empty">
            <p>No car has connected to the broker yet.</p>
            <p className="muted">
              Flash the Pico W with the broker's address in <code>config/wifi_secrets.h</code>, or run a simulated car
              with <code>npm run simulate</code>.
            </p>
          </main>
        )}
      </div>
    </div>
  );
}
