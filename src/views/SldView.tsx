import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { Crosshair, Minus, Plus } from 'lucide-react'
import { Badge, Led, Panel, RoleGate, fmt, fmtTime } from '../components/ui'
import { Breaker, SubstationId, SUBSTATIONS } from '../types'
import { telemetryEngine, useStore } from '../store/useStore'

/* ============================================================================
 * Interactive Single Line Diagram — IEC 617-2-8 symbology
 *   Red   = breaker CLOSED / bus energized
 *   Green = breaker OPEN / line de-energized
 *   Amber flashing = breaker TRIPPED
 * ==========================================================================*/

const COL = {
  energized: '#F87171',
  dead: '#4ADE80',
  tripped: '#FBBF24',
  bus: '#CBD5E1',
  dim: '#3A4664',
  text: '#94A3B8',
}

/* ------------------------------- SVG pieces ------------------------------- */

function VcbSymbol({ x, y, closed, tripped, selected, onClick, label, commOk, local }: {
  x: number; y: number; closed: boolean; tripped: boolean
  selected: boolean; onClick: () => void; label: string; commOk: boolean; local: boolean
}) {
  const stroke = tripped ? COL.tripped : closed ? COL.energized : COL.dead
  const fill = closed && !tripped
  return (
    <g transform={`translate(${x},${y})`} onClick={onClick} className="cursor-pointer">
      {selected && <rect x={-14} y={-22} width={28} height={52} rx={4} fill="none" stroke="#22D3EE" strokeWidth={1.4} strokeDasharray="3 3" />}
      <line x1={0} y1={-16} x2={0} y2={-8} stroke={COL.dim} strokeWidth={1.6} />
      <line x1={0} y1={8} x2={0} y2={16} stroke={COL.dim} strokeWidth={1.6} />
      <rect x={-5.5} y={-8} width={11} height={7} fill={fill ? stroke : 'none'} stroke={stroke} strokeWidth={1.8} />
      <rect x={-5.5} y={1} width={11} height={7} fill={fill ? stroke : 'none'} stroke={stroke} strokeWidth={1.8} />
      {tripped && <circle cx={0} cy={0} r={11} fill="none" stroke={COL.tripped} strokeWidth={1.2} className="animate-flash" />}
      <text x={0} y={-20} textAnchor="middle" fontSize={7.5} fill={COL.text} className="num select-none">{label}</text>
      {!commOk && <text x={12} y={-6} fontSize={6.5} fill="#FBBF24" className="animate-flash">STALE</text>}
      {local && <text x={12} y={3} fontSize={6.5} fill="#A78BFA">LOC</text>}
    </g>
  )
}

/** One feeder bay hanging from a row stub */
function FeederBranch({ x, stubY, b, energized, selected, onSelect }: {
  x: number; stubY: number; b: Breaker; energized: boolean; selected: boolean; onSelect: () => void
}) {
  const tripped = b.state === 'tripped'
  const wire = energized ? COL.energized : COL.dim
  const vcbY = stubY + 26
  return (
    <g>
      <line x1={x} y1={stubY} x2={x} y2={vcbY - 16} stroke={wire} strokeWidth={1.3} />
      <VcbSymbol
        x={x} y={vcbY}
        closed={b.state === 'closed'} tripped={tripped}
        selected={selected} onClick={onSelect}
        label={b.name} commOk={b.commOk} local={b.remoteLocal === 'local'}
      />
      <line x1={x} y1={vcbY + 16} x2={x} y2={vcbY + 34} stroke={wire} strokeWidth={1.3} />
      {energized && <path d={`M ${x - 3} ${vcbY + 30} L ${x + 3} ${vcbY + 30} L ${x} ${vcbY + 35} Z`} fill={COL.energized} />}
      {b.voltage === 'lt' && (
        <g transform={`translate(${x}, ${vcbY + 44})`}>
          <circle cx={0} cy={0} r={5.5} fill="none" stroke={COL.dim} strokeWidth={1.2} />
          <circle cx={0} cy={7} r={5.5} fill="none" stroke={COL.dim} strokeWidth={1.2} />
        </g>
      )}
    </g>
  )
}

