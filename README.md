# MSF Web SCADA & Energy Management System

A complete, production-grade **Web SCADA + EMS dashboard** for the MSF Substation electrical
network, built from the *MSF SCADA Annexure* technical specification (LK MC61CNX protection
relays, LK WL5010 Class 0.5 multifunction meters, RS485/Modbus RTU field layer, IEC 617-2-8
SLD, RBAC authority matrix, 14,000-tag architecture across 5 substations).

**Runs 100% standalone** — an isolated mock telemetry engine simulates all 5 substations with
animated live values, interactive breakers, protection trips and alarms. **No field hardware,
PLC, Raspberry Pi or server required.**

---

## Quick start

```bash
npm install
npm run dev        # → http://localhost:5173
```

Production build & preview:

```bash
npm run build      # typechecks (tsc -b) then bundles into dist/
npm run preview    # serves dist/ at http://localhost:4173
```

Full-scope automated self-test (drives the real app in headless Chrome through login,
RBAC, SBO trip/close, fault injection, all views — 43 assertions):

```bash
npm run selftest   # requires a dev server on :5173; uses installed Chrome
```

> Requires Node 18+. The app is a pure front-end SPA — deploy `dist/` to any static host
> (GitHub Pages, Netlify, Vercel, nginx) for a free presentation-grade deployment.

---

## Demo walkthrough (2 minutes)

| # | Do this | See this |
|---|---------|----------|
| 1 | Open the app | Executive Overview: MW / MVA / MVAr / PF / 50.00 Hz live KPIs, 5 substation health cards, 2050 carbon tracker, audit trail |
| 2 | Use the **Role** dropdown (top-right) → `Manager` | The authority matrix changes instantly; the critical-alarm bell and control surfaces unlock |
| 3 | Open **Single Line Diagram** → click any breaker | Bay Inspector: ON/OFF/TRIP, Spring Charged, Service/Test digital inputs + live IR/IY/IB/P/V/PF |
| 4 | As **Manager/Admin**, press **TRIP** | SBO wizard: purpose → interlocks → confirm → **PIN `1234`** → bus recolors red→green, annunciator fires, audit entry written |
| 5 | Press **⚡ Inject OC fault** (bay inspector) | Relay IDMT timer runs → breaker trips amber-flashing → trip record appears in the relay's 15+15 event log |
| 6 | Open **Protection Relays** | Live I_R/I_Y/I_B/I_N + CBCT, IDMT curve chart, TMS/curve settings editor (Engineer+), virtualized trip log |
| 7 | Open **MFM Analytics** | V_RY/YB/BR, V_R/Y/B, I_R/Y/B/N, kW/kVAr/kVA, PF, Hz, THD-V/I, harmonic spectrum, kWh/kVAh registers |
| 8 | Open **Alarms** → **ACK all** | Annunciator workflow with acknowledge-by identity (Operator+) |
| 9 | Open **Reports & Energy** | 5-report family (ENR/ANA/PRT/ALM/CMP) with ToD billing, analytics charts, ISO/BIS/NABL compliance, print + CSV |
| 10 | Open **Diagnostics** | Pi gateway heartbeats/packet-loss, Modbus block-register map, **Fault Injection Lab**, audit log, user admin |

### Demo accounts (sign-in screen)

| Username | Password | Role | Authority |
|----------|----------|------|-----------|
| `guest` | `guest` | Guest | Executive overview only — controls hidden |
| `operator1` | `operator1` | Operator | All screens + alarm acknowledgment; remote control disabled |
| `supervisor1` | `supervisor1` | Supervisor | + trend config, report scheduling, diagnostics |
| `engineer1` | `engineer1` | Engineer | + relay curve/TMS settings and threshold adjustment |
| `manager1` | `manager1` | **Manager** | **Breaker Trip/Close SBO terminal (PIN `1234`), trip reset, audit log** |
| `admin` | `admin` | **Admin** | **Full authority incl. user administration** |

Authority is bound to the **named account at sign-in** — there is no in-session role
switching (matches the Annexure access-control intent). To operate under a different
authority, **Sign out** (header, right) and sign in with the respective account; the
sign-in itself is recorded in the audit trail. Sessions persist across page refresh.

One-click role cards on the login screen fill the credentials automatically —
passwords simply match the username in this demo build (no backend).

Wrong PINs are logged as `SBO_REJECTED` in the audit trail — demonstrating the two-man rule.

---

## Architecture

