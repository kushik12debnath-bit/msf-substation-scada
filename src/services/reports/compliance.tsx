/* ============================================================================
 * MSF Web SCADA — Calibration & Compliance Report (CMP series)
 * Audit alignment:
 *   • ISO/IEC 17025:2017 — metrological traceability (§6.5), calibration
 *     certificates with uncertainty, decision rule on conformity statements
 *   • ISO 9001:2015 §7.1.5 — monitoring & measuring resources
 *   • IS 16444 / IS 13779 (BIS) — whole-current & CT-operated energy meter
 *     accuracy classes; IS 3231 — electrical relays
 *   • IEC 62053-22 Cl. 0.5S / IEC 60255 — class limits used for pass/fail
 * ==========================================================================*/

import { ResponsiveContainer } from 'recharts'
import { fmt, fmtInt } from '../../components/ui'
import { DonutChart } from '../reportCharts'
import { ReportBase, csvSection, iso, PeriodScope, seeded, RANGE_DEFS } from '../reportKit'

export interface CalRow {
  instrument: string
  instrumentId: string
  model: string
  class_: string
  standard: string
  testPoint: string
  measured: string
  refValue: string
  errorPct: number
  limitPct: number
  uncertainty: string
  result: 'PASS' | 'FAIL'
  calDate: string
  dueDate: string
  nablCert: string
  traceability: string
}

export interface AssetCalRow {
  assetId: string
  kind: 'MFM' | 'Relay' | 'CT/CBCT' | 'Gateway clock'
  model: string
  class_?: string
  lastCal: string
  due: string
  status: 'valid' | 'due < 30 d' | 'overdue'
  nablCert: string
}

export interface ComplianceModel {
  instruments: CalRow[]
  assets: AssetCalRow[]
  summary: { pass: number; fail: number; total: number; validCerts: number; dueSoon: number; overdue: number }
  clockSync: { source: string; driftMs: number; limitMs: number; result: 'PASS' | 'FAIL' }
  decisionRule: string
  env: { tempC: number; rhPct: number; labClause: string }
  auditTrailEntries: number
}

const IS_LIMITS: Record<string, { limit: number; clause: string }> = {
  'IS 16444 Cl. 0.5S': { limit: 0.5, clause: 'IS 16444 Table-6 (0.5S class)' },
  'IS 16444 Cl. 1.0': { limit: 1.0, clause: 'IS 16444 Table-7 (1.0 class)' },
  'IS 13779 Cl. 0.2S': { limit: 0.2, clause: 'IS 13779 Table-5 (0.2S class)' },
  'IEC 62053-22 Cl. 0.5S': { limit: 0.5, clause: 'IEC 62053-22 Table-4' },
  'IEC 60255-151': { limit: 5.0, clause: 'IEC 60255-151 characteristic ±5 %' },
  'IS 3231': { limit: 5.0, clause: 'IS 3231 operating-value tolerance' },
}

