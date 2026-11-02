# mqtt-web-interface

The other end of the car's MQTT client: an MQTT broker and a web dashboard
for watching the cars' telemetry and logs and sending them commands.

```
  Pico W car ──MQTT/TCP :1883──┐
                               ├── broker (Aedes, in server/) ──┐
  simulated car ──MQTT/TCP ────┘                                │
                                                                │
  browser (dashboard) ──MQTT over WebSocket, :8080/mqtt ────────┘
```

The dashboard is itself an MQTT client: the browser subscribes and publishes
directly. The server only runs the broker and serves the page.

## Run it

Needs Node.js 22.18 or newer (it runs the TypeScript directly).

```sh
npm install
npm start          # builds the dashboard, then serves it
```

Open <http://localhost:8080/>. On start-up the server prints this computer's
addresses; put one in the car's `config/wifi_secrets.h` as `MQTT_BROKER_IP`.

No car to hand? Run a simulated one in a second terminal. It speaks the same
protocol as the firmware:

```sh
npm run simulate                 # a car called robocar-sim
npm run simulate -- robocar-02   # and another
```

| Command | What it does |
|---|---|
| `npm run dev` | Same as `start`, but the page reloads as you edit `src/`, and the server restarts when you edit `server/` |
| `npm test` | Checks `protocol.ts`, including that it decodes the car's own test sample |
| `npm run typecheck` | Type-checks everything |

Ports: `MQTT_PORT` (default 1883) and `HTTP_PORT` (default 8080).
`VERBOSE=1` also logs every telemetry sample in the server console.

**WSL users:** the car must reach the broker over the Wi-Fi network, but WSL
normally sits behind its own private network. Either turn on WSL's mirrored
networking (`networkingMode=mirrored` in `%UserProfile%\.wslconfig`) or run
this folder from Windows itself, and allow port 1883 through the Windows
firewall.

## Where things are

```
server/
  main.ts            starts the broker (TCP + WebSocket) and serves the dashboard
  broker.ts          the Aedes broker, plus a readable console log of traffic
scripts/
  fake-car.ts        the simulated car
src/
  shared/protocol.ts topics, commands, telemetry bit layout (copy of the car's protocol.h)
  useRobocars.ts     the dashboard's MQTT connection and state: everything heard, per car
  App.tsx            page layout: car list, then the selected car
  components/        TelemetryPanel, Sparkline, CommandPanel, LogPanel
  styles.css         all styling; colours for light and dark mode are at the top
```

The stack is deliberately small: [Aedes](https://github.com/moscajs/aedes)
(an MQTT broker as a Node library), [Express](https://expressjs.com/) to serve
files, [MQTT.js](https://github.com/mqttjs/MQTT.js) for the clients,
[React](https://react.dev/) for the page and [Vite](https://vite.dev/) to build
it. There is no router, state library or CSS framework: state is one reducer
in `useRobocars.ts`, and components are plain functions of it.

## Changing what the car sends or accepts

Everything about the protocol is in `src/shared/protocol.ts`, and the
dashboard draws itself from it:

- **New telemetry field:** add an entry to `TELEMETRY_FIELDS` (offset, bits,
  label, unit; `chart: { min, max }` for a history chart). A tile appears.
- **New command or setting:** add an entry to `COMMANDS` or `SETTINGS`. A form
  row with one input per argument appears.

Then make the same change in the car's `app_program/protocol.h` and in the task
that handles it, and update the golden sample in `protocol.test.ts` and the
car's `app_program/comms/comms_test.c` if the telemetry layout changed. `npm test` and the
car's `make NET=lwip TEST=1` build both check that sample, so a mismatch shows
up as a failing test rather than wrong numbers on screen.

**New panel:** write a component in `src/components/` that takes a `Car`
(from `useRobocars.ts`) and add it to `App.tsx`. To show a new topic, add it
to the `subscribe` call in `useRobocars.ts` and handle its leaf in `reducer()`.

## Notes

- The broker accepts anyone on the network, with no password or TLS. Fine on
  a lab network; do not expose port 1883 or 8080 to the internet.
- The broker keeps nothing on disk. Retained `status` messages last until it
  restarts; the dashboard shows history only from when the page was opened.
- Commands are published with QoS 1 and never retained, so a car that
  reconnects does not replay an old drive command.