```
src/
├── types/                     # Domain model & RBAC authority matrix
│   └── index.ts               #   Role/Permission, Breaker, Relay, Mfm, Gateway, Alarm, Audit
├── services/
│   └── mockTelemetryService.ts# ★ Mock telemetry engine (isolated, zero-hardware)
├── store/
│   └── useStore.ts            # Zustand store + 250 ms batched dispatch (Challenge 3)
├── components/
│   ├── ui.tsx                 # Panel / Kpi / Led / Badge / RoleGate / Modal primitives
│   └── SboModal.tsx           # Select-Before-Operate wizard (Challenge 2)
├── views/
│   ├── LoginView.tsx          # Sign-in screen with demo accounts + live plant strip
│   ├── DashboardView.tsx      # ★ SCADA control-room wall: annunciator fascia, VCB matrix, mimics
│   ├── OverviewView.tsx       # Executive KPIs, health cards, gauges
│   ├── SldView.tsx            # Interactive SLD (IEC 617-2-8) + bay inspector
│   ├── RelaysView.tsx         # IDMT relays: curves, settings, virtualized trip log
│   ├── MetersView.tsx         # MFM analytics: 3-φ, THD, harmonics, energy registers
│   ├── TrendsView.tsx         # Multi-pen trends + time-shift compare + CSV/print
│   ├── AlarmsView.tsx         # Annunciator with ack workflow
│   ├── ReportsView.tsx        # Report family hub: ENR/ANA/PRT/ALM/CMP documents
│   └── DiagnosticsView.tsx    # Gateway health, Modbus map, fault lab, audit, users
├── services/
│   ├── reportKit.ts           # Shared base-data model, doc control, digest, CSV helpers
│   └── reports/               # analytics · protection · alarms · compliance modules
├── App.tsx                    # Shell: header, nav, status bar, session restore
└── main.tsx                   # Bootstrap + telemetry connection
```

### Industrial engineering challenges → implemented solutions

| Challenge | Solution in code |
|-----------|------------------|
| **C1 — RS485 polling bottleneck** | Telemetry modelled as contiguous Modbus register **block reads** (BLK-1…BLK-6: status bitmask, voltages, currents, power, energy, relay blocks) — one burst per device per poll; visible in *Diagnostics → Modbus Register Map* |
| **C2 — Accidental switching / shock hazard** | Full **SBO** wizard: mandatory purpose → software interlock validation (LOCAL mode, TEST position, discharged spring, trip latch, **earth-fault Close interlock**, dead bus) → two-step confirm → PIN; all rejections audit-logged |
| **C3 — UI freeze at 14,000 tags** | Engine ticks at 250 ms into a **batched dispatch** store; SLD is pure SVG; trip log & tables are **virtualized**; React re-renders ≤ 4×/s |
| **C4 — Comms dropouts** | Per-gateway heartbeat, latency and packet-loss monitors; partitioned gateways freeze bays into amber **STALE / COMM_FAIL** state with annunciator alerts and auto-recovery events |
| **Breaker-fail protection** | 10% of injected faults arm a 50Z breaker-fail scenario: the breaker fails to open, the breaker-fail stage trips the upstream incomer and isolates the bus — mirroring the Annexure "breaker failure protection" + "upstream blocking" |

### Mock telemetry engine

- HT buses 11,000 V ±1.2% jitter; LT 415 V ±1.5% (Gaussian)
- Currents follow a daily load curve with Gaussian scatter; PF 0.94–0.99 lagging; 50.00 Hz ±0.05
- One relay per protected bay (3 OC elements + 1 EF via CBCT), IEC 60255 IDMT curves
  (SI/VI/EI/DT, TMS 0.01–1.60) — real operate-time math drives fault injection
- 15 OC + 15 EF historical trip records per relay (per Annexure), millisecond timestamps
- Breaker Trip/Close instantly updates global state, SLD colors, annunciator and audit trail

---

## Going live with real hardware (beyond the mock)

The engine is isolated behind `services/mockTelemetryService.ts`. To connect the real plant:

1. On each Raspberry Pi gateway run a Modbus RTU master over `RS485→USB` (9600 8-N-1, slave IDs 1–247)
   plus a Modbus TCP client for Delta/Honeywell PLCs — e.g. `pymodbus` or `node-modbus-serial`.
2. Buffer locally, then push the same JSON snapshot shape used here over **WebSocket/REST** with
   ≤16 ms timestamping (Annexure time-sync requirement).
3. Replace the tick source in `useStore.ts` (`connectTelemetry`) with your socket feed —
   every view, the SBO layer, RBAC and the alarm engine keep working unchanged.

---

## Deploying free (presentation-grade)

The production bundle is a static SPA with a relative base path, so it runs anywhere:

**GitHub Pages (automatic):** the repo contains `.github/workflows/deploy-pages.yml` —
push to `main` and enable *Settings → Pages → Source: GitHub Actions*. Done.