/* ------------------------------ breaker detail ----------------------------- */

function BreakerInspector({ b }: { b: Breaker }) {
  const snap = useStore((s) => s.snap)
  const user = useStore((s) => s.user)
  const canCtrl = useStore((s) => s.can('breaker_control'))
  const canInject = useStore((s) => s.can('fault_injection'))
  const openSbo = useStore((s) => s.openSbo)
  const mfm = snap?.mfms.find((m) => m.breakerId === b.id)
  const relay = snap?.relays.find((r) => r.breakerId === b.id)
  const energized = telemetryEngine.feederEnergized(b)

  const doSbo = (command: 'trip' | 'close' | 'trip-reset') =>
    openSbo({ breakerId: b.id, command, purpose: '', step: 'purpose' })

  return (
    <Panel
      title={`Bay Inspector — ${b.name}`}
      right={<Badge tone={b.state === 'closed' ? 'red' : b.state === 'tripped' ? 'amber' : 'green'}>{b.state.toUpperCase()}{energized ? ' · LIVE' : ''}</Badge>}
    >
      <div className="space-y-3 text-xs">
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          <span className="text-slate-500">Substation</span><span className="text-slate-200 text-right">{b.substation} · Bus-{b.bus}</span>
          <span className="text-slate-500">Type</span><span className="text-slate-200 text-right">{b.kind === 'incomer' ? '11 kV Incomer' : b.kind === 'buscoupler' ? 'Bus Coupler' : b.voltage === 'lt' ? 'LT Feeder (415 V)' : 'HT Feeder (11 kV)'}</span>
          <span className="text-slate-500">Modbus slave</span><span className="num text-slate-200 text-right">{b.slaveId}</span>
          <span className="text-slate-500">Remote/Local</span><span className={clsx('text-right', b.remoteLocal === 'remote' ? 'text-green-300' : 'text-violet-300')}>{b.remoteLocal.toUpperCase()}</span>
          <span className="text-slate-500">Position</span><span className={clsx('text-right', b.inService ? 'text-green-300' : 'text-amber-300')}>{b.inService ? 'SERVICE' : 'TEST'}</span>
          <span className="text-slate-500">Spring</span><span className={clsx('text-right', b.springCharged ? 'text-green-300' : 'text-red-300')}>{b.springCharged ? 'CHARGED' : 'DISCHARGED'}</span>
          <span className="text-slate-500">Trip latch</span><span className={clsx('text-right', b.tripLatch ? 'text-red-300' : 'text-green-300')}>{b.tripLatch ? 'ACTIVE' : 'clear'}</span>
          <span className="text-slate-500">EF latch</span><span className={clsx('text-right', b.earthFaultLatch ? 'text-red-300' : 'text-green-300')}>{b.earthFaultLatch ? 'ACTIVE' : 'clear'}</span>
          <span className="text-slate-500">Communication</span><span className={clsx('text-right', b.commOk ? 'text-green-300' : 'text-amber-300')}>{b.commOk ? 'OK' : 'STALE / COMM_FAIL'}</span>
          <span className="text-slate-500">Last update</span><span className="num text-slate-200 text-right">{fmtTime(b.lastUpdate)}</span>
        </div>

        {mfm && (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="panel py-1.5"><div className="num text-sm text-volt-red">{fmt(mfm.iR, 0)} A</div><div className="text-[9px] text-slate-500">I_R</div></div>
            <div className="panel py-1.5"><div className="num text-sm text-volt-amber">{fmt(mfm.iY, 0)} A</div><div className="text-[9px] text-slate-500">I_Y</div></div>
            <div className="panel py-1.5"><div className="num text-sm text-volt-blue">{fmt(mfm.iB, 0)} A</div><div className="text-[9px] text-slate-500">I_B</div></div>
            <div className="panel py-1.5"><div className="num text-xs text-slate-200">{fmt(mfm.kW, 0)} kW</div><div className="text-[9px] text-slate-500">P</div></div>
            <div className="panel py-1.5"><div className="num text-xs text-slate-200">{fmt(mfm.vRY, 0)} V</div><div className="text-[9px] text-slate-500">V_RY</div></div>
            <div className="panel py-1.5"><div className="num text-xs text-slate-200">{mfm.pf.toFixed(3)}</div><div className="text-[9px] text-slate-500">PF</div></div>
          </div>
        )}

        <RoleGate perm="breaker_control" fallback={
          <div className="border border-amber-500/30 bg-amber-500/5 rounded p-2.5 text-[11px] text-amber-300/90">
            🔒 Action Disabled: Elevated Authority Required — breaker remote control (Trip/Close) is restricted to <b>Manager</b> and <b>Admin</b>. Signed in as <b>{user.role}</b>.
          </div>
        }>
          <div className="border border-ink-500 rounded p-2.5 space-y-2">
            <p className="text-[10px] uppercase tracking-widest text-slate-500">Remote Control Terminal — SBO protected</p>
            <div className="grid grid-cols-3 gap-2">
              <button disabled={b.state !== 'closed'} onClick={() => doSbo('trip')} className="btn-danger py-2 disabled:opacity-30" title="Open the breaker (SBO + PIN)">TRIP</button>
              <button disabled={b.state === 'closed'} onClick={() => doSbo('close')} className="btn-primary py-2 disabled:opacity-30" title="Close the breaker (SBO + PIN)">CLOSE</button>
              <button disabled={b.state !== 'tripped'} onClick={() => doSbo('trip-reset')} className="btn-secondary py-2 disabled:opacity-30" title="Reset the trip latch (SBO + PIN)">TRIP RESET</button>
            </div>
            <p className="text-[10px] text-slate-500">
              Every command passes: purpose → interlocks → confirm → PIN. Demo PIN <b className="text-volt-amber">1234</b>.
            </p>
          </div>
        </RoleGate>

        {canInject && relay && (
          <div className="border border-violet-500/30 bg-violet-500/5 rounded p-2.5 space-y-1.5">
            <p className="text-[10px] uppercase tracking-widest text-violet-300">Fault Injection Simulator</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                disabled={b.state !== 'closed'}
                onClick={() => telemetryEngine.injectFault(b.id, 'oc', 3.2, user.displayName)}
                className="btn-secondary text-violet-300 py-1.5 disabled:opacity-30"
              >⚡ Inject OC fault</button>
              <button
                disabled={b.state !== 'closed'}
                onClick={() => telemetryEngine.injectFault(b.id, 'ef', 0, user.displayName)}
                className="btn-secondary text-violet-300 py-1.5 disabled:opacity-30"
              >⚡ Inject EF fault</button>
            </div>
            <p className="text-[10px] text-slate-500">Simulates IDMT element pickup on {relay.name} ({relay.curve}, TMS {relay.tms}) — end-to-end protection trip workflow.</p>
          </div>
        )}
      </div>
    </Panel>
  )
}

