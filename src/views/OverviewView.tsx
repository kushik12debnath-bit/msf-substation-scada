import { useMemo } from 'react'
import { AlertTriangle, ArrowRight, Cpu, Radio, ShieldAlert, Zap } from 'lucide-react'
import { clsx } from 'clsx'
import { Badge, Kpi, Led, Panel, fmt, fmtInt, fmtTime } from '../components/ui'
import { SubstationId, SUBSTATIONS, TOTAL_TAGS } from '../types'
import { telemetryEngine, useStore } from '../store/useStore'

function SubstationCard({ id }: { id: SubstationId }) {
  const snap = useStore((s) => s.snap)
  const setSelectedSubstation = useStore((s) => s.setSelectedSubstation)
  const setView = useStore((s) => s.setView)

  const spec = SUBSTATIONS.find((x) => x.id === id)!
  const data = useMemo(() => {
    if (!snap) return null
    const bs = snap.breakers.filter((b) => b.substation === id)
    const closed = bs.filter((b) => b.state === 'closed').length
    const tripped = bs.filter((b) => b.state === 'tripped').length
    const commFail = bs.filter((b) => !b.commOk).length
    const alarmCount = snap.alarms.filter((a) => a.substation === id && a.active && !a.acknowledged).length
    const kVA = snap.mfms
      .filter((m) => m.substation === id)
      .filter((m) => {
        const b = snap.breakers.find((x) => x.id === m.breakerId)
        return b?.kind === 'incomer' && b.state === 'closed'
      })
      .reduce((s, m) => s + m.kVA, 0)
    const gwy = snap.gateways.find((g) => g.substation === id)!
    const loadMW = (kVA * 0.97) / 1000
    return { closed, tripped, commFail, alarmCount, kVA, gwy, loadMW }
  }, [snap, id])

  if (!data) return null
  const g = data.gwy
  const gwyTone = g.state === 'online' ? 'green' : g.state === 'degraded' ? 'amber' : 'red'

  return (
    <button
      onClick={() => { setSelectedSubstation(id); setView('sld') }}
      className="panel p-4 text-left hover:border-volt-cyan/60 transition-colors flex flex-col gap-3"
    >
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm font-bold text-slate-100">{id}</span>
          <span className="text-[10px] text-slate-500 ml-2">{spec.name} · tier {spec.tagTier.toLocaleString()} tags</span>
        </div>
        <Led color={gwyTone} flash={g.state !== 'online'} size={9} />
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
        <span className="text-slate-500">Load</span><span className="num text-slate-200 text-right">{data.loadMW.toFixed(2)} MW</span>
        <span className="text-slate-500">VCBs closed</span><span className="num text-slate-200 text-right">{data.closed}/{spec.vcbCount}</span>
        <span className="text-slate-500">Active trips</span>
        <span className={clsx('num text-right', data.tripped ? 'text-volt-red' : 'text-slate-200')}>{data.tripped}</span>
        <span className="text-slate-500">COMM_FAIL bays</span>
        <span className={clsx('num text-right', data.commFail ? 'text-volt-amber' : 'text-slate-200')}>{data.commFail}</span>
        <span className="text-slate-500">Un-ack alarms</span>
        <span className={clsx('num text-right', data.alarmCount ? 'text-volt-amber' : 'text-slate-200')}>{data.alarmCount}</span>
        <span className="text-slate-500">Gateway latency</span>
        <span className={clsx('num text-right', g.state === 'online' ? 'text-volt-green' : 'text-volt-amber')}>
          {g.state === 'online' ? `${g.latencyMs.toFixed(0)} ms` : 'STALE'}
        </span>
        <span className="text-slate-500">Packet loss</span>
        <span className="num text-right text-slate-200">{g.packetLossPct.toFixed(1)} %</span>
      </div>

      <div className="flex items-center justify-between text-[10px] text-slate-500 border-t border-ink-700 pt-2">
        <span>Pi 4B · {g.registersPerPoll} reg/poll block</span>
        <span className="flex items-center gap-1 text-volt-cyan">open SLD <ArrowRight size={10} /></span>
      </div>
    </button>
  )
}

