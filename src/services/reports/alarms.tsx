/* ============================================================================
 * MSF Web SCADA — Alarm & SOE Analysis Report (ALM series)
 * IEC 62682 / ISA-18.2 alarm-management metrics: alarm rate per operator hour,
 * distribution by class/severity, acknowledgement performance, SOE annex.
 * ==========================================================================*/

import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmt, fmtMs } from '../../components/ui'
import { DonutChart, GaugeChart, HistogramChart } from '../reportCharts'
import { Alarm, AlarmClass } from '../../types'
import { ReportBase, csvSection, iso, PeriodScope, RANGE_DEFS } from '../reportKit'

const CLASSES: AlarmClass[] = ['overvoltage', 'undervoltage', 'overcurrent', 'earthfault', 'freq-drift', 'trip', 'comm-fail', 'breaker-op', 'info']

const CLASS_TONE: Record<AlarmClass, string> = {
  overvoltage: '#F87171', undervoltage: '#FB923C', overcurrent: '#F87171',
  earthfault: '#FBBF24', 'freq-drift': '#A78BFA', trip: '#F43F5E',
  'comm-fail': '#94A3B8', 'breaker-op': '#22D3EE', info: '#64748B',
}

export interface AlarmsModel {
  total: number
  byClass: { cls: string; count: number; color: string }[]
  bySeverity: { sev: string; count: number; color: string }[]
  ratePerHour: number
  ackPerf: { acked: number; pending: number; ackRatePct: number; avgAckSec: number; target: number }
  floodCheck: { standing: number; floodPct: number; iec62682: 'healthy' | 'review' | 'flood' }
  soeRows: { seq: number; ts: number; source: string; message: string; severity: string; ackBy?: string; ackAt?: number }[]
  bySsTop: { source: string; count: number }[]
  ackHistogram: { bucket: string; count: number }[]
}

export function buildAlarms(base: ReportBase, ss: string): AlarmsModel {
  const alarms = base.alarms as Alarm[]
  const byClass = CLASSES.map((c) => ({
    cls: c, count: alarms.filter((a) => a.cls === c).length, color: CLASS_TONE[c],
  })).filter((x) => x.count > 0)

  const sevColors: Record<string, string> = { critical: '#F87171', major: '#FBBF24', warning: '#22D3EE', info: '#64748B' }
  const bySeverity = (['critical', 'major', 'warning', 'info'] as const).map((s) => ({
    sev: s, count: alarms.filter((a) => a.severity === s).length, color: sevColors[s],
  })).filter((x) => x.count > 0)

  const acked = alarms.filter((a) => a.acknowledged)
  const pending = alarms.length - acked.length
  const ackDurations = acked
    .filter((a) => a.ackAt && a.ackAt >= a.ts)
    .map((a) => (a.ackAt! - a.ts) / 1000)
  const avgAckSec = ackDurations.length ? Math.round(ackDurations.reduce((s, d) => s + d, 0) / ackDurations.length) : 0

  /* ISA-18.2: standing alarms > 50 % or > 10/h announce-rate → flood review */
  const standing = alarms.filter((a) => a.active).length
  const floodPct = alarms.length ? (standing / alarms.length) * 100 : 0
  const ratePerHour = alarms.length / Math.max(1, base.hours)

  const bySource = new Map<string, number>()
  for (const a of alarms) bySource.set(a.source, (bySource.get(a.source) ?? 0) + 1)
  const bySsTop = [...bySource.entries()].map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count).slice(0, 8)

  /* ack-time distribution vs ISA-18.2 target (< 600 s) */
  const ackHistogram = [
    { bucket: '<60s', count: ackDurations.filter((d) => d < 60).length },
    { bucket: '60–300s', count: ackDurations.filter((d) => d >= 60 && d < 300).length },
    { bucket: '300–600s', count: ackDurations.filter((d) => d >= 300 && d < 600).length },
    { bucket: '>600s', count: ackDurations.filter((d) => d >= 600).length },
  ]

  return {
    total: alarms.length,
    byClass, bySeverity,
    ratePerHour: +ratePerHour.toFixed(2),
    ackHistogram,
    ackPerf: {
      acked: acked.length, pending,
      ackRatePct: alarms.length ? +((acked.length / alarms.length) * 100).toFixed(1) : 100,
      avgAckSec, target: 600, /* ISA-18.2 target: acknowledge < 10 min */
    },
    floodCheck: {
      standing, floodPct: +floodPct.toFixed(1),
      iec62682: ratePerHour > 10 || floodPct > 50 ? 'flood' : ratePerHour > 6 ? 'review' : 'healthy',
    },
    soeRows: alarms.slice(0, 40).map((a, i) => ({
      seq: i + 1, ts: a.ts, source: a.source, message: a.message, severity: a.severity,
      ackBy: a.ackBy, ackAt: a.ackAt,
    })),
    bySsTop,
  }
}