/* --------------------------------- layout --------------------------------- */

const ROW_Y = [150, 258, 366, 474]
const COLS = 6

export default function SldView() {
  const substation = useStore((s) => s.selectedSubstation)
  const snap = useStore((s) => s.snap)
  const selectedId = useStore((s) => s.selectedBreakerId)
  const setSelected = useStore((s) => s.setSelectedBreakerId)
  const [zoom, setZoom] = useState(1)

  const data = useMemo(() => {
    if (!snap) return null
    const breakers = snap.breakers.filter((b) => b.substation === substation)
    const buses = telemetryEngine.busState(substation)
    const busAF = breakers.filter((b) => b.kind === 'feeder' && b.bus === 'A')
    const busBF = breakers.filter((b) => b.kind === 'feeder' && b.bus === 'B')
    return {
      breakers,
      buses,
      incA: breakers.find((b) => b.name === 'INC-A')!,
      incB: breakers.find((b) => b.name === 'INC-B')!,
      coupler: breakers.find((b) => b.kind === 'buscoupler')!,
      rowsA: COLS >= busAF.length ? [busAF] : chunk(busAF, COLS),
      rowsB: COLS >= busBF.length ? [busBF] : chunk(busBF, COLS),
    }
  }, [snap, substation])

  if (!data) return null

  const selected = data.breakers.find((b) => b.id === selectedId) ?? null
  const spec = SUBSTATIONS.find((s) => s.id === substation)!
  const mfmA = snap?.mfms.find((m) => m.breakerId === data.incA.id)
  const W = 1280, H = 640, BUS_Y = 84

  const busStroke = (live: boolean) => (live ? COL.energized : COL.dead)

  const renderBank = (busLive: boolean, rows: Breaker[][], x0: number, x1: number, trunkX: number) => (
    <g>
      {/* trunk from bus down to last row */}
      <line x1={trunkX} y1={BUS_Y + 4} x2={trunkX} y2={ROW_Y[ROW_Y.length - 1]} stroke={busStroke(busLive)} strokeWidth={2} opacity={0.85} />
      {rows.map((row, ri) => {
        const y = ROW_Y[ri]
        if (!row.length) return null
        const step = (x1 - x0) / Math.max(1, row.length)
        return (
          <g key={ri}>
            {/* row stub — part of the energized bus section */}
            <line x1={trunkX} y1={y} x2={x1} y2={y} stroke={busStroke(busLive)} strokeWidth={1.6} opacity={0.8} />
            {row.map((b, i) => (
              <FeederBranch
                key={b.id}
                x={x0 + step * i + step / 2}
                stubY={y}
                b={b}
                energized={busLive && b.state === 'closed' && b.commOk && b.inService}
                selected={b.id === selectedId}
                onSelect={() => setSelected(b.id)}
              />
            ))}
          </g>
        )
      })}
    </g>
  )

  return (
    <div className="h-full flex flex-col xl:flex-row gap-3 p-3 min-h-0">
      {/* Left: SLD canvas */}
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 panel p-1">
            {SUBSTATIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => useStore.getState().setSelectedSubstation(s.id)}
                className={clsx('px-3 py-1 rounded text-xs', substation === s.id ? 'bg-cyan-500/15 text-volt-cyan' : 'text-slate-400 hover:text-slate-200')}
              >
                {s.id}
              </button>
            ))}
          </div>
          <Badge tone="slate">{spec.vcbCount} VCB · {spec.relayCount} relays · {spec.mfmCount} MFMs</Badge>
          <Badge tone="cyan">{spec.activeTags.toLocaleString()} tags</Badge>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[10px] text-slate-500 flex items-center gap-1"><Led color="red" size={7} /> closed/energized</span>
            <span className="text-[10px] text-slate-500 flex items-center gap-1"><Led color="green" size={7} /> open/dead</span>
            <span className="text-[10px] text-slate-500 flex items-center gap-1"><Led color="amber" size={7} flash /> tripped</span>
            <div className="flex items-center gap-1 ml-2 panel p-0.5">
              <button onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.1).toFixed(2)))} className="p-1 text-slate-400 hover:text-slate-100"><Minus size={12} /></button>
              <span className="num text-[10px] text-slate-400 w-8 text-center">{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom((z) => Math.min(1.8, +(z + 0.1).toFixed(2)))} className="p-1 text-slate-400 hover:text-slate-100"><Plus size={12} /></button>
            </div>
          </div>
        </div>

        <div className="panel flex-1 min-h-0 sld-grid overflow-auto">
          <div style={{ width: `${W * zoom}px`, height: `${H * zoom}px` }}>
            <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
              {/* ------------------------------ incomers ------------------------------ */}
              {[
                { b: data.incA, x: 330, label: '11 kV GRID INCOMER — A' },
                { b: data.incB, x: 950, label: '11 kV GRID INCOMER — B' },
              ].map(({ b, x, label }) => {
                const live = b.state === 'closed' && b.commOk
                return (
                  <g key={b.id}>
                    <text x={x} y={14} textAnchor="middle" fontSize={9} fill={COL.text} className="num">{label}</text>
                    <line x1={x} y1={20} x2={x} y2={30} stroke={live ? COL.energized : COL.dead} strokeWidth={2} />
                    <VcbSymbol
                      x={x} y={46}
                      closed={b.state === 'closed'} tripped={b.state === 'tripped'}
                      selected={b.id === selectedId} onClick={() => setSelected(b.id)}
                      label={b.name} commOk={b.commOk} local={b.remoteLocal === 'local'}
                    />
                    <line x1={x} y1={62} x2={x} y2={BUS_Y - 4} stroke={live ? COL.energized : COL.dead} strokeWidth={2} />
                  </g>
                )
              })}

              {/* ------------------------------ busbars ------------------------------ */}
              <rect x={60} y={BUS_Y - 4} width={555} height={8} rx={2} fill={busStroke(data.buses.busA)} />
              <rect x={665} y={BUS_Y - 4} width={555} height={8} rx={2} fill={busStroke(data.buses.busB)} />
              <text x={64} y={BUS_Y + 22} fontSize={9.5} fill={COL.bus} className="num" fontWeight="700">BUS-A {data.buses.busA ? '· LIVE' : '· DEAD'}</text>
              <text x={669} y={BUS_Y + 22} fontSize={9.5} fill={COL.bus} className="num" fontWeight="700">BUS-B {data.buses.busB ? '· LIVE' : '· DEAD'}</text>
              {mfmA && data.buses.busA && (
                <text x={64} y={BUS_Y + 36} fontSize={8.5} fill={COL.text} className="num">{(mfmA.vRY / 1000).toFixed(2)} kV · {fmt(mfmA.kW / 1000, 2)} MW</text>
              )}

              {/* ----------------------------- coupler ------------------------------ */}
              <g>
                <line x1={615} y1={BUS_Y} x2={628} y2={BUS_Y} stroke={COL.bus} strokeWidth={2.4} />
                <line x1={652} y1={BUS_Y} x2={665} y2={BUS_Y} stroke={COL.bus} strokeWidth={2.4} />
                <g transform={`translate(${640},${BUS_Y}) rotate(90)`}>
                  <VcbSymbol
                    x={0} y={0}
                    closed={data.coupler.state === 'closed'} tripped={data.coupler.state === 'tripped'}
                    selected={data.coupler.id === selectedId} onClick={() => setSelected(data.coupler.id)}
                    label={data.coupler.name} commOk={data.coupler.commOk} local={data.coupler.remoteLocal === 'local'}
                  />
                </g>
                <text x={640} y={BUS_Y + 30} textAnchor="middle" fontSize={8} fill={COL.text} className="num">BUS COUPLER</text>
              </g>

              {/* ------------------------------ feeders ------------------------------ */}
              {renderBank(data.buses.busA, data.rowsA, 78, 600, 78)}
              {renderBank(data.buses.busB, data.rowsB, 683, 1205, 683)}

              {/* ------------------------------ legend ------------------------------ */}
              <g transform="translate(1000, 600)">
                <text x={0} y={0} fontSize={8} fill="#64748B" className="num">IEC 617-2-8 · red=live green=dead amber-flashing=tripped · double-circle=11/0.415 kV Tx</text>
              </g>
            </svg>
          </div>
        </div>

        <p className="text-[10px] text-slate-600 flex items-center gap-1">
          <Crosshair size={10} /> Click any breaker to inspect digital inputs (ON/OFF/TRIP, Spring, Service/Test) and live metering · Manager/Admin get the SBO control terminal
        </p>
      </div>

      {/* Right: inspector */}
      <div className="w-full xl:w-[370px] shrink-0 min-h-0 overflow-auto">
        {selected ? (
          <BreakerInspector b={selected} />
        ) : (
          <Panel title="Bay Inspector">
            <p className="text-xs text-slate-500 py-8 text-center">
              Select a breaker on the SLD to view its digital inputs, live metering and — for Manager/Admin — the SBO remote-control terminal.
            </p>
          </Panel>
        )}
      </div>
    </div>
  )
}

/* ------------------------------- util chunk ------------------------------- */

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
