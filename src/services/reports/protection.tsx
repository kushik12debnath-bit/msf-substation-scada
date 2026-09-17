/* ============================================================================
 * MSF Web SCADA — Protection Performance Report (PRT series)
 * IEC 60255-151 IDMT characteristic verification, IEEE 242 Buff (buffer
 * interval ≈ 0.3 s between main/back-up). Settings register per relay.
 * ==========================================================================*/

import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmt, fmtInt } from '../../components/ui'
import { ReportBase, csvSection, iso, PeriodScope, RANGE_DEFS } from '../reportKit'

export interface ProtectionModel {
  ocCount: number
  efCount: number
  total: number
  byPhase: { phase: string; oc: number; ef: number }[]
  clearingStats: { oc: { avg: number; min: number; max: number }; ef: { avg: number; min: number; max: number } }
  curves: { ts: number; oc: number; ef: number }[]
  settings: {
    relayId: string; breakerId: string; model: string; curve: string; tms: number
    pickupA: number; earthPickupA: number; instPickupA: number
    ocTripCount: number; efTripCount: number; lastTripAt: number | null
  }[]
  tripRows: {
    ts: number; relayId: string; phase: string; type: 'OC' | 'EF'
    faultA: number; pickupA: number; clearingMs: number; curve: string; tms: number
    mult: number; expectedMs: number; devPct: number
  }[]
  worstDeviation: { relayId: string; devPct: number } | null
}

/** IEC 60255-151 operate time for the given curve (secondary current multiple) */
function iecOperateMs(curve: string, tms: number, mult: number): number {
  const k: Record<string, [number, number, number]> = {
    'normal-inverse': [0.14, 0.02, 2.97],
    'very-inverse': [13.5, 1.0, 1.5],
    'extremely-inverse': [80.0, 2.0, 0.708],
    'definite-time': [1, 0, 0],
  }
  const [a, b, p] = k[curve] ?? k['normal-inverse']
  if (curve === 'definite-time') return tms * 1000
  return Math.max(20, tms * (a / (Math.pow(mult, p) - b)) * 1000)
}

export function buildProtection(base: ReportBase): ProtectionModel {
  const trips = base.tripRecords
  const oc = trips.filter((t) => t.type === 'OC')
  const ef = trips.filter((t) => t.type === 'EF')

  const phases = ['R', 'Y', 'B', 'N'] as const
  const byPhase = phases.map((ph) => ({
    phase: ph === 'N' ? 'EF/CBCT' : ph,
    oc: oc.filter((t) => t.phase === ph).length,
    ef: ef.filter((t) => t.phase === ph).length,
  }))

  const stat = (arr: RelayTripArr) => arr.length
    ? { avg: Math.round(arr.reduce((s, t) => s + t.clearingMs, 0) / arr.length), min: Math.min(...arr.map((t) => t.clearingMs)), max: Math.max(...arr.map((t) => t.clearingMs)) }
    : { avg: 0, min: 0, max: 0 }
  type RelayTripArr = typeof trips

  /* timeline of OC vs EF operations (per event index) */
  const curves = trips.map((t, i) => ({
    ts: t.ts, oc: t.type === 'OC' ? t.faultA : null, ef: t.type === 'EF' ? t.faultA : null,
  })).map((r, i) => ({ ts: r.ts, oc: r.oc ?? 0, ef: r.ef ?? 0, i }))

  /* settings register from live relay configuration */
  const settings = base.relays.map((r) => ({
    relayId: r.id, breakerId: r.breakerId, model: r.model, curve: r.curve, tms: r.tms,
    pickupA: r.pickupA, earthPickupA: r.earthPickupA, instPickupA: r.instPickupA,
    ocTripCount: r.ocTripCount, efTripCount: r.efTripCount, lastTripAt: r.lastTripAt,
  }))

  /* characteristic verification: measured vs IEC expected */
  const tripRows = trips.map((t) => {
    const mult = t.faultA / Math.max(1, t.pickupA)
    const expectedMs = iecOperateMs(t.curve, t.tms, mult)
    return {
      ts: t.ts, relayId: t.relayId, phase: t.phase, type: t.type,
      faultA: t.faultA, pickupA: t.pickupA, clearingMs: t.clearingMs, curve: t.curve, tms: t.tms,
      mult: +mult.toFixed(2), expectedMs: Math.round(expectedMs),
      devPct: +(((t.clearingMs - expectedMs) / Math.max(1, expectedMs)) * 100).toFixed(1),
    }
  })

  const worst = tripRows.length
    ? tripRows.reduce((w, t) => (Math.abs(t.devPct) > Math.abs(w.devPct) ? t : w), tripRows[0])
    : null

  return {
    ocCount: oc.length, efCount: ef.length, total: trips.length,
    byPhase, clearingStats: { oc: stat(oc), ef: stat(ef) }, curves,
    settings, tripRows,
    worstDeviation: worst ? { relayId: worst.relayId, devPct: worst.devPct } : null,
  }
}

