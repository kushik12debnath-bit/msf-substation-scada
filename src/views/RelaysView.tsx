import { useEffect, useMemo, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { Download, ShieldAlert, SlidersHorizontal } from 'lucide-react'
import { Badge, Led, Panel, RoleGate, fmt, fmtMs } from '../components/ui'
import { CURVE_LABEL, IDMTCurve, Relay, SubstationId, SUBSTATIONS } from '../types'
import { idmtOperateTime, RelayTripRecord, telemetryEngine } from '../services/mockTelemetryService'
import { useStore } from '../store/useStore'

/* ------------------------------ IDMT curve -------------------------------- */

function CurveChart({ relay }: { relay: Relay }) {
  const W = 460, H = 210, padL = 46, padB = 24, padT = 12, padR = 10
  const mults = [1.05, 1.2, 1.5, 2, 3, 4, 6, 8, 10, 14, 20]
  const t = mults.map((m) => idmtOperateTime(relay, relay.pickupA * m))
  const xMin = 1, xMax = 20, yMax = Math.max(2, Math.min(30, Math.max(...t.filter(Number.isFinite))))
  const xlog = (m: number) => padL + ((Math.log10(m) - Math.log10(xMin)) / (Math.log10(xMax) - Math.log10(xMin))) * (W - padL - padR)
  const yPix = (s: number) => H - padB - (Math.min(s, yMax) / yMax) * (H - padB - padT)
  const path = mults.map((m, i) => `${i ? 'L' : 'M'} ${xlog(m).toFixed(1)} ${yPix(t[i]).toFixed(1)}`).join(' ')
  const ticks = [1, 2, 3, 5, 10, 20]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      <rect x={padL} y={padT} width={W - padL - padR} height={H - padB - padT} fill="#0B0F17" stroke="#1C2536" />
      {ticks.map((m) => (
        <g key={m}>
          <line x1={xlog(m)} y1={padT} x2={xlog(m)} y2={H - padB} stroke="#1B2537" />
          <text x={xlog(m)} y={H - padB + 12} fontSize={8} fill="#64748B" textAnchor="middle">{m}×</text>
        </g>
      ))}
      {[0.25, 0.5, 1, 2, 5, 10, 20].filter((s) => s <= yMax).map((s) => (
        <g key={s}>
          <line x1={padL} y1={yPix(s)} x2={W - padR} y2={yPix(s)} stroke="#1B2537" />
          <text x={padL - 4} y={yPix(s) + 3} fontSize={8} fill="#64748B" textAnchor="end">{s}s</text>
        </g>
      ))}
      <path d={path} fill="none" stroke="#22D3EE" strokeWidth={2} />
      <line x1={xlog(1.05)} y1={padT} x2={xlog(1.05)} y2={H - padB} stroke="#FBBF24" strokeDasharray="3 3" opacity={0.7} />
      <text x={xlog(1.05) + 4} y={padT + 10} fontSize={8} fill="#FBBF24">pickup</text>
      <text x={W / 2} y={H - 2} fontSize={8.5} fill="#94A3B8" textAnchor="middle">{CURVE_LABEL[relay.curve]} · TMS {relay.tms} · I&gt; {relay.pickupA} A</text>
    </svg>
  )
}

/* ------------------------------ settings editor --------------------------- */