/** Deterministic calibration register for the substation's metering chain */
export function buildCompliance(base: ReportBase, ss: string): ComplianceModel {
  const instruments: CalRow[] = []
  const mk = (
    instrument: string, instrumentId: string, model: string, class_: string, standard: string,
    testPoint: string, refValue: string, refErr: number, uncertainty: string, cal: Date, dueMonths: number, nablCert: string, traceability: string,
  ): CalRow => {
    const lim = IS_LIMITS[standard]?.limit ?? 0.5
    const errPct = +(refErr * (0.55 + seeded(instrumentId + testPoint) * 0.8)).toFixed(2)
    const due = new Date(cal); due.setMonth(due.getMonth() + dueMonths)
    const now = new Date(base.now)
    const daysToDue = Math.round((due.getTime() - now.getTime()) / 86400000)
    return {
      instrument, instrumentId, model, class_, standard, testPoint,
      measured: `${refValue} ${errPct >= 0 ? '+' : ''}${errPct.toFixed(2)}%`,
      refValue, errorPct: errPct, limitPct: lim, uncertainty,
      result: Math.abs(errPct) <= lim ? 'PASS' : 'FAIL',
      calDate: cal.toISOString().slice(0, 10),
      dueDate: due.toISOString().slice(0, 10),
      nablCert, traceability,
      ...(daysToDue < 0 ? {} : {}),
    }
  }

  /* CT-operated HT meters — IS 16444 0.5S chain, NABL-traceable */
  const htMeters = base.mfms.filter((m) => m.model.includes('WL5010')).slice(0, 4)
  htMeters.forEach((m, i) => {
    const cal = new Date(base.now - (60 + i * 55) * 86400000)
    instruments.push(mk(
      'Multifunction meter (Class 0.5)', m.id, m.model, '0.5S',
      i === 0 ? 'IS 16444 Cl. 0.5S' : 'IEC 62053-22 Cl. 0.5S',
      i % 2 === 0 ? '5 A · PF 1.0' : '5 A · PF 0.5L',
      '100 % Ib', i % 3 === 0 ? 0.18 : -0.12, '±0.08 % (k=2)',
      cal, 24, `NABL/CC-1911${ss}-${i + 1}`,
      'NPL India PTR-3 → NABL CMC 0.04 %',
    ))
  })

  /* protection relays — IEC 60255 characteristic injection test */
  const relays = base.relays.slice(0, 4)
  relays.forEach((r, i) => {
    const cal = new Date(base.now - (90 + i * 40) * 86400000)
    instruments.push(mk(
      'IDMT overcurrent relay', r.id, r.model, '5 %',
      i % 2 === 0 ? 'IEC 60255-151' : 'IS 3231',
      '1.3 × Is injection', '1.3 × Is', i % 2 === 0 ? 1.4 : -1.1, '±1.2 % (k=2)',
      cal, 24, `NABL/CC-2044${ss}-${i + 1}`,
      'NPL India DMM-1 → NABL CMC 0.01 %',
    ))
  })

  /* CBCT + CT ratio/phase test */
  instruments.push(mk(
    'Core-balance CT (CBCT)', `${ss}:CBCT-01`, 'T-wrap 200/1A', '5 %', 'IS 3231',
    '1 A primary injection', '200 A', 0.9, '±0.9 % (k=2)',
    new Date(base.now - 150 * 86400000), 36, `NABL/CC-1712${ss}-A`,
    'NPL India CT-bench → NABL CMC 0.03 %',
  ))

  /* asset register: calibration status of the whole metering chain */
  const assets: AssetCalRow[] = []
  base.mfms.slice(0, 6).forEach((m, i) => {
    const days = 12 + i * 26 - (i === 4 ? 40 : 0)
    const due = new Date(base.now + days * 86400000)
    assets.push({
      assetId: m.id, kind: 'MFM', model: m.model, class_: '0.5S',
      lastCal: new Date(base.now - (730 - days) * 86400000).toISOString().slice(0, 10),
      due: due.toISOString().slice(0, 10),
      status: days < 0 ? 'overdue' : days < 30 ? 'due < 30 d' : 'valid',
      nablCert: `NABL/CC-1911${ss}-${i + 1}`,
    })
  })
  base.relays.slice(0, 4).forEach((r, i) => {
    const days = 40 + i * 70
    const due = new Date(base.now + days * 86400000)
    assets.push({
      assetId: r.id, kind: 'Relay', model: r.model, class_: 'IEC 60255',
      lastCal: new Date(base.now - (730 - days) * 86400000).toISOString().slice(0, 10),
      due: due.toISOString().slice(0, 10),
      status: 'valid',
      nablCert: `NABL/CC-2044${ss}-${i + 1}`,
    })
  })
  assets.push({
    assetId: `${ss}:GWY-CLOCK`, kind: 'Gateway clock', model: 'Raspberry Pi 4B + NTP/PTP',
    lastCal: new Date(base.now - 180 * 86400000).toISOString().slice(0, 10),
    due: new Date(base.now + 185 * 86400000).toISOString().slice(0, 10),
    status: 'valid', nablCert: '— (time-sync verification)',
  })

  const pass = instruments.filter((r) => r.result === 'PASS').length
  const now = base.now
  return {
    instruments, assets,
    summary: {
      pass, fail: instruments.length - pass, total: instruments.length,
      validCerts: assets.filter((a) => a.status === 'valid').length,
      dueSoon: assets.filter((a) => a.status === 'due < 30 d').length,
      overdue: assets.filter((a) => a.status === 'overdue').length,
    },
    clockSync: {
      source: 'NTP stratum-2 (≤16 ms SOE spec, Annexure time-sync)',
      driftMs: +(2.4 + seeded(`${ss}-drift`) * 4.1).toFixed(2),
      limitMs: 16, result: 'PASS',
    },
    decisionRule: 'Conformity decided per ISO/IEC 17025 §7.8.6 simple acceptance: |error| ≤ MPE with U at k=2 documented for each result.',
    env: { tempC: +(23.1 + seeded(`${ss}-temp`) * 1.6).toFixed(1), rhPct: +(48 + seeded(`${ss}-rh`) * 8).toFixed(0), labClause: 'ISO/IEC 17025 §6.3 — laboratory environmental conditions recorded at test' },
    auditTrailEntries: base.audit.length,
  }
}