/* ------------------------------ CSV builder ------------------------------- */

export function alarmsCsv(base: ReportBase, m: AlarmsModel, ss: string, scope: PeriodScope, meta: ReturnType<typeof import('../reportKit').makeDocMeta>, standards: string[], notes?: string): string {
  const L: string[] = []
  L.push(`MSF Industries — Alarm & SOE Analysis Report (ALM),${meta.reportNo}`)
  L.push(`Substation,${ss}`)
  L.push(`Scope,${scope.period.toUpperCase()} · ${base.hours} h`)
  L.push(`Generated at,${iso(meta.generatedAt)} (IST)`)
  csvSection(L, 'SECTION 1 — ISA-18.2 / IEC 62682 METRICS', ['metric', 'value', 'target'], [
    ['alarm rate (per hour)', m.ratePerHour, '< 6 healthy · > 10 flood'],
    ['standing alarms', m.floodCheck.standing, '< 50 % of total'],
    ['acknowledgement rate', `${m.ackPerf.ackRatePct} %`, '100 %'],
    ['avg acknowledge time (s)', m.ackPerf.avgAckSec, '< 600 s'],
    ['system assessment', m.floodCheck.iec62682, 'IEC 62682 §annex'],
  ])
  csvSection(L, 'SECTION 2 — DISTRIBUTION BY CLASS', ['class', 'count'], m.byClass.map((c) => [c.cls, c.count]))
  csvSection(L, 'SECTION 2B — ACK-TIME DISTRIBUTION (target < 600 s)', ['bucket', 'count'], m.ackHistogram.map((b) => [b.bucket, b.count]))
  csvSection(L, 'SECTION 3 — DISTRIBUTION BY SEVERITY', ['severity', 'count'], m.bySeverity.map((s) => [s.sev, s.count]))
  csvSection(L, 'SECTION 4 — TOP ALARM SOURCES', ['source', 'count'], m.bySsTop.map((s) => [s.source, s.count]))
  csvSection(L, 'SECTION 4B — RANGE & LIMIT DEFINITIONS', ['parameter', 'nominal', 'acceptable_range', 'hard_limit', 'standard'],
    RANGE_DEFS.filter((d) => ['alarm-rate', 'ack', 'sync'].includes(d.id)).map((d) => [d.parameter, d.nominal, d.acceptableRange, d.hardLimit, d.standard]))
  csvSection(L, 'SECTION 5 — SOE ANNEX (sequence-of-events)', ['seq', 'timestamp', 'source', 'severity', 'message', 'ack_by', 'ack_time'],
    m.soeRows.map((r) => [r.seq, iso(r.ts), r.source, r.severity, r.message, r.ackBy ?? '', r.ackAt ? iso(r.ackAt) : '']))
  L.push('')
  L.push(`CROSS-REFERENCES,ENR Annexure-A alarm register (MSF/ENR series) · PRT trip events (MSF/PRT series)`)
  L.push(`STANDARDS,${standards.join('; ')}`)
  L.push(`RECORD DIGEST,${meta.digest}`)
  L.push(`END OF REPORT — ${meta.reportNo} — machine-generated by MSF Web SCADA v1.0`)
  return L.join('\n')
}

/* ------------------------------ view segments ----------------------------- */