function RelaySettingsEditor({ relay }: { relay: Relay }) {
  const user = useStore((s) => s.user)
  const [curve, setCurve] = useState<IDMTCurve>(relay.curve)
  const [tms, setTms] = useState(relay.tms)
  const [pickup, setPickup] = useState(relay.pickupA)
  const [inst, setInst] = useState(relay.instPickupA)
  const [earth, setEarth] = useState(relay.earthPickupA)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setCurve(relay.curve); setTms(relay.tms); setPickup(relay.pickupA); setInst(relay.instPickupA); setEarth(relay.earthPickupA)
  }, [relay.id])

  const dirty = curve !== relay.curve || tms !== relay.tms || pickup !== relay.pickupA || inst !== relay.instPickupA || earth !== relay.earthPickupA

  const save = () => {
    telemetryEngine.updateRelaySettings(relay.id, { curve, tms, pickupA: pickup, instPickupA: inst, earthPickupA: earth }, user.displayName)
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1800)
  }

  return (
    <div className="space-y-2.5 text-xs">
      <RoleGate perm="edit_relay_settings" fallback={
        <div className="border border-amber-500/30 bg-amber-500/5 rounded p-2 text-[11px] text-amber-300/90">
          🔒 Relay settings modification requires <b>Engineer</b> role or above.
        </div>
      }>
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1 col-span-2">
            <span className="text-slate-500 text-[10px] uppercase tracking-wider">IDMT Curve</span>
            <select value={curve} onChange={(e) => setCurve(e.target.value as IDMTCurve)} className="w-full bg-ink-900 border border-ink-500 rounded px-2 py-1.5">
              {Object.entries(CURVE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-slate-500 text-[10px] uppercase tracking-wider">TMS ({tms.toFixed(2)})</span>
            <input type="range" min={0.01} max={1.6} step={0.01} value={tms} onChange={(e) => setTms(+e.target.value)} className="w-full accent-cyan-400" />
          </label>
          <label className="space-y-1">
            <span className="text-slate-500 text-[10px] uppercase tracking-wider">I&gt; Pickup (A)</span>
            <input type="number" value={pickup} min={10} step={10} onChange={(e) => setPickup(+e.target.value)} className="w-full num bg-ink-900 border border-ink-500 rounded px-2 py-1.5" />
          </label>
          <label className="space-y-1">
            <span className="text-slate-500 text-[10px] uppercase tracking-wider">I&gt;&gt; Instantaneous (A)</span>
            <input type="number" value={inst} min={50} step={50} onChange={(e) => setInst(+e.target.value)} className="w-full num bg-ink-900 border border-ink-500 rounded px-2 py-1.5" />
          </label>
          <label className="space-y-1">
            <span className="text-slate-500 text-[10px] uppercase tracking-wider">Ie&gt; Earth pickup (A)</span>
            <input type="number" value={earth} min={5} step={5} onChange={(e) => setEarth(+e.target.value)} className="w-full num bg-ink-900 border border-ink-500 rounded px-2 py-1.5" />
          </label>
        </div>
        <div className="flex items-center gap-2">
          <button disabled={!dirty} onClick={save} className="btn-primary flex-1 disabled:opacity-40 flex items-center justify-center gap-1.5">
            <SlidersHorizontal size={12} /> Commit settings to relay
          </button>
          {saved && <span className="text-green-400 text-[11px]">✓ written to audit trail</span>}
        </div>
        <p className="text-[10px] text-slate-500">
          Operate time @3× pickup: <b className="text-volt-cyan">{(() => { const t = idmtOperateTime({ curve, tms, pickupA: pickup, earthPickupA: earth, instPickupA: inst }, pickup * 3); return Number.isFinite(t) ? `${t.toFixed(2)} s` : '∞' })()}</b> · draw-out type · 15 OC / 15 EF trip memory · blocking to upstream relay enabled
        </p>
      </RoleGate>
    </div>
  )
}

/* -------------------------------- trip table ------------------------------ */

function TripTable({ trips }: { trips: RelayTripRecord[] }) {
  const ROW_H = 26, VIEWPORT = 240
  const ref = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const total = trips.length
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - 4)
  const visible = Math.ceil(VIEWPORT / ROW_H) + 8
  const slice = trips.slice(first, first + visible)

  return (
    <div className="text-[11px]">
      <div className="grid grid-cols-[100px_58px_46px_1fr_86px_70px] gap-1 px-2 py-1 text-[9px] uppercase tracking-widest text-slate-500 border-b border-ink-700 sticky top-0 bg-ink-850">
        <span>Timestamp</span><span>Type</span><span>Ph</span><span>Fault current</span><span>Clearing</span><span>Curve/TMS</span>
      </div>
      <div
        ref={ref}
        onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
        style={{ height: VIEWPORT, overflowY: 'auto' }}
        className="virtual-scroll"
      >
        <div style={{ height: total * ROW_H, position: 'relative' }}>
          {slice.map((t, i) => (
            <div
              key={t.id}
              className={clsx('absolute w-full grid grid-cols-[100px_58px_46px_1fr_86px_70px] gap-1 px-2 items-center rounded',
                t.type === 'OC' ? 'hover:bg-red-500/5' : 'hover:bg-violet-500/5')}
              style={{ top: (first + i) * ROW_H, height: ROW_H }}
            >
              <span className="num text-slate-400">{fmtMs(t.ts)}</span>
              <span><Badge tone={t.type === 'OC' ? 'red' : 'violet'}>{t.type === 'OC' ? 'I>' : 'Ie>'}</Badge></span>
              <span className="num text-slate-400">{t.phase}</span>
              <span className="num text-slate-200">{fmt(t.faultA, 0)} A <span className="text-slate-500">/ pkp {fmt(t.pickupA, 0)} A ({(t.faultA / t.pickupA).toFixed(1)}×)</span></span>
              <span className="num text-amber-300">{t.clearingMs} ms</span>
              <span className="num text-slate-500">{CURVE_LABEL[t.curve].split(' ')[0]} · {t.tms}</span>
            </div>
          ))}
        </div>
      </div>
      <p className="text-[9px] text-slate-600 px-2 pt-1">{total.toLocaleString()} trip records · virtualized rendering (Challenge 3) · millisecond timestamps</p>
    </div>
  )
}