function FrequencyGauge({ hz }: { hz: number }) {
  const dev = hz - 50
  const pct = Math.max(0, Math.min(1, 0.5 + dev / 0.6))
  const angle = -120 + pct * 240
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="170" height="100" viewBox="0 0 170 100">
        <path d="M 15 95 A 70 70 0 0 1 155 95" fill="none" stroke="#1C2536" strokeWidth="13" strokeLinecap="round" />
        <path d="M 15 95 A 70 70 0 0 1 155 95" fill="none" stroke="#28324A" strokeWidth="13" strokeLinecap="round" strokeDasharray="4 6" opacity="0.6" />
        <line x1="85" y1="95" x2={85 + 62 * Math.sin((angle * Math.PI) / 180)} y2={95 - 62 * Math.cos((angle * Math.PI) / 180)} stroke="#22D3EE" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="85" cy="95" r="5" fill="#22D3EE" />
        <text x="15" y="88" fill="#64748B" fontSize="9">49.7</text>
        <text x="141" y="88" fill="#64748B" fontSize="9">50.3</text>
        <text x="72" y="40" fill="#4ADE80" fontSize="20" fontWeight="700" className="num">{hz.toFixed(2)}</text>
        <text x="76" y="56" fill="#64748B" fontSize="9">Hz</text>
      </svg>
      <span className="text-[10px] text-slate-500">Grid frequency — nominal 50.00 Hz ± 0.05</span>
    </div>
  )
}

function LoadDial({ mw, mva }: { mw: number; mva: number }) {
  const pct = Math.max(0, Math.min(1, mva / 90))
  const angle = -120 + pct * 240
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="170" height="100" viewBox="0 0 170 100">
        <path d="M 15 95 A 70 70  0 0 1 155 95" fill="none" stroke="#1C2536" strokeWidth="13" strokeLinecap="round" />
        <path d="M 15 95 A 70 70 0 0 1 72 26" fill="none" stroke="#F87171" strokeWidth="13" strokeLinecap="round" opacity="0.25" />
        <path d="M 15 95 A 70 70 0 0 1 155 95" fill="none" stroke="#4ADE80" strokeWidth="13" strokeLinecap="round" strokeDasharray={`${pct * 220} 999`} />
        <line x1="85" y1="95" x2={85 + 62 * Math.sin((angle * Math.PI) / 180)} y2={95 - 62 * Math.cos((angle * Math.PI) / 180)} stroke="#E2E8F0" strokeWidth="2" strokeLinecap="round" />
        <text x="70" y="40" fill="#E2E8F0" fontSize="20" fontWeight="700" className="num">{mw.toFixed(1)}</text>
        <text x="74" y="56" fill="#64748B" fontSize="9">MW</text>
      </svg>
      <span className="text-[10px] text-slate-500">Plant load — {mva.toFixed(1)} MVA through 2×11 kV incomers</span>
    </div>
  )
}

