import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { Download, Gauge, Zap } from 'lucide-react'
import { Badge, Panel, fmt, fmtInt } from '../components/ui'
import { Mfm, SubstationId, SUBSTATIONS } from '../types'
import { telemetryEngine, useStore } from '../store/useStore'
import { download } from './RelaysView'

function MeterTile({ label, value, unit, tone = 'slate', sub }: { label: string; value: string; unit?: string; tone?: string; sub?: string }) {
  const tones: Record<string, string> = {
    slate: 'text-slate-200', cyan: 'text-volt-cyan', red: 'text-volt-red',
    amber: 'text-volt-amber', green: 'text-volt-green', blue: 'text-volt-blue', violet: 'text-violet-300',
  }
  return (
    <div className="panel px-3 py-2 flex flex-col gap-0.5 min-w-0">
      <span className="text-[9px] uppercase tracking-widest text-slate-500 truncate">{label}</span>
      <span className={clsx('num text-lg leading-none', tones[tone])}>{value}<span className="text-[10px] text-slate-500 ml-1">{unit}</span></span>
      {sub && <span className="text-[9px] text-slate-600 truncate">{sub}</span>}
    </div>
  )
}

export default function MetersView() {
  const snap = useStore((s) => s.snap)
  const [ss, setSs] = useState<SubstationId>('MRS')
  const [mfmId, setMfmId] = useState<string | null>(null)

  const mfms = snap?.mfms.filter((m) => m.substation === ss) ?? []
  const mfm = useMemo(() => snap?.mfms.find((m) => m.id === mfmId) ?? mfms[0] ?? null, [snap, mfmId, mfms])

  if (!snap) return null

  const b = snap.breakers.find((x) => x.id === mfm?.breakerId)
  const energized = mfm ? telemetryEngine.feederEnergized(b!) : false

  return (
    <div className="h-full flex flex-col xl:flex-row gap-3 p-3 min-h-0">
      {/* Meter list */}
      <div className="xl:w-[330px] shrink-0 flex flex-col gap-2 min-h-0">
        <div className="flex items-center gap-1 panel p-1 text-xs">
          {SUBSTATIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => { setSs(s.id); setMfmId(null) }}
              className={clsx('px-2 py-1 rounded flex-1', ss === s.id ? 'bg-cyan-500/15 text-volt-cyan' : 'text-slate-400')}
            >{s.id}</button>
          ))}
        </div>
        <Panel title={`Multifunction Meters — ${mfms.length} units (LK WL5010 class)`} className="flex-1 min-h-0">
          <div className="overflow-auto h-full space-y-1">
            {mfms.map((m) => {
              const mb = snap.breakers.find((x) => x.id === m.breakerId)
              return (
                <button
                  key={m.id}
                  onClick={() => setMfmId(m.id)}
                  className={clsx('w-full text-left px-2 py-1.5 rounded border text-[11px] flex items-center gap-2',
                    mfm?.id === m.id ? 'border-volt-cyan bg-cyan-500/10' : 'border-ink-700 hover:border-ink-500')}
                >
                  <span className="num text-slate-200 w-20 truncate">{m.name}</span>
                  <span className="num text-slate-400 ml-auto">{fmt(m.kW, 1)} kW</span>
                  <Led mini tone={m.online && mb?.commOk ? 'green' : 'red'} />
                </button>
              )
            })}
          </div>
        </Panel>
      </div>

      {/* Detail */}
      {mfm && (
        <div className="flex-1 min-w-0 overflow-auto space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-bold text-slate-100">{mfm.name}</h2>
            <Badge tone="cyan">{mfm.model}</Badge>
            <Badge tone="slate">Class 0.5 · IEC 62053-22</Badge>
            <Badge tone="slate">CT {mfm.ctRatio}/5 A</Badge>
            <Badge tone="slate">Slave {mfm.slaveId} @9600</Badge>
            <Badge tone={energized ? 'red' : 'green'}>{energized ? 'ENERGIZED' : 'DE-ENERGIZED'}</Badge>
            <button
              className="ml-auto btn-secondary flex items-center gap-1"
              onClick={() => exportMfmCsv(mfm)}
              title="Export current register snapshot"
            ><Download size={12} /> CSV snapshot</button>
          </div>

          {/* Voltages & currents */}
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">
            <MeterTile label="V_RY line" value={fmt(mfm.vRY, 0)} unit="V" tone="green" />
            <MeterTile label="V_YB line" value={fmt(mfm.vYB, 0)} unit="V" tone="green" />
            <MeterTile label="V_BR line" value={fmt(mfm.vBR, 0)} unit="V" tone="green" />
            <MeterTile label="V_R phase" value={fmt(mfm.vR, 0)} unit="V" />
            <MeterTile label="V_Y phase" value={fmt(mfm.vY, 0)} unit="V" />
            <MeterTile label="V_B phase" value={fmt(mfm.vB, 0)} unit="V" />
            <MeterTile label="I_R" value={fmt(mfm.iR, 1)} unit="A" tone="red" />
            <MeterTile label="I_Y" value={fmt(mfm.iY, 1)} unit="A" tone="amber" />
            <MeterTile label="I_B" value={fmt(mfm.iB, 1)} unit="A" tone="blue" />
            <MeterTile label="I_N neutral" value={fmt(mfm.iN, 1)} unit="A" tone="violet" />
            <MeterTile label="Active power" value={fmt(mfm.kW, 1)} unit="kW" tone="cyan" />
            <MeterTile label="Reactive" value={fmt(mfm.kVAR, 1)} unit="kVAr" tone="amber" />
            <MeterTile label="Apparent" value={fmt(mfm.kVA, 1)} unit="kVA" tone="violet" />
            <MeterTile label="Power factor" value={mfm.pf.toFixed(3)} tone="green" sub={`R ${mfm.pfR.toFixed(2)} · Y ${mfm.pfY.toFixed(2)} · B ${mfm.pfB.toFixed(2)}`} />
            <MeterTile label="Frequency" value={mfm.freq.toFixed(2)} unit="Hz" tone="green" />
            <MeterTile label="THD-V" value={mfm.thdV.toFixed(2)} unit="%" tone={mfm.thdV > 4 ? 'amber' : 'slate'} />
            <MeterTile label="THD-I" value={mfm.thdI.toFixed(2)} unit="%" tone={mfm.thdI > 6 ? 'amber' : 'slate'} />
          </div>

          {/* Harmonics + energy registers */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Panel title="Voltage Harmonic Spectrum (H2–H7, % of fundamental)">
              <HarmonicBars harmonics={mfm.harmonics} />
              <p className="text-[10px] text-slate-500 mt-2">IEEE-519 limit for 11 kV: THD-V ≤ 5% · individual odd harmonics ≤ 3%</p>
              <p className="text-[10px] text-slate-600">THD-V {mfm.thdV.toFixed(2)} % · THD-I {mfm.thdI.toFixed(2)} % · measured over 10/12-cycle window (Class 0.5 aggregation)</p>
            </Panel>

            <Panel title="Cumulative Energy Registers" right={<Zap size={12} className="text-volt-amber" />}>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="panel py-3"><div className="num text-xl text-volt-green">{fmtInt(mfm.kWhImport)}</div><div className="text-[9px] text-slate-500">kWh IMPORT</div></div>
                <div className="panel py-3"><div className="num text-xl text-volt-cyan">{fmtInt(mfm.kWhExport)}</div><div className="text-[9px] text-slate-500">kWh EXPORT</div></div>
                <div className="panel py-3"><div className="num text-xl text-violet-300">{fmtInt(mfm.kVAh)}</div><div className="text-[9px] text-slate-500">kVAh</div></div>
              </div>
              <div className="mt-3 space-y-1.5 text-[11px]">
                <div className="flex justify-between"><span className="text-slate-500">Import tariff (11 kV)</span><span className="num">₹ 7.85 / kWh</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Est. import cost (cumulative)</span><span className="num text-slate-200">₹ {fmtInt(mfm.kWhImport * 7.85)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Export credit (solar @ ₹3.1)</span><span className="num text-slate-200">₹ {fmtInt(mfm.kWhExport * 3.1)}</span></div>
                <div className="flex justify-between border-t border-ink-700 pt-1.5"><span className="text-slate-400">Net</span><span className="num text-volt-amber">₹ {fmtInt(mfm.kWhImport * 7.85 - mfm.kWhExport * 3.1)}</span></div>
              </div>
              <p className="text-[10px] text-slate-600 mt-2">6-digit cumulative registers per spec · CT-operated meter · 2 kV AC isolation comms circuit · EMC per IEC 61000-4-2/3/4/5/6</p>
            </Panel>
          </div>
        </div>
      )}
    </div>
  )
}