/* ---------------------------------- view ---------------------------------- */

export default function RelaysView() {
  const snap = useStore((s) => s.snap)
  const selectedSubstation = useStore((s) => s.selectedSubstation)
  const [ssFilter, setSsFilter] = useState<SubstationId | 'ALL'>(selectedSubstation)
  const [relayId, setRelayId] = useState<string | null>(null)

  const relays = snap?.relays ?? []
  const filtered = useMemo(() => (ssFilter === 'ALL' ? relays : relays.filter((r) => r.substation === ssFilter)), [relays, ssFilter])
  const relay = useMemo(() => relays.find((r) => r.id === relayId) ?? filtered[0] ?? null, [relays, relayId, filtered])
  const relayTrips = useMemo(() => (relay ? telemetryEngine.getRelayTrips(relay.id) : []), [relay, snap])

  if (!snap) return null

  return (
    <div className="h-full flex flex-col xl:flex-row gap-3 p-3 min-h-0">
      {/* Fleet list */}
      <div className="xl:w-[330px] shrink-0 flex flex-col gap-2 min-h-0">
        <div className="flex items-center gap-1 panel p-1 text-xs">
          <button
            onClick={() => setSsFilter('ALL')}
            className={clsx('px-2 py-1 rounded flex-1', ssFilter === 'ALL' ? 'bg-cyan-500/15 text-volt-cyan' : 'text-slate-400')}
          >ALL</button>
          {SUBSTATIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSsFilter(s.id)}
              className={clsx('px-2 py-1 rounded flex-1', ssFilter === s.id ? 'bg-cyan-500/15 text-volt-cyan' : 'text-slate-400')}
            >{s.id}</button>
          ))}
        </div>
        <Panel title={`Relay Fleet — ${filtered.length} units (LK MC61CNX class)`} className="flex-1 min-h-0">
          <div className="overflow-auto h-full space-y-1">
            {filtered.map((r) => {
              const b = snap.breakers.find((x) => x.id === r.breakerId)
              const faultLed = r.ledFault.some(Boolean)
              return (
                <button
                  key={r.id}
                  onClick={() => setRelayId(r.id)}
                  className={clsx('w-full text-left px-2 py-1.5 rounded border text-[11px] flex items-center gap-2',
                    relay?.id === r.id ? 'border-volt-cyan bg-cyan-500/10' : 'border-ink-700 hover:border-ink-500')}
                >
                  <Led color={faultLed ? 'red' : b?.state === 'closed' ? 'green' : 'gray'} size={7} flash={faultLed} />
                  <span className="num text-slate-200 w-20 truncate">{r.name}</span>
                  <span className="text-slate-500">{r.substation}</span>
                  <span className="ml-auto num text-slate-400">{fmt(Math.max(r.ir, r.iy, r.ib), 0)} A</span>
                  {r.lastTripAt && Date.now() - r.lastTripAt < 30000 && <Badge tone="red">TRIP</Badge>}
                </button>
              )
            })}
          </div>
        </Panel>
      </div>

      {/* Detail */}
      {relay && (
        <div className="flex-1 min-w-0 overflow-auto space-y-3">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <Panel title={`${relay.name} — live elements`} className="lg:col-span-2">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center mb-3">
                <div className="panel py-2"><div className="num text-lg text-volt-red">{fmt(relay.ir, 1)}</div><div className="text-[9px] text-slate-500">I_R (A)</div></div>
                <div className="panel py-2"><div className="num text-lg text-volt-amber">{fmt(relay.iy, 1)}</div><div className="text-[9px] text-slate-500">I_Y (A)</div></div>
                <div className="panel py-2"><div className="num text-lg text-volt-blue">{fmt(relay.ib, 1)}</div><div className="text-[9px] text-slate-500">I_B (A)</div></div>
                <div className="panel py-2"><div className="num text-lg text-violet-300">{fmt(relay.iN, 1)}</div><div className="text-[9px] text-slate-500">I_N (A)</div></div>
                <div className="panel py-2"><div className="num text-lg text-slate-200">{fmt(relay.cbctLeakage * 1000, 1)}</div><div className="text-[9px] text-slate-500">CBCT (mA)</div></div>
                <div className="panel py-2"><div className="num text-lg text-slate-200">{relay.pickupA}</div><div className="text-[9px] text-slate-500">I&gt; pickup</div></div>
                <div className="panel py-2"><div className="num text-lg text-slate-200">{relay.ocTripCount} / {relay.efTripCount}</div><div className="text-[9px] text-slate-500">OC / EF trips</div></div>
                <div className="panel py-2 flex flex-col items-center justify-center gap-1">
                  <div className="flex gap-1">{relay.ledFault.map((on, i) => <Led key={i} color={on ? 'red' : 'gray'} size={9} flash={on} />)}</div>
                  <div className="text-[9px] text-slate-500">4× fault LEDs</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                <span className="text-slate-500">Model</span><span className="text-slate-300 text-right">{relay.model}</span>
                <span className="text-slate-500">Curve</span><span className="text-slate-300 text-right">{CURVE_LABEL[relay.curve]}</span>
                <span className="text-slate-500">TMS</span><span className="num text-slate-300 text-right">{relay.tms.toFixed(2)}</span>
                <span className="text-slate-500">Trip coil</span><span className={clsx('text-right', relay.tripCoilHealthy ? 'text-green-300' : 'text-red-300')}>{relay.tripCoilHealthy ? 'HEALTHY' : 'FAIL — self-supervision'}</span>
                <span className="text-slate-500">Upstream blocking</span><span className="text-slate-300 text-right">enabled</span>
                <span className="text-slate-500">Modbus RTU</span><span className="num text-slate-300 text-right">slave {relay.slaveId} @ 9600 8-N-1</span>
              </div>
            </Panel>

            <Panel title="IDMT Characteristic (IEC 60255)">
              <CurveChart relay={relay} />
            </Panel>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Panel title="Relay Configuration — thresholds & curve" right={<ShieldAlert size={12} className="text-slate-500" />}>
              <RelaySettingsEditor relay={relay} />
            </Panel>
            <Panel
              title="Trip Event Log — 15 OC + 15 EF history"
              right={
                <button
                  className="text-[11px] text-volt-cyan hover:underline flex items-center gap-1"
                  onClick={() => exportTripsCsv(relay, telemetryEngine.getRelayTrips(relay.id))}
                ><Download size={11} /> CSV</button>
              }
            >
              <TripTable trips={relayTrips} />
            </Panel>
          </div>
        </div>
      )}
    </div>
  )
}

function exportTripsCsv(relay: Relay, trips: RelayTripRecord[]) {
  const rows = [
    'timestamp,relay,type,phase,fault_A,pickup_A,clearing_ms,curve,tms',
    ...trips.map((t) => [new Date(t.ts).toISOString(), relay.name, t.type, t.phase, t.faultA.toFixed(1), t.pickupA, t.clearingMs, t.curve, t.tms].join(',')),
  ]
  download('relay-trips.csv', rows.join('\n'))
}

export function download(name: string, content: string, mime = 'text/csv') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}