export function AlarmCharts({ m }: { m: AlarmsModel }) {
  return (
    <>
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <section className="xl:col-span-2">
        <h3 className="report-sec">M1 · Distribution by Alarm Class</h3>
        <div className="h-48 border border-ink-700 rounded bg-ink-900/40 p-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={m.byClass} margin={{ top: 6, right: 12, bottom: 0, left: -8 }}>
              <CartesianGrid stroke="#1B2537" />
              <XAxis dataKey="cls" tick={{ fontSize: 8.5, fill: '#64748B' }} stroke="#28324A" interval={0} angle={-22} textAnchor="end" height={46} />
              <YAxis tick={{ fontSize: 9, fill: '#64748B' }} stroke="#28324A" allowDecimals={false} width={34} />
              <Tooltip contentStyle={{ background: '#0F1522', border: '1px solid #28324A', fontSize: 11 }} />
              <Bar dataKey="count" name="alarms" radius={[3, 3, 0, 0]}>
                {m.byClass.map((c) => <Cell key={c.cls} fill={c.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
      <section>
        <h3 className="report-sec">M2 · Severity Mix (pie)</h3>
        <div className="h-48 border border-ink-700 rounded bg-ink-900/40 p-2">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={m.bySeverity} dataKey="count" nameKey="sev" innerRadius={34} outerRadius={58} paddingAngle={2} stroke="#0B0F17">
                {m.bySeverity.map((s) => <Cell key={s.sev} fill={s.color} />)}
              </Pie>
              <Tooltip contentStyle={{ background: '#0F1522', border: '1px solid #28324A', fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </section>
      <section>
        <h3 className="report-sec">M2b · IEC 62682 Alarm-Rate Gauge (flood &gt; 10/h)</h3>
        <div className="h-48 border border-ink-700 rounded bg-ink-900/40 p-2 flex items-center justify-center">
          <div className="w-52 h-36">
            <GaugeChart
              value={m.ratePerHour} min={0} max={15}
              label={`alarms/h · state: ${m.floodCheck.iec62682}`}
              bandColor={m.floodCheck.iec62682 === 'healthy' ? '#4ADE80' : m.floodCheck.iec62682 === 'review' ? '#FBBF24' : '#F87171'}
            />
          </div>
        </div>
      </section>
    </div>
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-4">
      <section>
        <h3 className="report-sec">M2c · Acknowledge-Time Histogram (ISA-18.2 target &lt; 600 s)</h3>
        <div className="h-48 border border-ink-700 rounded bg-ink-900/40 p-2">
          <ResponsiveContainer width="100%" height="100%">
            <HistogramChart data={m.ackHistogram} unit="alarms" color="#FBBF24" />
          </ResponsiveContainer>
        </div>
      </section>
      <section>
        <h3 className="report-sec">M2d · Standing vs Acknowledged (donut)</h3>
        <div className="h-48 border border-ink-700 rounded bg-ink-900/40 p-2">
          <ResponsiveContainer width="100%" height="100%">
            <DonutChart
              unit="alarms"
              data={[
                { name: 'acknowledged', value: m.ackPerf.acked, color: '#4ADE80' },
                { name: 'standing', value: m.ackPerf.pending, color: m.floodCheck.floodPct > 50 ? '#F87171' : '#FBBF24' },
              ]}
            />
          </ResponsiveContainer>
        </div>
      </section>
    </div>
    </>
  )
}

export function AlarmTables({ m }: { m: AlarmsModel }) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <section>
        <h3 className="report-sec">M3 · ISA-18.2 Metrics</h3>
        <table className="w-full text-[10.5px]">
          <tbody>
            {[
              ['Alarm rate', `${m.ratePerHour}/h`, 'healthy < 6/h · flood > 10/h'],
              ['Standing alarms', `${m.floodCheck.standing} (${m.floodCheck.floodPct}%)`, '< 50 % of total'],
              ['Acknowledged', `${m.ackPerf.acked}/${m.total} (${m.ackPerf.ackRatePct}%)`, 'target 100 %'],
              ['Avg ack time', m.ackPerf.avgAckSec ? `${m.ackPerf.avgAckSec} s` : '—', 'target < 600 s'],
              ['IEC 62682 state', m.floodCheck.iec62682.toUpperCase(), m.floodCheck.iec62682 === 'healthy' ? 'no action' : 'rationalisation review'],
            ].map(([k, v, t]) => (
              <tr key={k}>
                <td className="py-1.5 px-2 border-b border-ink-800/50 text-slate-300">{k}</td>
                <td className="py-1.5 px-2 border-b border-ink-800/50 text-right num text-slate-100">{v}</td>
                <td className="py-1.5 px-2 border-b border-ink-800/50 text-slate-600 text-[9.5px]">{t}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <h3 className="report-sec">M4 · Top Alarm Sources</h3>
        <table className="w-full text-[10.5px]">
          <tbody>
            {m.bySsTop.map((s) => (
              <tr key={s.source}>
                <td className="py-1 px-2 border-b border-ink-800/50 num text-slate-300">{s.source}</td>
                <td className="py-1 px-2 border-b border-ink-800/50 text-right num text-slate-200">{s.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <h3 className="report-sec">M5 · SOE Annex (latest 12)</h3>
        <div className="max-h-48 overflow-y-auto border border-ink-700 rounded">
          <table className="w-full text-[10px]">
            <tbody>
              {m.soeRows.slice(0, 12).map((r) => (
                <tr key={r.seq}>
                  <td className="py-1 px-1.5 border-b border-ink-800/50 num text-slate-500 w-6">{r.seq}</td>
                  <td className="py-1 px-1.5 border-b border-ink-800/50 num text-slate-300 whitespace-nowrap">{fmtMs(r.ts)}</td>
                  <td className="py-1 px-1.5 border-b border-ink-800/50 num text-slate-400">{r.source}</td>
                  <td className="py-1 px-1.5 border-b border-ink-800/50 text-slate-400 truncate max-w-[140px]" title={r.message}>{r.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