function HarmonicBars({ harmonics }: { harmonics: number[] }) {
  return (
    <div className="flex items-end gap-3 h-28 px-2">
      {harmonics.map((h, i) => (
        <div key={i} className="flex flex-col items-center gap-1 flex-1">
          <span className="num text-[9px] text-slate-400">{h.toFixed(1)}</span>
          <div
            className="w-full max-w-8 rounded-t bg-gradient-to-t from-cyan-500/30 to-cyan-400/80"
            style={{ height: `${Math.min(100, (h / 6) * 100)}%` }}
          />
          <span className="text-[9px] text-slate-500">H{i + 2}</span>
        </div>
        )
      )}
    </div>
  )
}

function Led({ mini, tone }: { mini?: boolean; tone: 'green' | 'red' }) {
  return <span className={clsx('inline-block rounded-full', mini && 'w-1.5 h-1.5', tone === 'green' ? 'bg-volt-green glow-green' : 'bg-volt-red glow-red')} />
}

function exportMfmCsv(m: Mfm) {
  const rows = [
    'parameter,value,unit',
    ...Object.entries(m).flatMap(([k, v]) =>
      Array.isArray(v)
        ? v.map((x, i) => [`H${i + 2}_harmonic_pct`, x, '%'].join(','))
        : [k, String(typeof v === 'number' ? +v.toFixed(4) : v), ''].join(','),
    ),
  ]
  download(`mfm-${m.name}.csv`, rows.join('\n'))
}