/* ------------------------------ CSV builder ------------------------------- */

export function protectionCsv(base: ReportBase, m: ProtectionModel, ss: string, scope: PeriodScope, meta: ReturnType<typeof import('../reportKit').makeDocMeta>, standards: string[], preparedBy: string, notes?: string): string {
  const L: string[] = []
  L.push(`MSF Industries — Protection Performance Report (PRT),${meta.reportNo}`)
  L.push(`Substation,${ss}`)
  L.push(`Scope,${scope.period.toUpperCase()} · ${base.hours} h`)
  L.push(`Generated at,${iso(meta.generatedAt)} (IST)`)
  csvSection(L, 'SECTION 1 — TRIP STATISTICS', ['metric', 'overcurrent', 'earth-fault'], [
    ['operations (count)', m.ocCount, m.efCount],
    ['avg clearing time (ms)', m.clearingStats.oc.avg, m.clearingStats.ef.avg],
    ['min clearing time (ms)', m.clearingStats.oc.min, m.clearingStats.ef.min],
    ['max clearing time (ms)', m.clearingStats.oc.max, m.clearingStats.ef.max],
  ])
  csvSection(L, 'SECTION 2 — PHASE DISTRIBUTION', ['phase', 'oc_ops', 'ef_ops'], m.byPhase.map((p) => [p.phase, p.oc, p.ef]))
  csvSection(L, 'SECTION 3 — IEC 60255-151 CHARACTERISTIC VERIFICATION', ['timestamp', 'relay_id', 'phase', 'element', 'fault_a', 'pickup_a', 'multiple_x', 'clearing_ms', 'iec_expected_ms', 'deviation_pct', 'curve', 'tms'],
    m.tripRows.map((t) => [iso(t.ts), t.relayId, t.phase, t.type, t.faultA.toFixed(0), t.pickupA.toFixed(0), t.mult, t.clearingMs, t.expectedMs, t.devPct, t.curve, t.tms]))
  csvSection(L, 'SECTION 4 — RELAY SETTINGS REGISTER', ['relay_id', 'breaker', 'model', 'curve', 'tms', 'pickup_a', 'earth_pickup_a', 'inst_a', 'oc_trips_life', 'ef_trips_life'],
    m.settings.map((s) => [s.relayId, s.breakerId, s.model, s.curve, s.tms, s.pickupA, s.earthPickupA, s.instPickupA, s.ocTripCount, s.efTripCount]))
  csvSection(L, 'SECTION 4B — RANGE & LIMIT DEFINITIONS', ['parameter', 'nominal', 'acceptable_range', 'hard_limit', 'standard'],
    RANGE_DEFS.filter((d) => ['clearing', 'cbct', 'sync'].includes(d.id)).map((d) => [d.parameter, d.nominal, d.acceptableRange, d.hardLimit, d.standard]))
  L.push('')
  L.push(`CROSS-REFERENCES,ENR §5 trip table (MSF/ENR series) · ALM SOE annex (MSF/ALM series) · CMP calibration (MSF/CMP series)`)
  L.push(`STANDARDS,${standards.join('; ')}`)
  L.push(`RECORD DIGEST,${meta.digest}`)
  L.push(`END OF REPORT — ${meta.reportNo} — machine-generated by MSF Web SCADA v1.0`)
  return L.join('\n')
}