export default function OverviewView() {
  const snap = useStore((s) => s.snap)
  const kpis = useStore((s) => s.kpis)
  const user = useStore((s) => s.user)

  const alarmStats = useMemo(() => {
    if (!snap) return { active: 0, unack: 0, crit: 0 }
    const act = snap.alarms.filter((a) => a.active)
    return {
      active: act.length,
      unack: act.filter((a) => !a.acknowledged).length,
      crit: act.filter((a) => a.severity === 'critical').length,
    }
  }, [snap])

  const recentAudit = snap?.audit.slice(0, 8) ?? []

  if (!snap) return null

  return (
    <div className="h-full overflow-auto p-4 space-y-4">
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-7 gap-3">
        <Kpi label="Total Active Power" value={fmt(kpis.mw, 2)} unit="MW" tone="cyan" sub="Σ incomer meters" />
        <Kpi label="Apparent Power" value={fmt(kpis.mva, 2)} unit="MVA" tone="violet" sub="√(MW²+MVAr²)" />
        <Kpi label="Reactive Power" value={fmt(kpis.mvar, 2)} unit="MVAr" tone="amber" sub="lagging load" />
        <Kpi label="System PF" value={kpis.pf.toFixed(3)} tone="green" sub="target ≥ 0.95" />
        <Kpi label="Frequency" value={kpis.hz.toFixed(2)} unit="Hz" tone={Math.abs(kpis.hz - 50) > 0.1 ? 'amber' : 'green'} sub="nom 50.00 ±0.05" />
        <Kpi label="2050 Carbon Tracker" value={fmt(kpis.carbonOffsetTons, 1)} unit="t CO₂" tone="green" sub="offset via 38% solar blend · 0.82 kg/kWh" />
        <Kpi label="Tag Utilisation" value={fmtInt(TOTAL_TAGS)} unit="tags" tone="cyan" sub="active of 14,000 tier capacity" />
  </div>

      {/* Health cards */}
      <div>
        <h2 className="panel-title mb-2">Substation Health — click a card to open its SLD</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
          {SUBSTATIONS.map((s) => <SubstationCard key={s.id} id={s.id} />)}
        </div>
      </div>

      {/* Gauges + alarms + audit */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Panel title="Grid Instruments" className="order-2 xl:order-1">
          <div className="flex items-center justify-around">
            <FrequencyGauge hz={kpis.hz} />
            <LoadDial mw={kpis.mw} mva={kpis.mva} />
          </div>
        </Panel>

        <Panel
          title="Annunciator Summary"
          className="order-1 xl:order-2"
          right={<button className="text-[11px] text-volt-cyan hover:underline" onClick={() => useStore.getState().setView('alarms')}>open annunciator →</button>}
        >
          <div className="grid grid-cols-3 gap-2 text-center mb-3">
            <div className="panel py-2"><div className="num text-xl text-slate-200">{alarmStats.active}</div><div className="text-[10px] text-slate-500">ACTIVE</div></div>
            <div className="panel py-2"><div className="num text-xl text-volt-amber">{alarmStats.unack}</div><div className="text-[10px] text-slate-500">UN-ACK</div></div>
            <div className="panel py-2"><div className="num text-xl text-volt-red">{alarmStats.crit}</div><div className="text-[10px] text-slate-500">CRITICAL</div></div>
          </div>
          <div className="space-y-1 max-h-40 overflow-auto text-[11px]">
            {snap.alarms.filter((a) => a.active).slice(0, 6).map((a) => (
              <div key={a.id} className="flex items-center gap-2 px-2 py-1 rounded bg-ink-800/60">
                <Led color={a.severity === 'critical' ? 'red' : a.severity === 'major' ? 'amber' : 'cyan'} size={6} flash={!a.acknowledged} />
                <span className="text-slate-500 num">{fmtTime(a.ts)}</span>
                <span className="truncate text-slate-300">[{a.substation}] {a.message}</span>
              </div>
            ))}
            {alarmStats.active === 0 && <p className="text-slate-500 text-xs py-4 text-center">No active alarms — all bays healthy ✓</p>}
          </div>
        </Panel>

        <Panel title="System Audit Trail (latest)" right={<span className="text-[10px] text-slate-500">SBO · switching · settings</span>} className="order-3">
          <div className="space-y-1 max-h-56 overflow-auto text-[11px]">
            {recentAudit.map((a) => (
              <div key={a.id} className="flex items-start gap-2 px-2 py-1 rounded bg-ink-800/40">
                <span className="text-slate-600 num shrink-0">{fmtTime(a.ts)}</span>
                <div className="min-w-0">
                  <p className="text-slate-300 truncate"><b className="text-slate-100">{a.action}</b> · {a.target} — {a.detail}</p>
                  <p className="text-slate-600 text-[10px]">{a.user} ({a.role})</p>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  )
}