**Netlify / Vercel (drag-and-drop):** run `npm run build`, then drag the `dist/` folder
onto [app.netlify.com/drop](https://app.netlify.com/drop) — the included `public/_redirects`
handles SPA routing. A `dist.zip` is also provided for one-click uploads.

**Local LAN demo (no internet):** `npm run build && npm run preview` — or serve `dist/`
with any static server; control-room displays on the same network reach it via
`http://<your-ip>:4173`.

---

## Annexure compliance matrix

| MSF SCADA Annexure requirement | Where implemented |
|--------------------------------|-------------------|
| LK MC61CNX relays — 3 OC + 1 EF element, IDMT SI/VI/EI/DT curves, TMS 0.01–1.60 | `types` (Relay, IDMTCurve), `RelaysView` curve editor + IEC 60255 operate-time math |
| 15 OC + 15 EF trip records per relay, ms timestamps | Engine seeds 30 trips/relay; `RelaysView` virtualized trip log |
| 4 fault LEDs, trip-coil self-supervision, upstream blocking | Relay fleet list + detail panel, engine LED state, breaker-fail stage |
| LK WL5010 Class 0.5 MFM — line/phase voltages, per-phase PF, THD, neutral current, kWh/kVAh | `MetersView` full register layout + engine per-phase PF |
| RS485 Modbus RTU 9600 8-N-1, slave 1–247, 2 kV isolation | Status bar, gateway panels, Modbus register map (Diagnostics) |
| IEC 617-2-8 SLD with on/off/trip status | `SldView` interactive SVG, red/green/amber symbology |
| Tag matrix 14,000-tier across MRS/RF1/RF2/PR1/PR2 | `SUBSTATIONS` constants, overview cards & tag utilization KPI |
| Role access control (Guest → Admin authority matrix) | `types` RBAC matrix + login screen + RoleGate guards |
| Alarm acknowledgment workflow, user-defined alarms | `AlarmsView` annunciator with ack-by identity + audit trail |
| Trends: single/multiple parameter compare at two times, daily/weekly/monthly | `TrendsView` pens, Today-vs-Yesterday/Prev-Shift, 24 h/7 d/30 d windows |
| Scheduled reports (daily/weekly/shift/panel-wise), user-defined KPIs, e-mail list | `ReportsView` scheduler panel + CSV run-now exports |
| Time sync ≤ 16 ms; 250 ms UI batches | 250 ms engine tick & batched dispatch, ms-precision timestamps everywhere |
| Hyperlink with MSF-COMNET | Reports → MSF-COMNET bridge panel |
| Display wall 52" + web-client licences, server spec | Diagnostics gateways + Reports COMNET notes |

### Report family & audit alignment (ISO · BIS · NABL)

All five reports share **one base-data model** (`services/reportKit.ts`) — figures reconcile across documents by construction. Every
report is a controlled document with report number (`MSF/<series>/<SS>/<scope>/<seq>`), document ref + revision, an **FNV-1a integrity
digest** over the reconciled figures, declared standards, and a Prepared/Verified/Approved sign-off block. Print/PDF outputs the document
alone on white paper; CSV export mirrors the printed sections 1:1.

| Series | Report | Sections & analytics | Standards declared |
|--------|--------|----------------------|--------------------|
| **ENR** | Energy & Event Statement | Energy summary · feeder-wise consumption register · ToD tariff + billing computation · trip summary · substation comparison · Annexure A (alarms) · Annexure B (audit trail) · sign-off | ISO 50001:2018 §4.4, IS 16444, IEC 62053-22 Cl. 0.5S |
| **ANA** | Energy Analytics Report | ISO 50006 EnPI table (SEC vs FY24 baseline, load factor, peak-valley spread, reactive share, IEC 61724-1 data quality) · 2-h load profile · 168-h load-duration curve · ToD distribution · PF band profile · top-5 consumers | ISO 50001 §6.4, ISO 50006, IEC 61724-1 |
| **PRT** | Protection Performance Report | OC/EF statistics · phase distribution · measured-vs-IEC clearing-time verification per trip · relay settings register · IEEE 242 Buff note | IEC 60255-151, IEEE 242, IS 3231 |
| **ALM** | Alarm & SOE Analysis Report | ISA-18.2 metrics (rate/h, standing alarms, ack performance) · class distribution · severity mix pie · top sources · SOE annex (ms-resolution) | IEC 62682, ISA-18.2, IEC 61850-5 |
| **CMP** | Calibration & Compliance Report | ISO/IEC 17025 §7.8 calibration results (error vs class limit, uncertainty k=2, NABL certificate no., NPL traceability) · asset calibration register · time-sync verification (≤16 ms spec) · decision rule · lab conditions | ISO/IEC 17025:2017, IS 16444 / IS 13779, ISO 9001 §7.1.5 |

### Analytics & Range/Limit definitions inside the reports

Every report embeds its analytics charts plus a **Range & Limit Definitions** table — the exact nominal value, acceptable operating band,
hard limit and governing standard clause for each measured parameter (frequency, HT/LT voltage, PF, THD-V/THD-I per IEEE 519-2022,
unbalance per IEC 61000-2-2, CBCT leakage, IEC 60255 clearing time + IEEE 242 300 ms Buff, ISA-18.2 alarm-rate/ack targets, load factor &
SEC EnPI bands, ≤16 ms SOE accuracy, 0.5S class error). Chart reference lines (amber alarm / red hard-limit) correspond 1:1 to these rows.
Highlights per series: **ANA** donut (ToD share), EnPI gauges, feeder histogram, THD-V & TDD area charts vs IEEE 519 limits ·
**PRT** measured-vs-IEC conformance with 300 ms Buff line · **ALM** alarm-rate gauge, ack-time histogram, standing-vs-acked donut ·
**CMP** pass/fail conformity donut. The same definitions are appended to every CSV export.

---

*Built with React 18 + TypeScript + Vite + Tailwind CSS + Zustand + Recharts + Lucide.
Specification source: MSF SCADA Annexure (Technical Specification — Electrical Assets Metering
& Monitoring through SCADA).*