/* ------------------------------ view segments ----------------------------- */

export function ProtectionCharts({ m }: { m: ProtectionModel }) {
  const data = m.curves.map((c, i) => ({ idx: i + 1, oc: c.oc || null, ef: c.ef || null }))
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <section>
        <h3 className="report-sec">P1 · Trip Event Magnitudes (OC vs EF)</h3>
        <div className="h-52 border border-ink-700 rounded bg-ink-900/40 p-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: -8 }}>
              <CartesianGrid stroke="#1B2537" />
              <XAxis dataKey="idx" tick={{ fontSize: 9, fill: '#64748B' }} stroke="#28324A" />
              <YAxis tick={{ fontSize: 9, fill: '#64748B' }} stroke="#28324A" width={62} />
              <Tooltip contentStyle={{ background: '#0F1522', border: '1px solid #28324A', fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Line type="monotone" dataKey="oc" name="OC fault A" stroke="#F87171" dot={{ r: 2 }} connectNulls strokeWidth={1.6} />
              <Line type="monotone" dataKey="ef" name="EF fault A" stroke="#FBBF24" dot={{ r: 2 }} connectNulls strokeWidth={1.6} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
      <section>
        <h3 className="report-sec">P2 · Clearing-Time Conformance (measured vs IEC expected, ±5 % band)</h3>
        <div className="h-52 border border-ink-700 rounded bg-ink-900/40 p-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={m.tripRows.map((t, i) => ({ idx: i + 1, measured: t.clearingMs, iec: t.expectedMs }))} margin={{ top: 6, right: 12, bottom: 0, left: -8 }}>
              <CartesianGrid stroke="#1B2537" />
              <XAxis dataKey="idx" tick={{ fontSize: 9, fill: '#64748B' }} stroke="#28324A" />
              <YAxis tick={{ fontSize: 9, fill: '#64748B' }} stroke="#28324A" width={62} />
              <Tooltip contentStyle={{ background: '#0F1522', border: '1px solid #28324A', fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <ReferenceLine y={300} stroke="#F87171" strokeDasharray="3 3" strokeWidth={1.2}
                label={{ value: 'IEEE 242 Buff 300 ms', position: 'insideTopRight', fill: '#F87171', fontSize: 9 }} />
              <Line type="monotone" dataKey="measured" name="Measured ms" stroke="#22D3EE" dot={{ r: 2 }} strokeWidth={1.6} />
              <Line type="monotone" dataKey="iec" name="IEC 60255 expected ms" stroke="#A78BFA" dot={false} strokeDasharray="5 3" strokeWidth={1.4} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  )
}

export function ProtectionTables({ m, base }: { m: ProtectionModel; base: ReportBase }) {
  return (
    <>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <section>
          <h3 className="report-sec">P3 · Operations by Phase</h3>
          <table className="w-full text-[10.5px]">
            <thead>
              <tr>
                <th className="py-1.5 px-2 text-left text-[9px] uppercase tracking-[0.14em] text-slate-500 border-b border-ink-600">Phase</th>
                <th className="py-1.5 px-2 text-right text-[9px] uppercase tracking-[0.14em] text-slate-500 border-b border-ink-600">OC ops</th>
                <th className="py-1.5 px-2 text-right text-[9px] uppercase tracking-[0.14em] text-slate-500 border-b border-ink-600">EF ops</th>
              </tr>
            </thead>
            <tbody>
              {m.byPhase.map((p) => (
                <tr key={p.phase}>
                  <td className="py-1.5 px-2 border-b border-ink-800/50 text-slate-300">{p.phase}</td>
                  <td className="py-1.5 px-2 border-b border-ink-800/50 text-right num text-slate-200">{p.oc || '—'}</td>
                  <td className="py-1.5 px-2 border-b border-ink-800/50 text-right num text-slate-200">{p.ef || '—'}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="py-1.5 px-2 text-slate-100">Total</td>
                <td className="py-1.5 px-2 text-right num text-slate-100">{m.ocCount}</td>
                <td className="py-1.5 px-2 text-right num text-slate-100">{m.efCount}</td>
              </tr>
            </tbody>
          </table>
        </section>
        <section>
          <h3 className="report-sec">P4 · Clearing-Time Statistics</h3>
          <table className="w-full text-[10.5px]">
            <thead>
              <tr>
                <th className="py-1.5 px-2 text-left text-[9px] uppercase tracking-[0.14em] text-slate-500 border-b border-ink-600">Element</th>
                <th className="py-1.5 px-2 text-right text-[9px] uppercase tracking-[0.14em] text-slate-500 border-b border-ink-600">Avg ms</th>
                <th className="py-1.5 px-2 text-right text-[9px] uppercase tracking-[0.14em] text-slate-500 border-b border-ink-600">Min ms</th>
                <th className="py-1.5 px-2 text-right text-[9px] uppercase tracking-[0.14em] text-slate-500 border-b border-ink-600">Max ms</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="py-1.5 px-2 border-b border-ink-800/50 text-slate-300">Overcurrent</td>
                <td className="py-1.5 px-2 border-b border-ink-800/50 text-right num text-slate-200">{m.clearingStats.oc.avg || '—'}</td>
                <td className="py-1.5 px-2 border-b border-ink-800/50 text-right num text-slate-400">{m.clearingStats.oc.min || '—'}</td>
                <td className="py-1.5 px-2 border-b border-ink-800/50 text-right num text-slate-400">{m.clearingStats.oc.max || '—'}</td>
              </tr>
              <tr>
                <td className="py-1.5 px-2 text-slate-300">Earth fault</td>
                <td className="py-1.5 px-2 text-right num text-slate-200">{m.clearingStats.ef.avg || '—'}</td>
                <td className="py-1.5 px-2 text-right num text-slate-400">{m.clearingStats.ef.min || '—'}</td>
                <td className="py-1.5 px-2 text-right num text-slate-400">{m.clearingStats.ef.max || '—'}</td>
              </tr>
            </tbody>
          </table>
          <p className="text-[9.5px] text-slate-600 mt-2 leading-relaxed">
            IEEE 242 Buff criterion: main/back-up clearing interval ≈ 300 ms at maximum fault level.
            {m.worstDeviation && <> Largest characteristic deviation: <span className="num text-slate-400">{m.worstDeviation.relayId}</span> ({m.worstDeviation.devPct > 0 ? '+' : ''}{m.worstDeviation.devPct}% vs IEC curve).</>}
          </p>
        </section>
        <section>
          <h3 className="report-sec">P5 · Relay Settings Snapshot</h3>
          <div className="max-h-48 overflow-y-auto border border-ink-700 rounded">
            <table className="w-full text-[10.5px]">
              <thead className="bg-ink-800/70 sticky top-0">
                <tr>
                  <th className="py-1.5 px-2 text-left text-[9px] uppercase tracking-widest text-slate-500 border-b border-ink-600">Relay</th>
                  <th className="py-1.5 px-2 text-left text-[9px] uppercase tracking-widest text-slate-500 border-b border-ink-600">Curve</th>
                  <th className="py-1.5 px-2 text-right text-[9px] uppercase tracking-widest text-slate-500 border-b border-ink-600">TMS</th>
                  <th className="py-1.5 px-2 text-right text-[9px] uppercase tracking-widest text-slate-500 border-b border-ink-600">Pickup A</th>
                </tr>
              </thead>
              <tbody>
                {m.settings.map((s) => (
                  <tr key={s.relayId}>
                    <td className="py-1 px-2 border-b border-ink-800/50 num text-slate-300">{s.relayId}</td>
                    <td className="py-1 px-2 border-b border-ink-800/50 text-slate-500">{s.curve.replace('-', ' ')}</td>
                    <td className="py-1 px-2 border-b border-ink-800/50 text-right num text-slate-200">{s.tms.toFixed(2)}</td>
                    <td className="py-1 px-2 border-b border-ink-800/50 text-right num text-slate-300">{fmtInt(s.pickupA)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  )
}