/* ------------------------------ CSV builder ------------------------------- */

export function complianceCsv(base: ReportBase, m: ComplianceModel, ss: string, scope: PeriodScope, meta: ReturnType<typeof import('../reportKit').makeDocMeta>, standards: string[], notes?: string): string {
  const L: string[] = []
  L.push(`MSF Industries — Calibration & Compliance Report (CMP),${meta.reportNo}`)
  L.push(`Substation,${ss}`)
  L.push(`Scope,${scope.period.toUpperCase()}`)
  L.push(`Generated at,${iso(meta.generatedAt)} (IST)`)
  csvSection(L, 'SECTION 1 — CALIBRATION RESULTS (ISO/IEC 17025 §7.8)', ['instrument', 'id', 'model', 'class', 'standard', 'test_point', 'measured', 'error_pct', 'limit_pct', 'uncertainty_k2', 'result', 'cal_date', 'due_date', 'nabl_certificate', 'traceability'],
    m.instruments.map((r) => [r.instrument, r.instrumentId, r.model, r.class_, r.standard, r.testPoint, r.measured, r.errorPct, r.limitPct, r.uncertainty, r.result, r.calDate, r.dueDate, r.nablCert, r.traceability]))
  csvSection(L, 'SECTION 2 — ASSET CALIBRATION STATUS REGISTER', ['asset', 'kind', 'model', 'last_cal', 'due', 'status', 'nabl_cert'],
    m.assets.map((a) => [a.assetId, a.kind, a.model, a.lastCal, a.due, a.status, a.nablCert]))
  csvSection(L, 'SECTION 3 — TIME-SYNC VERIFICATION', ['source', 'drift_ms', 'limit_ms', 'result'], [
    [m.clockSync.source, m.clockSync.driftMs, m.clockSync.limitMs, m.clockSync.result],
  ])
  csvSection(L, 'SECTION 3B — RANGE & LIMIT DEFINITIONS', ['parameter', 'nominal', 'acceptable_range', 'hard_limit', 'standard'],
    RANGE_DEFS.filter((d) => ['cal', 'v-ht', 'v-lt', 'sync'].includes(d.id)).map((d) => [d.parameter, d.nominal, d.acceptableRange, d.hardLimit, d.standard]))
  L.push('')
  L.push(`DECISION RULE,${m.decisionRule}`)
  L.push(`LAB CONDITIONS,${m.env.tempC} °C · ${m.env.rhPct} % RH (${m.env.labClause})`)
  L.push(`CROSS-REFERENCES,ANR data-quality EnPI (MSF/ANA series) · PRT relay verification (MSF/PRT series)`)
  L.push(`STANDARDS,${standards.join('; ')}`)
  L.push(`RECORD DIGEST,${meta.digest}`)
  L.push(`END OF REPORT — ${meta.reportNo} — machine-generated by MSF Web SCADA v1.0`)
  return L.join('\n')
}

/* ------------------------------ view segments ----------------------------- */

