import { useEffect, useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { Maximize2, Minimize2 } from 'lucide-react'
import { Badge, Led, Panel, fmt } from '../components/ui'
import { Breaker, SubstationId, SUBSTATIONS, TOTAL_VCBS } from '../types'
import { telemetryEngine, useStore } from '../store/useStore'

/* ============================================================================
 * SCADA Control Room Dashboard
 * A dense, glanceable mimic wall: annunciator fascia, VCB status matrix across
 * all 134 breakers, plant mimic with live totals, event ticker. Supports a
 * full-screen wall mode for control-room displays.
 * ==========================================================================*/

/* ------------------------------ annunciator ------------------------------ */

const WINDOW_S = 8 // seconds of alarm window per annunciator cell

function AnnunciatorFascia() {
  const snap = useStore((s) => s.snap)
  const can = useStore((s) => s.can)
  const user = useStore((s) => s.user)

  const groups = useMemo(() => {
    if (!snap) return []
    const now = Date.now()
    const active = snap.alarms.filter((a) => a.active)
    const byClass = new Map<string, AlarmRow[]>()
    for (const a of active) {
      if (now - a.ts > WINDOW_S * 1000) continue // outside fascia window
      const list = byClass.get(a.cls) ?? []
      list.push({ alarm: a, windowEnd: a.ts + WINDOW_S * 1000 })
      byClass.set(a.cls, list)
    }
    return [...byClass.entries()]
      .map(([cls, rows]) => ({ cls, rows }))
      .sort((a, b) => b.rows.length - a.rows.length)
      .slice(0, 8)
  }, [snap])

  if (!snap) return null
  const unack = snap.alarms.filter((a) => a.active && !a.acknowledged).length

  return (
    <Panel
      title="Alarm Annunciator Fascia"
      right={
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500">{unack} un-ack</span>
          <button
            disabled={!can('ack_alarm') || unack === 0}
            onClick={() => telemetryEngine.ackAll(user.displayName)}
            className="btn-secondary px-2 py-0.5 text-[10px] disabled:opacity-30"
          >ACK ALL</button>
        </div>
      }
    >
      {groups.length === 0 ? (
        <div className="h-[72px] flex items-center justify-center text-xs text-slate-500">
          ✓ No active alarm groups — all windows clear
        </div>
      ) : (
        <div className="grid grid-cols-4 md:grid-cols-8 gap-1.5">
          {groups.map(({ cls, rows }) => {
            const anyUnack = rows.some((r) => !r.alarm.acknowledged)
            const crit = rows.some((r) => r.alarm.severity === 'critical')
            return (
              <button
                key={cls}
                onClick={() => useStore.getState().setView('alarms')}
                className={clsx(
                  'h-[72px] rounded border flex flex-col items-center justify-center gap-1 px-1 transition-colors',
                  anyUnack ? 'animate-flash' : '',
                  crit ? 'border-red-500/60 bg-red-950/40 text-red-200' : 'border-amber-500/50 bg-amber-950/30 text-amber-200',
                )}
                title={rows.map((r) => `[${r.alarm.substation}] ${r.alarm.message}`).join('\n')}
              >
                <span className="text-[9px] font-bold uppercase tracking-wider text-center leading-tight">{cls.replace('-', ' ')}</span>
                <span className="num text-lg leading-none">{rows.length}</span>
                <span className="text-[8px] opacity-70">{anyUnack ? 'UN-ACK' : 'ACKED'}</span>
              </button>
            )
          })}
        </div>
      )}
    </Panel>
  )
}

interface AlarmRow { alarm: import('../types').Alarm; windowEnd: number }

/* ------------------------------ VCB matrix ------------------------------- */

function VcbCell({ b }: { b: Breaker }) {
  const selected = useStore((s) => s.selectedBreakerId) === b.id
  const tone =
    b.state === 'tripped' ? 'bg-volt-amber text-ink-900 animate-flash border-amber-300'
      : b.state === 'closed' ? (b.commOk ? 'bg-red-500/80 text-white border-red-300' : 'bg-red-500/25 text-red-200 border-red-500/40')
        : 'bg-green-500/70 text-ink-900 border-green-300'
  return (
    <button
      onClick={() => {
        useStore.getState().setSelectedSubstation(b.substation)
        useStore.getState().setSelectedBreakerId(b.id)
        useStore.getState().setView('sld')
      }
      }
      title={`${b.substation} · ${b.name} · ${b.state.toUpperCase()} · slave ${b.slaveId}${b.commOk ? '' : ' · STALE'}`}
      className={clsx('h-5 w-full rounded-[3px] border text-[7px] font-bold leading-none flex items-center justify-center transition-transform hover:scale-110', tone, selected && 'ring-2 ring-cyan-300')}
    >
      {b.name.replace('INC-', 'I').replace('BUS-CP', 'BC').replace('F-', '')}
    </button>
  )
}

function VcbMatrix() {
  const snap = useStore((s) => s.snap)
  if (!snap) return null
  return (
    <Panel
      title={`VCB Status Matrix — ${TOTAL_VCBS} breakers`}
      right={<span className="text-[10px] text-slate-500">red=closed green=open amber-flashing=tripped · click → SLD</span>}
    >
      <div className="space-y-2 overflow-auto max-h-44">
        {SUBSTATIONS.map((s) => {
          const bs = snap.breakers.filter((b) => b.substation === s.id)
          const tripped = bs.filter((b) => b.state === 'tripped').length
          return (
            <div key={s.id} className="flex items-center gap-2">
              <span className="num text-[10px] text-slate-400 w-8 shrink-0">{s.id}</span>
              <div className="grid gap-[3px] flex-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(30px, 1fr))' }}>
                {bs.map((b) => <VcbCell key={b.id} b={b} />)}
              </div>
              {tripped > 0 && <Badge tone="amber" className="shrink-0">{tripped} TRP</Badge>}
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

/* ------------------------------- plant mimic ------------------------------ */

function MimicRow({ label, value, unit, tone }: { label: string; value: string; unit?: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-ink-800/70 py-1">
      <span className="text-[10px] uppercase tracking-widest text-slate-500">{label}</span>
      <span className={clsx('num text-xl leading-none', tone ?? 'text-slate-100')}>
        {value}{unit && <span className="text-[10px] text-slate-500 ml-1">{unit}</span>}
      </span>
    </div>
  )
}

function PlantMimic() {
  const kpis = useStore((s) => s.kpis)
  const snap = useStore((s) => s.snap)
  if (!snap) return null
  const pfTone = kpis.pf >= 0.95 ? 'text-volt-green' : 'text-volt-amber'
  return (
    <Panel title="Plant Mimic — 2 × 11 kV Incomers">
      <div className="grid grid-cols-2 gap-x-6">
        <div>
          <MimicRow label="Active Power" value={fmt(kpis.mw, 2)} unit="MW" tone="text-volt-cyan" />
          <MimicRow label="Apparent" value={fmt(kpis.mva, 2)} unit="MVA" tone="text-violet-300" />
          <MimicRow label="Reactive" value={fmt(kpis.mvar, 2)} unit="MVAr" tone="text-volt-amber" />
        </div>
        <div>
          <MimicRow label="Frequency" value={kpis.hz.toFixed(2)} unit="Hz" tone={Math.abs(kpis.hz - 50) > 0.15 ? 'text-volt-amber' : 'text-volt-green'} />
          <MimicRow label="Power Factor" value={kpis.pf.toFixed(3)} tone={pfTone} />
          <MimicRow
            label="Carbon Offset"
            value={fmt(kpis.carbonOffsetTons, 1)}
            unit="t CO₂"
            tone="text-volt-green"
          />
        </div>
      </div>
      {/* incomer live bars */}
      <div className="mt-3 space-y-1.5">
        {snap.breakers.filter((b) => b.kind === 'incomer').map((b) => {
          const m = snap.mfms.find((x) => x.breakerId === b.id)!
          const pct = Math.min(100, (m.kVA / 30000) * 100)
          return (
            <div key={b.id} className="flex items-center gap-2">
              <span className="num text-[10px] text-slate-400 w-16">{b.substation} {b.name}</span>
              <div className="flex-1 h-2.5 bg-ink-800 rounded overflow-hidden">
                <div
                  className={clsx('h-full rounded', b.state === 'closed' ? 'bg-gradient-to-r from-cyan-500/60 to-cyan-400/90' : 'bg-slate-700')}
                  style={{ width: `${b.state === 'closed' ? pct : 0}%` }}
                />
              </div>
              <span className="num text-[10px] text-slate-300 w-20 text-right">{b.state === 'closed' ? `${fmt(m.kVA / 1000, 2)} MVA` : 'OPEN'}</span>
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

/* ----------------------------- substation rows ---------------------------- */

function SubstationMimics() {
  const snap = useStore((s) => s.snap)
  if (!snap) return null
  return (
    <Panel title="Substation Mimics — load / VCB / gateway">
      <div className="space-y-1.5">
        {SUBSTATIONS.map((s) => {
          const bs = snap.breakers.filter((b) => b.substation === s.id)
          const g = snap.gateways.find((x) => x.substation === s.id)!
          const kVA = bs
            .filter((b) => b.kind === 'incomer' && b.state === 'closed')
            .reduce((sum, b) => sum + (snap.mfms.find((m) => m.breakerId === b.id)?.kVA ?? 0), 0)
          const mw = (kVA * 0.97) / 1000
          const tierPct = Math.min(100, (s.activeTags / s.tagTier) * 100)
          const trips = bs.filter((b) => b.state === 'tripped').length
          return (
            <button
              key={s.id}
              onClick={() => { useStore.getState().setSelectedSubstation(s.id); useStore.getState().setView('sld') }}
              className="w-full flex items-center gap-2 hover:bg-ink-800/50 rounded px-1 py-0.5 text-left"
            >
              <Led color={g.state === 'online' ? 'green' : g.state === 'degraded' ? 'amber' : 'red'} size={7} flash={g.state !== 'online'} />
              <span className="num text-xs text-slate-200 w-9">{s.id}</span>
              <div className="flex-1 h-3 bg-ink-800 rounded overflow-hidden">
                <div className="h-full bg-gradient-to-r from-cyan-500/40 to-cyan-400/70" style={{ width: `${Math.min(100, (mw / 20) * 100)}%` }} />
              </div>
              <span className="num text-[10px] text-slate-300 w-14 text-right">{mw.toFixed(1)} MW</span>
              <span className="num text-[10px] text-slate-400 w-16 text-right">{bs.filter((b) => b.state === 'closed').length}/{s.vcbCount} VCB</span>
              <span className="num text-[10px] text-slate-500 w-16 text-right">{g.latencyMs.toFixed(0)} ms</span>
              {trips > 0 ? <Badge tone="amber" className="shrink-0">{trips} TRP</Badge> : <span className="w-1" />}
            </button>
          )
        })}
      </div>
      {/* tag tier utilization bar */}
      <div className="mt-3">
        <div className="flex justify-between text-[9px] uppercase tracking-widest text-slate-500 mb-1">
          <span>tag tier utilization</span><span className="num">{SUBSTATIONS.reduce((a, s) => a + s.activeTags, 0).toLocaleString()} / 14,000</span>
        </div>
        <div className="h-1.5 bg-ink-800 rounded overflow-hidden flex">
          {SUBSTATIONS.map((s) => (
            <div key={s.id} className="h-full border-r border-ink-900 last:border-0" style={{ width: `${tierWidth(s)}%`, background: tierColor(s.id) }} title={`${s.id}: ${s.activeTags} / ${s.tagTier}`} />
          ))}
        </div>
      </div>
    </Panel>
  )
}

function tierWidth(s: typeof SUBSTATIONS[number]) {
  return (s.activeTags / 14000) * 100
}
function tierColor(id: SubstationId) {
  return { MRS: '#22D3EE', RF1: '#4ADE80', RF2: '#FBBF24', PR1: '#60A5FA', PR2: '#F472B6' }[id]
}

/* --------------------------------- ticker --------------------------------- */

function EventTicker() {
  const snap = useStore((s) => s.snap)
  const [idx, setIdx] = useState(0)
  const events = snap?.audit.slice(0, 12) ?? []
  useEffect(() => {
    const t = window.setInterval(() => setIdx((i) => i + 1), 3000)
    return () => window.clearInterval(t)
  }, [])
  if (!events.length) return null
  const e = events[idx % events.length]
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-ink-850/80 border border-ink-600/70 rounded text-[11px] overflow-hidden">
      <Badge tone="cyan">EVENT</Badge>
      <span className="num text-slate-500">{new Date(e.ts).toLocaleTimeString('en-IN', { hour12: false })}</span>
      <span className={clsx('num font-semibold', e.action.includes('TRIP') ? 'text-volt-amber' : e.action.includes('REJECT') || e.action.includes('BLOCK') ? 'text-volt-red' : 'text-volt-cyan')}>{e.action}</span>
      <span className="text-slate-300 truncate">{e.target} — {e.detail}</span>
    </div>
  )
}

/* ---------------------------------- view ---------------------------------- */

export default function DashboardView() {
  const snap = useStore((s) => s.snap)
  const [wall, setWall] = useState(false)

  useEffect(() => {
    if (!wall) return
    const el = document.documentElement
    if (el.requestFullscreen) el.requestFullscreen().catch(() => { })
    return () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => { }) }
  }, [wall])

  if (!snap) return null

  return (
    <div className={clsx('h-full overflow-auto p-3 space-y-3', wall && 'bg-ink-950')}>
      {/* mimic banner */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-volt-green glow-green" />
          <span className="text-xs font-bold tracking-widest text-slate-200">MSF CONTROL ROOM</span>
        </div>
        <Badge tone="cyan">SCADA DASHBOARD</Badge>
        <Badge tone="slate">{snap.gateways.filter((g) => g.state === 'online').length}/5 GATEWAYS ONLINE</Badge>
        <Badge tone={snap.alarms.some((a) => a.active && !a.acknowledged && a.severity === 'critical') ? 'red' : 'slate'}>
          {snap.alarms.filter((a) => a.active && !a.acknowledged).length} UN-ACK ALARMS
        </Badge>
        <button
          onClick={() => setWall((w) => !w)}
          className="ml-auto btn-secondary flex items-center gap-1.5 no-print"
          title="Full-screen wall display mode (52&quot; control room display)"
        >
          {wall ? <Minimize2 size={12} /> : <Maximize2 size={12} />} {wall ? 'Exit wall mode' : 'Wall mode'}
        </button>
      </div>

      {/* top row: annunciator + plant mimic */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <AnnunciatorFascia />
        <PlantMimic />
      </div>

      {/* mid row: VCB matrix + substation mimics */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <VcbMatrix />
        <SubstationMimics />
      </div>

      <EventTicker />

      <p className="text-[10px] text-slate-600 no-print">
        Control-room wall layout — designed for 1920×1080 displays. Every cell is live: annunciator windows follow the
        8-second alarm window convention, the VCB matrix mirrors all {TOTAL_VCBS} breakers, and the ticker streams the audit trail.
      </p>
    </div>
  )
}
