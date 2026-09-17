import { useMemo, useState } from 'react'
import {
  CartesianGrid, Legend, Line, LineChart, ReferenceArea, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts'
import { Activity, Download, Printer } from 'lucide-react'
import { clsx } from 'clsx'
import { Panel, fmt, fmtTime } from '../components/ui'
import { SubstationId, SUBSTATIONS, TREND_SERIES, TrendPoint } from '../types'
import { telemetryEngine, useStore } from '../store/useStore'
import { download } from './RelaysView'

type CompareMode = 'none' | 'yesterday' | 'prev-shift'
type WindowMode = 'live' | '24h' | '7d' | '30d'

const WINDOW_SPANS: Record<Exclude<WindowMode, 'live'>, { ms: number; stepMs: number; label: string }> = {
  '24h': { ms: 86400000, stepMs: 15 * 60000, label: 'Last 24 hours (15-min trend)' },
  '7d': { ms: 7 * 86400000, stepMs: 60 * 60000, label: 'Last 7 days (hourly trend)' },
  '30d': { ms: 30 * 86400000, stepMs: 6 * 3600000, label: 'Last 30 days (6-hourly trend)' },
}

const PEN_GROUPS: { group: string; keys: (keyof TrendPoint)[] }[] = [
  { group: 'Currents', keys: ['ir', 'iy', 'ib', 'iN'] },
  { group: 'Voltages', keys: ['vRY', 'vYB', 'vBR'] },
  { group: 'Power & quality', keys: ['kw', 'pf', 'hz'] },
]

export default function TrendsView() {
  const snap = useStore((s) => s.snap)
  const substation = useStore((s) => s.selectedSubstation)
  const [ss, setSs] = useState<SubstationId>(substation)
  const [breakerId, setBreakerId] = useState<string>('')
  const [keys, setKeys] = useState<(keyof TrendPoint)[]>(['ir', 'iy', 'ib'])
  const [compare, setCompare] = useState<CompareMode>('none')
  const [win, setWin] = useState<WindowMode>('live')

  const breakers = snap?.breakers.filter((b) => b.substation === ss) ?? []
  const breaker = breakers.find((b) => b.id === breakerId) ?? breakers.find((b) => b.kind === 'incomer') ?? breakers[0]

  const live: TrendPoint[] = useMemo(
    () => (breaker && win === 'live' ? (telemetryEngine.getTrendBuffer(breaker.id) as TrendPoint[]) : []),
    [breaker, snap, win],
  )

  /* historical windows: daily/weekly/monthly (Annexure trend scope) */
  const histData = useMemo(() => {
    if (win === 'live' || !breaker) return null
    const span = WINDOW_SPANS[win]
    const start = Date.now() - span.ms
    const pts = Math.min(240, Math.floor(span.ms / span.stepMs))
    const mfm = snap?.mfms.find((m) => m.breakerId === breaker.id)
    const seed = mfm ? { iR: mfm.iR, vRY: mfm.vRY, pf: mfm.pf } : { iR: 100, vRY: 11000, pf: 0.97 }
    const shape = telemetryEngine.historicalSeries(ss, start, pts, span.stepMs, 'mw')
    /* map the MW envelope onto the selected pens proportionally to live values */
    return shape.map((p) => ({
      t: p.t,
      ir: seed.iR > 0 ? (p.v / 20) * (seed.iR / Math.max(1, seed.iR)) * seed.iR * 1.0 : 0,
      iy: seed.iR > 0 ? (p.v / 20) * seed.iR : 0,
      ib: seed.iR > 0 ? (p.v / 20) * seed.iR * 0.98 : 0,
      iN: seed.iR > 0 ? (p.v / 20) * seed.iR * 0.04 : 0,
      vRY: seed.vRY * (1 + ((p.v % 1) - 0.5) * 0.02),
      vYB: seed.vRY * (1 + ((p.v % 1) - 0.5) * 0.018),
      vBR: seed.vRY * (1 + ((p.v % 1) - 0.5) * 0.019),
      kw: p.v * 1000,
      pf: seed.pf,
      hz: 50 + ((p.v % 0.1) - 0.05),
    }))
  }, [win, breaker, ss, snap])

  /* time-shift comparison: deterministic historical series for the same window */
  const compareData = useMemo(() => {
    if (compare === 'none' || !breaker) return null
    const now = Date.now()
    const span = RING_POINTS * 250
    const start = compare === 'yesterday' ? now - 86400000 - span : now - (4 * 3600000) - span
    return telemetryEngine.historicalSeries(ss, start, 120, span / 120, 'mw')
  }, [compare, breaker, ss])

  const chartData = useMemo(() => {
    const src = win === 'live' ? live : (histData ?? [])
    if (!src.length) return []
    return src.map((p, i) => {
      const row: Record<string, number | undefined> = { t: p.t }
      for (const k of keys) row[k as string] = p[k]
      if (compareData) row.cmp = compareData[Math.floor((i / src.length) * compareData.length)]?.v
      return row
    })
  }, [live, histData, keys, compareData, win])

  const seriesMeta = TREND_SERIES.filter((s) => keys.includes(s.key))

  /* live stat readouts for the header strip */
  const latest = live.length ? live[live.length - 1] : (histData?.[histData.length - 1] ?? null)
  const minMax = useMemo(() => {
    const src = chartData
    const out: { k: string; min: number; max: number; avg: number }[] = []
    for (const s of seriesMeta) {
      const vals = src.map((r) => (r as Record<string, number | undefined>)[s.key as string]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
      if (!vals.length) continue
      out.push({
        k: s.key as string,
        min: Math.min(...vals), max: Math.max(...vals),
        avg: vals.reduce((a, b) => a + b, 0) / vals.length,
      })
    }
    return out
  }, [chartData, seriesMeta])

  const toggle = (k: keyof TrendPoint) =>
    setKeys((ks) => (ks.includes(k) ? ks.filter((x) => x !== k) : [...ks, k].slice(0, 5)))

  if (!snap) return null

  return (
    <div className="h-full flex flex-col gap-3 p-3 min-h-0">
      {/* ------------------------------ control strip ------------------------ */}
      <div className="panel px-3 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div>
          <div className="text-[9px] uppercase tracking-widest text-slate-500 mb-1">Substation</div>
          <div className="flex items-center gap-1 panel p-1 text-xs bg-ink-900/60">
            {SUBSTATIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => { setSs(s.id); setBreakerId('') }}
                className={clsx('px-2.5 py-1 rounded', ss === s.id ? 'bg-cyan-500/15 text-volt-cyan' : 'text-slate-400 hover:text-slate-200')}
              >{s.id}</button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-[9px] uppercase tracking-widest text-slate-500 mb-1">Feeder / bay</div>
          <select
            value={breaker?.id ?? ''}
            onChange={(e) => setBreakerId(e.target.value)}
            className="bg-ink-900 border border-ink-500 rounded px-2 py-1.5 text-xs min-w-[170px]"
          >
            {breakers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>

        <div>
          <div className="text-[9px] uppercase tracking-widest text-slate-500 mb-1">Time window</div>
          <div className="flex items-center gap-1 panel p-1 text-xs bg-ink-900/60">
            {([
              ['live', 'Live'],
              ['24h', '24 h'],
              ['7d', '7 days'],
              ['30d', '30 days'],
            ] as [WindowMode, string][]).map(([m, label]) => (
              <button
                key={m}
                onClick={() => setWin(m)}
                className={clsx('px-2.5 py-1 rounded', win === m ? 'bg-cyan-500/15 text-volt-cyan' : 'text-slate-400 hover:text-slate-200')}
              >{label}</button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-[9px] uppercase tracking-widest text-slate-500 mb-1">Time-shift compare</div>
          <div className="flex items-center gap-1 panel p-1 text-xs bg-ink-900/60">
            {([
              ['none', 'Live only'],
              ['yesterday', 'vs Yesterday'],
              ['prev-shift', 'vs Prev. Shift'],
            ] as [CompareMode, string][]).map(([m, label]) => (
              <button
                key={m}
                onClick={() => setCompare(m)}
                className={clsx('px-2.5 py-1 rounded', compare === m ? 'bg-violet-500/15 text-violet-300' : 'text-slate-400 hover:text-slate-200')}
              >{label}</button>
            ))}
          </div>
        </div>

        <div className="ml-auto flex items-end gap-2">
          <button
            onClick={() => {
              const header = ['timestamp', ...seriesMeta.map((s) => `${s.label}_${s.unit || 'val'}`)]
              if (compareData) header.push('compare_MW')
              const body = chartData.map((r) => {
                const row = r as Record<string, unknown>
                const cells = [new Date(row.t as number).toISOString()]
                for (const s of seriesMeta) cells.push(String(row[s.key as string] ?? ''))
                if (compareData) cells.push(String(row.cmp ?? ''))
                return cells.join(',')
              })
              const rows = [header.join(','), ...body]
              download(`trend-${breaker?.name}.csv`, rows.join('\n'))
            }}
            className="btn-secondary flex items-center gap-1"
          ><Download size={12} /> Export CSV</button>
          <button onClick={() => window.print()} className="btn-secondary flex items-center gap-1"><Printer size={12} /> Print</button>
        </div>
      </div>

      {/* ------------------------------ pen selector ------------------------- */}
      <div className="panel px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="text-[9px] uppercase tracking-widest text-slate-500">Pens (max 5):</span>
        {PEN_GROUPS.map((g) => (
          <div key={g.group} className="flex items-center gap-1.5">
            <span className="text-[10px] text-slate-600 mr-0.5">{g.group}</span>
            {TREND_SERIES.filter((s) => g.keys.includes(s.key)).map((s) => (
              <button
                key={s.key}
                onClick={() => toggle(s.key)}
                className={clsx('flex items-center gap-1.5 px-2 py-1 rounded border text-[11px] transition-colors',
                  keys.includes(s.key) ? 'border-slate-400/60 bg-ink-700/70 text-slate-200' : 'border-ink-700 text-slate-500 hover:border-ink-500')}
              >
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color, opacity: keys.includes(s.key) ? 1 : 0.3 }} />
                {s.label}<span className="text-slate-600">{s.unit}</span>
              </button>
            ))}
          </div>
        ))}
        <span className="ml-auto text-[10px] text-slate-500 num">
          {win === 'live' ? `250 ms sampling · ${live.length}-point ring buffer (60 s)` : WINDOW_SPANS[win].label}
        </span>
      </div>

      {/* ------------------------------ chart + stats ------------------------ */}
      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[1fr_270px] gap-3">
        <Panel
          title={`Trend — ${breaker?.name ?? ''} (${ss})${win !== 'live' ? ` · ${WINDOW_SPANS[win].label}` : ''}`}
          right={
            <span className="flex items-center gap-1.5 text-[10px] text-slate-500">
              <Activity size={11} className={win === 'live' ? 'text-volt-green' : 'text-slate-500'} />
              {win === 'live' ? 'streaming' : 'history'}
            </span>
          }
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
              <CartesianGrid stroke="#1B2537" />
              <XAxis
                dataKey="t"
                type="number"
                domain={['dataMin', 'dataMax']}
                tickFormatter={(t) => fmtTime(t as number)}
                tick={{ fontSize: 10, fill: '#64748B' }}
                stroke="#28324A"
              />
              <YAxis tick={{ fontSize: 10, fill: '#64748B' }} stroke="#28324A" width={54} />
              <Tooltip
                contentStyle={{ background: '#0F1522', border: '1px solid #28324A', borderRadius: 6, fontSize: 11 }}
                labelStyle={{ color: '#94A3B8' }}
                labelFormatter={(t) => fmtTime(t as number)}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {compare !== 'none' && (
                <Line type="monotone" dataKey="cmp" name={`compare (${compare === 'yesterday' ? 'yesterday MW' : 'prev-shift MW'})`} stroke="#A78BFA" dot={false} strokeDasharray="5 3" isAnimationActive={false} />
              )}
              {seriesMeta.map((s) => (
                <Line key={s.key} type="monotone" dataKey={s.key as string} name={`${s.label}${s.unit ? ` (${s.unit})` : ''}`} stroke={s.color} dot={false} isAnimationActive={false} strokeWidth={1.6} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </Panel>

        {/* live readouts / min-max-avg column */}
        <div className="hidden xl:flex flex-col gap-3 min-h-0 overflow-auto">
          <Panel title="Live readout">
            {latest ? (
              <div className="space-y-1.5">
                {seriesMeta.map((s) => {
                  const v = (latest as unknown as Record<string, number | undefined>)[s.key as string]
                  return (
                    <div key={s.key} className="flex items-center justify-between text-[11px]">
                      <span className="flex items-center gap-1.5 text-slate-400">
                        <span className="w-2 h-2 rounded-sm" style={{ background: s.color }} />{s.label}
                      </span>
                      <span className="num text-slate-100">
                        {typeof v === 'number' ? (Math.abs(v) >= 1000 ? fmt(v, 0) : fmt(v, 2)) : '—'}
                        <span className="text-slate-500 ml-1">{s.unit || ''}</span>
                      </span>
                    </div>
                  )
                })}
                {!seriesMeta.length && <p className="text-[11px] text-slate-500">Select at least one pen.</p>}
              </div>
            ) : <p className="text-[11px] text-slate-500">Waiting for telemetry…</p>}
          </Panel>

          <Panel title="Window statistics" className="flex-1">
            {minMax.length ? (
              <table className="w-full text-[10.5px]">
                <thead>
                  <tr className="text-[9px] uppercase tracking-widest text-slate-500 border-b border-ink-700">
                    <th className="text-left py-1">Pen</th><th className="text-right">Min</th><th className="text-right">Avg</th><th className="text-right">Max</th>
                  </tr>
                </thead>
                <tbody>
                  {minMax.map((m) => {
                    const meta = TREND_SERIES.find((s) => s.key === m.k)
                    return (
                      <tr key={m.k} className="border-b border-ink-800/50">
                        <td className="py-1 text-slate-300">{meta?.label ?? m.k}</td>
                        <td className="text-right num text-slate-400">{fmt(m.min, Math.abs(m.min) >= 100 ? 0 : 2)}</td>
                        <td className="text-right num text-slate-200">{fmt(m.avg, Math.abs(m.avg) >= 100 ? 0 : 2)}</td>
                        <td className="text-right num text-slate-400">{fmt(m.max, Math.abs(m.max) >= 100 ? 0 : 2)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            ) : <p className="text-[11px] text-slate-500">No data in window.</p>}
            <p className="text-[9.5px] text-slate-600 mt-2 leading-relaxed">
              Statistics computed over the selected window and pens. CSV export matches the plotted dataset 1:1 for audit traceability.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  )
}

const RING_POINTS = 240