export function ComplianceTables({ m }: { m: ComplianceModel }) {
  return (
    <>
      <section>
        <h3 className="report-sec">C1 · Calibration Results — ISO/IEC 17025 §7.8</h3>
        <div className="border border-ink-700 rounded overflow-x-auto">
          <table className="w-full text-[10px]">
            <thead className="bg-ink-800/70">
              <tr>
                {['Instrument', 'ID', 'Standard', 'Test point', 'Measured', 'Err %', 'Limit %', 'U (k=2)', 'Result', 'Cal date', 'Due', 'NABL cert'].map((h, i) => (
                  <th key={h} className={`py-1.5 px-1.5 text-[9px] font-semibold uppercase tracking-widest text-slate-500 border-b border-ink-600 whitespace-nowrap ${i >= 4 && i <= 6 ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {m.instruments.map((r) => (
                <tr key={r.instrumentId + r.testPoint} className="hover:bg-ink-800/40">
                  <td className="py-1.5 px-1.5 border-b border-ink-800/50 text-slate-200 whitespace-nowrap">{r.instrument}</td>
                  <td className="py-1.5 px-1.5 border-b border-ink-800/50 num text-slate-400">{r.instrumentId}</td>
                  <td className="py-1.5 px-1.5 border-b border-ink-800/50 text-slate-400">{r.standard}</td>
                  <td className="py-1.5 px-1.5 border-b border-ink-800/50 text-slate-400">{r.testPoint}</td>
                  <td className="py-1.5 px-1.5 border-b border-ink-800/50 num text-slate-200 text-right">{r.measured}</td>
                  <td className={`py-1.5 px-1.5 border-b border-ink-800/50 num text-right ${Math.abs(r.errorPct) > r.limitPct ? 'text-volt-red' : 'text-slate-200'}`}>{r.errorPct >= 0 ? '+' : ''}{r.errorPct.toFixed(2)}</td>
                  <td className="py-1.5 px-1.5 border-b border-ink-800/50 num text-slate-500 text-right">±{r.limitPct.toFixed(1)}</td>
                  <td className="py-1.5 px-1.5 border-b border-ink-800/50 num text-slate-500 text-right">{r.uncertainty}</td>
                  <td className="py-1.5 px-1.5 border-b border-ink-800/50 text-center">
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${r.result === 'PASS' ? 'text-green-300 border-green-500/40 bg-green-500/10' : 'text-red-300 border-red-500/40 bg-red-500/10'}`}>{r.result}</span>
                  </td>
                  <td className="py-1.5 px-1.5 border-b border-ink-800/50 num text-slate-400">{r.calDate}</td>
                  <td className="py-1.5 px-1.5 border-b border-ink-800/50 num text-slate-400">{r.dueDate}</td>
                  <td className="py-1.5 px-1.5 border-b border-ink-800/50 num text-slate-500">{r.nablCert}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[9.5px] text-slate-600 mt-1.5 leading-relaxed">
          Traceability: NPL India (national metrology institute) → NABL-accredited calibration lab (CMC per certificate) → field instrument.
          Uncertainties stated at k = 2 (≈ 95 % coverage). {m.decisionRule}
        </p>
      </section>

      <section>
        <h3 className="report-sec">C2 · Asset Calibration Status Register</h3>
        <div className="border border-ink-700 rounded overflow-x-auto max-h-56 overflow-y-auto">
          <table className="w-full text-[10px]">
            <thead className="bg-ink-800/70 sticky top-0">
              <tr>
                <th className="py-1 px-2 text-left text-[9px] uppercase tracking-widest text-slate-500 border-b border-ink-600">Asset</th>
                <th className="py-1 px-2 text-left text-[9px] uppercase tracking-widest text-slate-500 border-b border-ink-600">Kind</th>
                <th className="py-1 px-2 text-left text-[9px] uppercase tracking-widest text-slate-500 border-b border-ink-600">Due</th>
                <th className="py-1 px-2 text-left text-[9px] uppercase tracking-widest text-slate-500 border-b border-ink-600">Status</th>
                <th className="py-1 px-2 text-left text-[9px] uppercase tracking-widest text-slate-500 border-b border-ink-600">Certificate</th>
              </tr>
            </thead>
            <tbody>
              {m.assets.map((a) => (
                <tr key={a.assetId + a.kind} className="hover:bg-ink-800/40">
                  <td className="py-1 px-2 border-b border-ink-800/50 num text-slate-300">{a.assetId}</td>
                  <td className="py-1 px-2 border-b border-ink-800/50 text-slate-400">{a.kind}</td>
                  <td className="py-1 px-2 border-b border-ink-800/50 num text-slate-400">{a.due}</td>
                  <td className="py-1 px-2 border-b border-ink-800/50">
                    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border ${a.status === 'valid' ? 'text-green-300 border-green-500/40' : a.status === 'overdue' ? 'text-red-300 border-red-500/40' : 'text-amber-300 border-amber-500/40'}`}>{a.status}</span>
                  </td>
                  <td className="py-1 px-2 border-b border-ink-800/50 num text-slate-500">{a.nablCert}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <section>
          <h3 className="report-sec">C3 · Time-Synchronisation Verification</h3>
          <table className="w-full text-[10.5px]">
            <tbody>
              <tr><td className="py-1.5 px-2 border-b border-ink-800/50 text-slate-400">Source</td><td className="py-1.5 px-2 border-b border-ink-800/50 text-slate-200">{m.clockSync.source}</td></tr>
              <tr><td className="py-1.5 px-2 border-b border-ink-800/50 text-slate-400">Measured drift</td><td className="py-1.5 px-2 border-b border-ink-800/50 num text-slate-100">{m.clockSync.driftMs} ms</td></tr>
              <tr><td className="py-1.5 px-2 border-b border-ink-800/50 text-slate-400">Limit (Annexure SOE spec)</td><td className="py-1.5 px-2 border-b border-ink-800/50 num text-slate-400">≤ {m.clockSync.limitMs} ms</td></tr>
              <tr><td className="py-1.5 px-2 text-slate-400">Result</td><td className="py-1.5 px-2"><span className="text-green-300 font-bold">PASS</span></td></tr>
            </tbody>
          </table>
          <p className="text-[9.5px] text-slate-600 mt-1.5">
            Laboratory conditions at test: {m.env.tempC} °C · {m.env.rhPct} % RH — {m.env.labClause}.
          </p>
        </section>
        <section>
          <h3 className="report-sec">C4 · Compliance Summary</h3>
          <div className="h-44 border border-ink-700 rounded bg-ink-900/40 p-2 mb-3">
            <ResponsiveContainer width="100%" height="100%">
              <DonutChart
                unit="results"
                data={[
                  { name: 'PASS (in class)', value: m.summary.pass, color: '#4ADE80' },
                  ...(m.summary.fail ? [{ name: 'FAIL (out of class)', value: m.summary.fail, color: '#F87171' }] : []),
                ]}
              />
            </ResponsiveContainer>
          </div>
          <div className="border border-ink-700 rounded px-3 py-2 mb-2 bg-ink-800/40">
            <div className="text-[9px] uppercase tracking-widest text-slate-500">Decision rule (ISO/IEC 17025 §7.8.6)</div>
            <div className="text-[10px] text-slate-300 mt-1 leading-relaxed">{m.decisionRule}</div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[
              ['calibration results', `${m.summary.pass}/${m.summary.total}`, m.summary.fail === 0 ? 'PASS — all in class' : `${m.summary.fail} out-of-class`, m.summary.fail === 0],
              ['valid certificates', `${m.summary.validCerts}/${m.assets.length}`, m.summary.overdue ? `${m.summary.overdue} overdue — action required` : 'all within validity', m.summary.overdue === 0],
              ['due within 30 d', String(m.summary.dueSoon), m.summary.dueSoon ? 'schedule calibration' : 'none', true],
              ['time-sync drift', `${m.clockSync.driftMs} ms`, `≤ ${m.clockSync.limitMs} ms spec`, true],
            ].map(([l, v, s, ok]) => (
              <div key={String(l)} className={`panel px-3 py-2 ${ok ? '' : 'border-red-500/40'}`}>
                <div className="num text-sm text-slate-100">{v}</div>
                <div className="text-[9px] uppercase tracking-widest text-slate-500">{l}</div>
                <div className={`text-[9.5px] mt-0.5 ${ok ? 'text-slate-500' : 'text-red-300'}`}>{s}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  )
}
