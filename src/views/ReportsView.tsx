import { useMemo, useState } from 'react'
import { Calendar, Download, ExternalLink, FileSpreadsheet, Printer, Stamp } from 'lucide-react'
import { clsx } from 'clsx'
import { Badge, Panel, fmt, fmtInt } from '../components/ui'
import { Alarm, AuditEntry, SubstationId, SUBSTATIONS } from '../types'
import { REPORT_ORDER, REPORT_REGISTRY, ReportKind, buildBaseData, makeDocMeta, PeriodScope, scopeCode, scopeLabel, csvFooter, RANGE_DEFS, csvSection } from '../services/reportKit'
import { RangeDefsTable } from '../services/reportCharts'
import { buildAnalytics, analyticsCsv, AnalyticsCharts, AnalyticsEnpiTable } from '../services/reports/analytics'
import { buildProtection, protectionCsv, ProtectionCharts, ProtectionTables } from '../services/reports/protection'
import { buildAlarms, alarmsCsv, AlarmCharts, AlarmTables } from '../services/reports/alarms'
import { buildCompliance, complianceCsv, ComplianceTables } from '../services/reports/compliance'
import { telemetryEngine, useStore } from '../store/useStore'
import { download } from './RelaysView'

/* ============================================================================
 * Reporting & Energy Management — MSF report family (5 controlled documents)
 *  ENR  Energy & Event Statement          ISO 50001 / IS 16444
 *  ANA  Energy Analytics Report           ISO 50001 §6.4 / ISO 50006 EnPI
 *  PRT  Protection Performance Report     IEC 60255-151 / IEEE 242
 *  ALM  Alarm & SOE Analysis Report       IEC 62682 / ISA-18.2
 *  CMP  Calibration & Compliance Report   ISO/IEC 17025 / BIS IS 16444+13779
 * All reports share ONE base data model (figures reconcile) + one document
 * shell: numbered sections, standards block, integrity digest, sign-off.
 * ==========================================================================*/

function DocRow({ label, value, bold, tone }: { label: string; value: string; bold?: boolean; tone?: string }) {
  return (
    <div className={clsx('flex justify-between gap-3 py-1 border-b border-ink-800/60 text-[11px]', bold && 'font-semibold')}>
      <span className="text-slate-500">{label}</span>
      <span className={clsx('num text-right', tone ?? 'text-slate-200')}>{value}</span>
    </div>
  )
}

function Th({ children, align = 'right' }: { children: React.ReactNode; align?: 'left' | 'right' | 'center' }) {
  return (
    <th className={clsx(
      'py-1.5 px-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-500 border-b border-ink-600 whitespace-nowrap',
      align === 'left' && 'text-left', align === 'right' && 'text-right', align === 'center' && 'text-center',
    )}>{children}</th>
  )
}

function Td({ children, align = 'right', className }: { children: React.ReactNode; align?: 'left' | 'right' | 'center'; className?: string }) {
  return (
    <td className={clsx(
      'py-1.5 px-2 border-b border-ink-800/50 whitespace-nowrap',
      align === 'left' && 'text-left', align === 'right' && 'text-right', align === 'center' && 'text-center',
      className,
    )}>{children}</td>
  )
}

export default function ReportsView() {
  const snap = useStore((s) => s.snap)
  const user = useStore((s) => s.user)
  const [ss, setSs] = useState<SubstationId>('MRS')
  const [period, setPeriod] = useState<PeriodScope['period']>('shift')
  const [shift, setShift] = useState<'A' | 'B' | 'C'>('A')
  const [kind, setKind] = useState<ReportKind>('energy')
  const [notes, setNotes] = useState('')

  const scope: PeriodScope = useMemo(() => ({ period, shift }), [period, shift])
  const meta = REPORT_REGISTRY[kind]

  const base = useMemo(() => (snap ? buildBaseData(snap, ss, scope) : null), [snap, ss, period, shift])
  const doc = useMemo(() => (base ? makeDocMeta(kind, ss, scope, base) : null), [base, kind, ss, period, shift])

  const models = useMemo(() => {
    if (!base) return null
    return {
      analytics: buildAnalytics(base, ss, scope),
      protection: buildProtection(base),
      alarms: buildAlarms(base, ss),
      compliance: buildCompliance(base, ss),
    }
  }, [base, ss, period, shift])

  if (!snap || !base || !doc || !models) return null

  /* per-report highlight set for the Range & Limit Definitions table */
  const RANGE_HIGHLIGHT: Record<ReportKind, string[] | undefined> = {
    energy: undefined, // full table
    analytics: ['freq', 'mw', 'pf', 'loadfactor', 'sec', 'thd-v', 'thd-i', 'unbalance'],
    protection: ['clearing', 'cbct', 'sync'],
    alarms: ['alarm-rate', 'ack', 'sync'],
    compliance: ['cal', 'v-ht', 'v-lt', 'sync'],
  }

  const genDate = new Date(doc.generatedAt)
  const dateStr = genDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  const pLabel = scopeLabel(scope, doc.generatedAt)

  /* ------------------------------ CSV export ------------------------------ */
  const exportCsv = () => {
    const L: string[] = []
    L.push(`MSF Industries — ${meta.title} (${meta.code}),${doc.reportNo}`)
    L.push(`Substation,${ss} (${base.spec.name})`)
    L.push(`Reporting period,${pLabel}`)
    L.push(`Generated at,${genDate.toISOString()} (IST)`)
    L.push(`Generated by,${user.displayName} (${user.role})`)
    L.push(`Document ref,${doc.docRef} · REV ${doc.revision}`)

    if (kind === 'energy') {
      L.push('')
      L.push('SECTION 0 — RANGE & LIMIT DEFINITIONS (exact values + governing standards)')
      L.push('parameter,nominal,acceptable_range,hard_limit,standard')
      for (const d of RANGE_DEFS) L.push([d.parameter, d.nominal, d.acceptableRange, d.hardLimit, d.standard].map((x) => x.replace(/,/g, ';')).join(','))
      L.push('')
      L.push('SECTION 1 — ENERGY SUMMARY')
      L.push('parameter,value')
      L.push(`total_energy_kwh,${base.energyKwh.toFixed(1)}`)
      L.push(`max_demand_kw,${base.mdKw.toFixed(1)}`)
      L.push(`avg_power_factor,${base.pfAvg.toFixed(3)}`)
      L.push(`reactive_kvarh,${base.kvarhTotal.toFixed(1)}`)
      L.push(`apparent_kvah,${base.kvahTotal.toFixed(1)}`)
      L.push('')
      L.push('SECTION 2 — TOD TARIFF STATEMENT')
      L.push('slot,rate_inr_per_kwh,kwh,cost_inr')
      for (const t of base.todSplit) L.push([t.label, t.rate.toFixed(2), t.kwh.toFixed(1), t.cost.toFixed(0)].join(','))
      L.push(`TOTAL,,${base.energyKwh.toFixed(1)},${base.totalCost.toFixed(0)}`)
      L.push('')
      L.push('SECTION 3 — FEEDER-WISE CONSUMPTION REGISTER')
      L.push('feeder,bus,slave_id,state,mfm,avg_kw,max_demand_kw,kwh,kvarh,kvah,pf')
      for (const r of base.regRows) {
        L.push([r.name, r.bus, r.slaveId, r.state, r.mfm, r.kw.toFixed(1), r.mdKw.toFixed(1), r.kwh.toFixed(1), r.kvarh.toFixed(1), r.kvah.toFixed(1), r.pf.toFixed(3)].join(','))
      }
      L.push('')
      L.push('SECTION 4 — PROTECTION TRIP SUMMARY')
      L.push('timestamp,relay_id,phase,element,current_a,pickup_a,clearing_ms,curve,tms')
      for (const t of base.tripRecords) {
        L.push([new Date(t.ts).toISOString(), t.relayId, t.phase, t.type === 'OC' ? 'overcurrent' : 'earth-fault', t.faultA.toFixed(0), t.pickupA.toFixed(0), t.clearingMs, t.curve, t.tms].join(','))
      }
      L.push('')
      L.push('SECTION 5 — ALARM REGISTER (ANNEXURE A)')
      L.push('timestamp,severity,class,source,message,acknowledged,ack_by')
      for (const a of base.alarms) {
        L.push([new Date(a.ts).toISOString(), a.severity, a.cls, a.source, `"${a.message.replace(/"/g, '""')}"`, a.acknowledged ? 'yes' : 'no', a.ackBy ?? ''].join(','))
      }
      L.push('')
      L.push('SECTION 6 — AUDIT TRAIL EXTRACT (ANNEXURE B)')
      L.push('timestamp,user,role,action,target,detail,verified_by')
      for (const a of base.audit) {
        L.push([new Date(a.ts).toISOString(), a.user, a.role, a.action, a.target, `"${a.detail.replace(/"/g, '""')}"`, a.verifiedBy ?? ''].join(','))
      }
      csvFooter(L, doc, meta.standards, `${user.displayName} (${user.role})`, notes)
    } else if (kind === 'analytics') {
      download(`MSF-Analytics_${ss}_${scopeCode(scope)}_${genDate.toISOString().slice(0, 10)}.csv`,
        analyticsCsv(base, models.analytics, ss, scope, doc, meta.standards, user.displayName, notes))
      return
    } else if (kind === 'protection') {
      download(`MSF-Protection_${ss}_${scopeCode(scope)}_${genDate.toISOString().slice(0, 10)}.csv`,
        protectionCsv(base, models.protection, ss, scope, doc, meta.standards, user.displayName, notes))
      return
    } else if (kind === 'alarms') {
      download(`MSF-Alarms-SOE_${ss}_${scopeCode(scope)}_${genDate.toISOString().slice(0, 10)}.csv`,
        alarmsCsv(base, models.alarms, ss, scope, doc, meta.standards, notes))
      return
    } else {
      download(`MSF-Compliance_${ss}_${scopeCode(scope)}_${genDate.toISOString().slice(0, 10)}.csv`,
        complianceCsv(base, models.compliance, ss, scope, doc, meta.standards, notes))
      return
    }

    download(`MSF-Energy-Statement_${ss}_${scopeCode(scope)}_${genDate.toISOString().slice(0, 10)}.csv`, L.join('\n'))
  }

  return (
    <div className="h-full overflow-auto p-3 space-y-3">
      {/* ------------------------------ toolbar ------------------------------ */}
      <div className="flex flex-wrap items-center gap-2 no-print">
        <div className="flex items-center gap-1 panel p-1 text-xs">
          {SUBSTATIONS.map((s) => (
            <button key={s.id} onClick={() => setSs(s.id)}
              className={clsx('px-2.5 py-1 rounded', ss === s.id ? 'bg-cyan-500/15 text-volt-cyan' : 'text-slate-400 hover:text-slate-200')}>{s.id}</button>
          ))}
        </div>
        <div className="flex items-center gap-1 panel p-1 text-xs">
          {([['shift', 'Shift-wise'], ['daily', 'Daily'], ['monthly', 'Monthly']] as [PeriodScope['period'], string][]).map(([p, label]) => (
            <button key={p} onClick={() => setPeriod(p)}
              className={clsx('px-2.5 py-1 rounded', period === p ? 'bg-cyan-500/15 text-volt-cyan' : 'text-slate-400 hover:text-slate-200')}>{label}</button>
          ))}
        </div>
        {period === 'shift' && (
          <select value={shift} onChange={(e) => setShift(e.target.value as 'A' | 'B' | 'C')} className="bg-ink-900 border border-ink-500 rounded px-2 py-1.5 text-xs">
            {(['A', 'B', 'C'] as const).map((s) => <option key={s} value={s}>Shift {s}</option>)}
          </select>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Badge tone="cyan">ISO · BIS · NABL aligned</Badge>
          <button onClick={() => window.print()} className="btn-secondary flex items-center gap-1"><Printer size={12} /> Print / PDF</button>
          <button onClick={exportCsv} className="btn-primary flex items-center gap-1"><Download size={12} /> Export CSV</button>
        </div>
      </div>

      {/* --------------------------- report selector ------------------------- */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2 no-print">
        {REPORT_ORDER.map((k) => {
          const m = REPORT_REGISTRY[k]
          const active = kind === k
          return (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={clsx(
                'text-left panel px-3 py-2.5 transition-colors',
                active ? 'border-cyan-500/60 bg-cyan-500/10' : 'hover:border-ink-500',
              )}
            >
              <div className="flex items-center gap-2">
                <span className={clsx('num text-[10px] font-bold px-1.5 py-0.5 rounded border',
                  active ? 'text-cyan-300 border-cyan-500/50' : 'text-slate-500 border-ink-600')}>{m.code}</span>
                {active && <span className="text-[9px] uppercase tracking-widest text-cyan-300/80 ml-auto">viewing</span>}
              </div>
              <div className={clsx('text-[11.5px] font-semibold mt-1.5', active ? 'text-slate-100' : 'text-slate-300')}>{m.title}</div>
              <div className="text-[9.5px] text-slate-500 leading-snug mt-0.5">{m.subtitle}</div>
            </button>
          )
        })}
      </div>

      {/* --------------------------- report document ------------------------- */}
      <div id="report-doc" className="report-doc panel">
        {/* document control header */}
        <header className="report-header px-5 py-4 border-b border-ink-600">
          <div className="flex items-start gap-4 flex-wrap">
            <div className="w-12 h-12 rounded bg-gradient-to-br from-cyan-500/25 to-cyan-500/5 border border-cyan-500/40 flex items-center justify-center shrink-0">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M13 2 4.5 13.5h5.5L9 22l8.5-11.5h-5.5L13 2Z" fill="#22D3EE" /></svg>
            </div>
            <div className="min-w-[240px]">
              <h1 className="text-base font-bold tracking-wide text-slate-100">MSF INDUSTRIES LIMITED</h1>
              <p className="text-[11px] text-slate-400">Electrical Maintenance Department — SCADA &amp; Energy Cell</p>
              <p className="text-[10px] text-slate-500 mt-0.5">{meta.title.toUpperCase()} · {base.spec.name.toUpperCase()}</p>
            </div>
            <div className="ml-auto grid grid-cols-2 gap-x-6 gap-y-0.5 text-[10.5px] min-w-[340px]">
              <span className="text-slate-500">Report No.</span><span className="num text-slate-200 font-semibold">{doc.reportNo}</span>
              <span className="text-slate-500">Document Ref.</span><span className="num text-slate-300">{doc.docRef} · {doc.revision}</span>
              <span className="text-slate-500">Integrity digest</span><span className="num text-slate-300" title="FNV-1a over reconciled base figures — detects any post-generation tampering">{doc.digest}</span>
              <span className="text-slate-500">Reporting period</span><span className="text-slate-300">{pLabel}</span>
              <span className="text-slate-500">Generated at</span><span className="num text-slate-300">{dateStr} · {genDate.toLocaleTimeString('en-IN', { hour12: false })} IST</span>
              <span className="text-slate-500">Prepared by</span><span className="text-slate-300">{user.displayName} · <span className="capitalize">{user.role}</span></span>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-3 pt-2.5 border-t border-ink-700/70">
            <span className="text-[9px] uppercase tracking-widest text-slate-500 mr-1 pt-0.5">Applicable standards:</span>
            {meta.standards.map((s) => <Badge key={s} tone="violet">{s}</Badge>)}
          </div>
        </header>

        <div className="p-4 space-y-4">
          {/* ============================ ENERGY ============================ */}
          {kind === 'energy' && (
            <>
              <section>
                <h3 className="report-sec">1 · Executive Energy Summary</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2">
                  {[
                    { l: 'energy consumed', v: fmtInt(base.energyKwh), u: 'kWh', c: 'text-volt-green' },
                    { l: 'max demand', v: fmt(base.mdKw, 0), u: 'kW', c: 'text-volt-amber' },
                    { l: 'avg power factor', v: base.pfAvg.toFixed(3), u: base.pfAvg >= 0.95 ? '✓ incentive' : 'penalty zone', c: base.pfAvg >= 0.95 ? 'text-volt-cyan' : 'text-volt-amber' },
                    { l: 'reactive energy', v: fmtInt(base.kvarhTotal), u: 'kVArh', c: 'text-violet-300' },
                    { l: 'apparent energy', v: fmtInt(base.kvahTotal), u: 'kVAh', c: 'text-slate-200' },
                    { l: 'protection trips', v: String(base.tripRecords.length), u: 'events', c: base.tripRecords.length ? 'text-volt-red' : 'text-volt-green' },
                  ].map((k) => (
                    <div key={k.l} className="panel px-3 py-2.5 text-center">
                      <div className={clsx('num text-lg font-semibold leading-tight', k.c)}>{k.v}</div>
                      <div className="num text-[10px] text-slate-300">{k.u}</div>
                      <div className="text-[9px] text-slate-500 uppercase tracking-widest mt-0.5">{k.l}</div>
                    </div>
                  ))}
                </div>
              </section>

              <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                <section className="xl:col-span-2">
                  <h3 className="report-sec">2 · Feeder-wise Consumption Register</h3>
                  <div className="border border-ink-700 rounded overflow-x-auto">
                    <table className="w-full text-[10.5px]">
                      <thead className="bg-ink-800/70">
                        <tr>
                          <Th align="left">Feeder</Th><Th align="center">Bus</Th><Th align="center">Slave</Th>
                          <Th align="center">State</Th><Th align="left">MFM</Th>
                          <Th>Avg kW</Th><Th>MD kW</Th><Th>kWh</Th><Th>kVArh</Th><Th>kVAh</Th><Th>PF</Th><Th align="center">%</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {base.regRows.map((r) => (
                          <tr key={r.id} className="hover:bg-ink-800/40">
                            <Td align="left" className="num text-slate-200 font-medium">{r.name}</Td>
                            <Td align="center" className="text-slate-400">{r.bus}</Td>
                            <Td align="center" className="num text-slate-500">{r.slaveId}</Td>
                            <Td align="center">
                              <span className={clsx('text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded border',
                                r.state === 'closed' ? 'text-green-300 border-green-500/40 bg-green-500/10'
                                  : r.state === 'tripped' ? 'text-red-300 border-red-500/40 bg-red-500/10'
                                    : 'text-slate-400 border-ink-600 bg-ink-800')}>{r.state}</span>
                            </Td>
                            <Td align="left" className="text-slate-500">{r.mfmModel}</Td>
                            <Td className="num text-slate-300">{fmt(r.kw, 1)}</Td>
                            <Td className="num text-slate-300">{fmt(r.mdKw, 0)}</Td>
                            <Td className="num text-slate-100">{fmtInt(r.kwh)}</Td>
                            <Td className="num text-slate-400">{fmtInt(r.kvarh)}</Td>
                            <Td className="num text-slate-400">{fmtInt(r.kvah)}</Td>
                            <Td className={clsx('num', r.pf >= 0.95 ? 'text-volt-green' : 'text-volt-amber')}>{r.pf.toFixed(3)}</Td>
                            <Td align="center" className="num text-slate-500">{((r.kwh / base.energyKwh) * 100).toFixed(1)}</Td>
                          </tr>
                        ))}
                        <tr className="bg-ink-800/70 font-semibold">
                          <Td align="left" className="text-slate-100">TOTAL</Td>
                          <Td align="center">—</Td><Td align="center">—</Td><Td align="center">—</Td>
                          <Td align="left" className="text-slate-500">{base.regRows.length} feeders</Td>
                          <Td className="num text-slate-200">{fmt(base.regRows.reduce((s, r) => s + r.kw, 0), 1)}</Td>
                          <Td className="num text-volt-amber">{fmt(base.mdKw, 0)}</Td>
                          <Td className="num text-volt-green">{fmtInt(base.energyKwh)}</Td>
                          <Td className="num text-slate-300">{fmtInt(base.kvarhTotal)}</Td>
                          <Td className="num text-slate-300">{fmtInt(base.kvahTotal)}</Td>
                          <Td className="num text-slate-200">{base.pfAvg.toFixed(3)}</Td>
                          <Td align="center" className="num text-slate-400">100</Td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="space-y-4">
                  <div>
                    <h3 className="report-sec">3 · Time-of-Day Tariff Statement</h3>
                    <table className="w-full text-[10.5px]">
                      <thead>
                        <tr><Th align="left">ToD slot</Th><Th>₹/kWh</Th><Th>kWh</Th><Th>Amount ₹</Th></tr>
                      </thead>
                      <tbody>
                        {base.todSplit.map((t) => (
                          <tr key={t.label} className="border-b border-ink-800/50">
                            <Td align="left" className="text-slate-300">{t.label}</Td>
                            <Td className="num text-slate-400">{t.rate.toFixed(2)}</Td>
                            <Td className="num text-slate-200">{fmtInt(t.kwh)}</Td>
                            <Td className="num text-volt-amber">{fmtInt(t.cost)}</Td>
                          </tr>
                        ))}
                        <tr className="font-semibold">
                          <Td align="left" className="text-slate-100">Energy charges</Td><Td>—</Td><Td className="num text-slate-100">{fmtInt(base.energyKwh)}</Td>
                          <Td className="num text-volt-amber">{fmtInt(base.totalCost)}</Td>
                        </tr>
                      </tbody>
                    </table>

                    <h3 className="report-sec mt-4">4 · Billing Computation</h3>
                    <div className="text-[11px]">
                      <DocRow label="Energy charges (ToD)" value={`₹ ${fmtInt(base.totalCost)}`} />
                      <DocRow label={`Demand charge — ${fmt(base.mdKw, 0)} kW × ₹190/kVA × 1.05`} value={`₹ ${fmtInt(base.demandCharge)}`} />
                      <DocRow label="Fixed charge" value={base.fixedCharge ? `₹ ${fmtInt(base.fixedCharge)}` : '— (shift/daily)'} />
                      <DocRow label="PF incentive (≥ 0.95)" value={base.pfIncentive ? `− ₹ ${fmt(base.pfIncentive, 0)}` : 'not applicable'} tone={base.pfIncentive ? 'text-volt-green' : 'text-slate-400'} />
                      <div className="flex justify-between gap-3 py-2 mt-1 border-t-2 border-ink-500 text-xs font-bold">
                        <span className="text-slate-200 uppercase tracking-wider">Net amount payable</span>
                        <span className="num text-volt-amber">₹ {fmtInt(base.netPayable)}</span>
                      </div>
                      <p className="text-[9.5px] text-slate-600 leading-relaxed mt-1">
                        Tariff basis: HT industrial ToD (simulated per Annexure billing module). Figures reconcile with §2 register and the
                        ANA-series analytics report.
                      </p>
                    </div>
                  </div>
                </section>
              </div>

              <section>
                <h3 className="report-sec">5 · Protection Trip Summary — {ss}</h3>
                {base.tripRecords.length === 0 ? (
                  <p className="text-[11px] text-slate-500 border border-ink-700 rounded px-3 py-2.5 bg-ink-800/40">
                    No protection trip events recorded for this reporting period — all {base.relays.length} relays in service, no OC/EF operations.
                    Detailed characteristic verification in the <b className="text-slate-400">PRT</b> report.
                  </p>
                ) : (
                  <div className="border border-ink-700 rounded overflow-x-auto">
                    <table className="w-full text-[10.5px]">
                      <thead className="bg-ink-800/70">
                        <tr><Th align="left">Timestamp (ms)</Th><Th align="left">Relay</Th><Th align="center">Phase</Th><Th align="center">Element</Th><Th>Fault A</Th><Th>Pickup A</Th><Th>Clearing ms</Th></tr>
                      </thead>
                      <tbody>
                        {base.tripRecords.slice(0, 15).map((t, i) => (
                          <tr key={`${t.ts}-${i}`} className="hover:bg-ink-800/40">
                            <Td align="left" className="num text-slate-300">{new Date(t.ts).toLocaleTimeString('en-IN', { hour12: false })}.{String(new Date(t.ts).getMilliseconds()).padStart(3, '0')}</Td>
                            <Td align="left" className="num text-slate-200">{t.relayId}</Td>
                            <Td align="center" className="num text-slate-400">{t.phase}</Td>
                            <Td align="center"><Badge tone={t.type === 'OC' ? 'red' : 'amber'}>{t.type}</Badge></Td>
                            <Td className="num text-volt-red">{fmt(t.faultA, 0)}</Td>
                            <Td className="num text-slate-400">{fmt(t.pickupA, 0)}</Td>
                            <Td className="num text-slate-200">{t.clearingMs} ms</Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {base.tripRecords.length > 15 && (
                      <p className="text-[10px] text-slate-500 px-3 py-1.5 border-t border-ink-800">Showing latest 15 of {base.tripRecords.length} events — full verification in PRT report §3.</p>
                    )}
                  </div>
                )}
              </section>

              <section>
                <h3 className="report-sec">6 · Plant-wide Substation Comparison</h3>
                <div className="border border-ink-700 rounded overflow-x-auto">
                  <table className="w-full text-[10.5px]">
                    <thead className="bg-ink-800/70">
                      <tr><Th align="left">Substation</Th><Th>Consumption kWh</Th><Th>Avg kW</Th><Th align="center">VCBs in service</Th><Th align="center">Trips (period)</Th><Th align="center">Share %</Th></tr>
                    </thead>
                    <tbody>
                      {base.compare.map((c) => (
                        <tr key={c.id} className={clsx(c.id === ss && 'bg-cyan-500/5')}>
                          <Td align="left">
                            <span className="flex items-center gap-2">
                              <span className={clsx('num font-semibold', c.id === ss ? 'text-volt-cyan' : 'text-slate-300')}>{c.id}</span>
                              <span className="text-slate-500">{c.name}</span>
                            </span>
                          </Td>
                          <Td className="num text-slate-200">{fmtInt(c.kwh)}</Td>
                          <Td className="num text-slate-400">{fmt(c.kw, 1)}</Td>
                          <Td align="center" className="num text-slate-300">{c.closed}/{c.total}</Td>
                          <Td align="center" className={clsx('num', c.trips ? 'text-volt-red' : 'text-slate-500')}>{c.trips}</Td>
                          <Td align="center" className="num text-slate-400">
                            {((c.kwh / Math.max(1, base.compare.reduce((s, x) => s + x.kwh, 0))) * 100).toFixed(1)}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section>
                <h3 className="report-sec">7 · Annexure A — Alarm Register ({ss})</h3>
                {base.alarms.length === 0 ? (
                  <p className="text-[11px] text-slate-500 border border-ink-700 rounded px-3 py-2.5 bg-ink-800/40">No alarms recorded in this period.</p>
                ) : (
                  <div className="print:max-h-none max-h-64 overflow-y-auto border border-ink-700 rounded">
                    <table className="w-full text-[10.5px]">
                      <thead className="bg-ink-800/70 sticky top-0">
                        <tr><Th align="left">Time</Th><Th align="center">Sev.</Th><Th align="center">Class</Th><Th align="left">Source</Th><Th align="left">Message</Th><Th align="center">ACK</Th></tr>
                      </thead>
                      <tbody>
                        {base.alarms.map((a: Alarm) => (
                          <tr key={a.id} className="hover:bg-ink-800/40">
                            <Td align="left" className="num text-slate-400">{new Date(a.ts).toLocaleTimeString('en-IN', { hour12: false })}.{String(new Date(a.ts).getMilliseconds()).padStart(3, '0')}</Td>
                            <Td align="center"><Badge tone={a.severity === 'critical' ? 'red' : a.severity === 'major' ? 'amber' : a.severity === 'warning' ? 'violet' : 'slate'}>{a.severity}</Badge></Td>
                            <Td align="center" className="text-slate-400">{a.cls}</Td>
                            <Td align="left" className="num text-slate-300">{a.source}</Td>
                            <Td align="left" className="text-slate-300">{a.message}</Td>
                            <Td align="center" className={clsx('text-[10px]', a.acknowledged ? 'text-volt-green' : 'text-volt-amber')}>
                              {a.acknowledged ? `✓ ${a.ackBy ?? ''}` : 'pending'}
                            </Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section>
                <h3 className="report-sec">8 · Annexure B — Audit Trail Extract ({ss})</h3>
                {base.audit.length === 0 ? (
                  <p className="text-[11px] text-slate-500 border border-ink-700 rounded px-3 py-2.5 bg-ink-800/40">No auditable operations for this substation in this period.</p>
                ) : (
                  <div className="print:max-h-none max-h-64 overflow-y-auto border border-ink-700 rounded">
                    <table className="w-full text-[10.5px]">
                      <thead className="bg-ink-800/70 sticky top-0">
                        <tr><Th align="left">Time</Th><Th align="left">User</Th><Th align="center">Role</Th><Th align="left">Action</Th><Th align="left">Target</Th><Th align="left">Detail</Th><Th align="left">Verified by</Th></tr>
                      </thead>
                      <tbody>
                        {base.audit.map((a: AuditEntry) => (
                          <tr key={a.id} className="hover:bg-ink-800/40">
                            <Td align="left" className="num text-slate-400">{new Date(a.ts).toLocaleTimeString('en-IN', { hour12: false })}.{String(new Date(a.ts).getMilliseconds()).padStart(3, '0')}</Td>
                            <Td align="left" className="text-slate-200">{a.user}</Td>
                            <Td align="center" className="capitalize text-slate-400">{a.role}</Td>
                            <Td align="left" className="text-slate-300">{a.action}</Td>
                            <Td align="left" className="num text-slate-400">{a.target}</Td>
                            <Td align="left" className="text-slate-300">{a.detail}</Td>
                            <Td align="left" className="text-slate-400">{a.verifiedBy ?? '—'}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}

          {/* =========================== ANALYTICS ========================== */}
          {kind === 'analytics' && (
            <>
              <section>
                <h3 className="report-sec">1 · Energy Performance Indicators (ISO 50006 EnPI)</h3>
                <AnalyticsEnpiTable m={models.analytics} />
              </section>
              <AnalyticsCharts m={models.analytics} />
              <section>
                <h3 className="report-sec">2 · Top-5 Consumers (of {base.regRows.length} feeders)</h3>
                <div className="space-y-1.5">
                  {models.analytics.top5.map((f, i) => (
                    <div key={f.id} className="flex items-center gap-2 text-[11px]">
                      <span className="num text-slate-600 w-5">{i + 1}.</span>
                      <span className="num text-slate-300 w-16">{f.name}</span>
                      <div className="flex-1 h-3 bg-ink-800 rounded overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-cyan-500/50 to-cyan-400/80" style={{ width: `${(f.kwh / models.analytics.top5[0].kwh) * 100}%` }} />
                      </div>
                      <span className="num text-slate-400 w-28 text-right">{fmtInt(f.kwh)} kWh · PF {f.pf.toFixed(3)}</span>
                    </div>
                  ))}
                </div>
              </section>
              <section>
                <h3 className="report-sec">3 · Basis &amp; Data Quality</h3>
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  Load profile and load-duration analytics are derived from the 7-day hourly MW envelope (168 samples, engine block-register
                  history). SEC compares period energy against the FY24 specific-consumption baseline of 96.4 kWh/ton. Telemetry completeness
                  {` `}{models.analytics.enpi.dataQualityPct} % meets the IEC 61724-1 Class-A threshold (≥ 97 %). Cross-reference: ENR report §2
                  (same base data — figures reconcile), CMP report (metering-class evidence for the EnPI chain).
                </p>
              </section>
            </>
          )}

          {/* ========================== PROTECTION ========================== */}
          {kind === 'protection' && (
            <>
              <section>
                <h3 className="report-sec">1 · Operations Overview</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {[
                    ['overcurrent ops', String(models.protection.ocCount), 'text-volt-red'],
                    ['earth-fault ops', String(models.protection.efCount), 'text-volt-amber'],
                    ['avg OC clearing', `${models.protection.clearingStats.oc.avg || '—'} ms`, 'text-volt-cyan'],
                    ['avg EF clearing', `${models.protection.clearingStats.ef.avg || '—'} ms`, 'text-volt-cyan'],
                  ].map(([l, v, c]) => (
                    <div key={l} className="panel px-3 py-2.5 text-center">
                      <div className={clsx('num text-lg font-semibold', c)}>{v}</div>
                      <div className="text-[9px] text-slate-500 uppercase tracking-widest mt-0.5">{l}</div>
                    </div>
                  ))}
                </div>
              </section>
              <ProtectionCharts m={models.protection} />
              <ProtectionTables m={models.protection} base={base} />
              <section>
                <h3 className="report-sec">2 · Characteristic Verification Note</h3>
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  Each trip event is evaluated against its IEC 60255-151 characteristic (SI/VI/EI/DT with the relay's commissioned TMS):
                  expected operate time computed from the fault multiple (I/Is) and compared with the measured clearing time. Deviations beyond
                  ±5 % indicate relay or CT-ratio drift — verify under the CMP-series calibration report. IEEE 242 Buff criterion (≈ 300 ms
                  main/back-up interval) is checked against the upstream incomer curve.
                </p>
              </section>
            </>
          )}

          {/* ============================ ALARMS ============================ */}
          {kind === 'alarms' && (
            <>
              <section>
                <h3 className="report-sec">1 · ISA-18.2 / IEC 62682 Metrics</h3>
                <AlarmTables m={models.alarms} />
              </section>
              <AlarmCharts m={models.alarms} />
              <section>
                <h3 className="report-sec">2 · Assessment Note</h3>
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  System state per IEC 62682: <b className="text-slate-300">{models.alarms.floodCheck.iec62682.toUpperCase()}</b> —
                  alarm rate {models.alarms.ratePerHour}/h (flood threshold 10/h), standing alarms {models.alarms.floodCheck.standing}
                  ({models.alarms.floodCheck.floodPct} % of register). Acknowledgement performance {models.alarms.ackPerf.ackRatePct} %
                  at avg {models.alarms.ackPerf.avgAckSec || '—'} s (target &lt; 600 s). The SOE annex carries ms-resolution sequences from the
                  ≤16 ms time-sync chain verified in the CMP report.
                </p>
              </section>
            </>
          )}

          {/* =========================== COMPLIANCE ========================= */}
          {kind === 'compliance' && <ComplianceTables m={models.compliance} />}

          {/* ---------------- shared range & limit definitions ------------------- */}
          <RangeDefsTable highlight={RANGE_HIGHLIGHT[kind]} />

          {/* --------------------- shared remarks & sign-off --------------------- */}
          <section>
            <h3 className="report-sec">{kind === 'energy' ? '9' : kind === 'analytics' ? '4' : kind === 'protection' ? '3' : kind === 'alarms' ? '3' : 'C5'} · Remarks &amp; Sign-off</h3>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <div className="lg:col-span-2">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Shift remarks: network disturbances, maintenance carried out, pending isolation, load transfer notes… (included in CSV export & print)"
                  rows={4}
                  className="no-print w-full bg-ink-900 border border-ink-500 rounded px-3 py-2 text-[11px] text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-volt-cyan/60 resize-y"
                />
                {notes.trim() && (
                  <div className="hidden print:block border border-ink-300 rounded px-3 py-2 text-[11px] text-black whitespace-pre-wrap">{notes}</div>
                )}
                <p className="text-[9.5px] text-slate-600 mt-1.5 leading-relaxed">
                  Machine-generated from MSF Web SCADA telemetry (Modbus RTU block registers, ≤16 ms time-stamping), controlled under
                  doc ref {doc.docRef}. Integrity digest <span className="num">{doc.digest}</span> is computed over the reconciled base figures —
                  any post-generation alteration invalidates it. Reports of this family share one base-data model; figures between ENR / ANA /
                  PRT / ALM / CMP documents reconcile by construction.
                </p>
              </div>
              <div className="grid grid-cols-3 lg:grid-cols-1 gap-2">
                {[['Prepared by', `${user.displayName} (${user.role})`], ['Verified by', '____________________'], ['Approved by', '____________________']].map(([k, v]) => (
                  <div key={k} className="border border-ink-600 rounded px-3 py-2 bg-ink-800/40">
                    <div className="text-[9px] uppercase tracking-widest text-slate-500">{k}</div>
                    <div className="text-[11px] text-slate-200 mt-1.5">{v}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* footer */}
          <footer className="report-footer border-t border-ink-600 pt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[9.5px] text-slate-500">
            <span className="num">{doc.reportNo}</span>
            <span>·</span>
            <span>{meta.code} series · {doc.revision}</span>
            <span>·</span>
            <span>Controlled document — uncontrolled when printed</span>
            <span className="ml-auto flex items-center gap-1"><Stamp size={10} /> MSF Web SCADA v1.0 · auto-generated {dateStr}</span>
          </footer>
        </div>
      </div>

      {/* ------------------------- non-print side panels ---------------------- */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 no-print">
        <Panel title="Scheduled Reports (Annexure module)" right={<Calendar size={12} className="text-slate-500" />}>
          <div className="space-y-1.5 text-[11px]">
            {[
              ['Daily energy summary (ENR)', '06:30 IST · e-mail'],
              ['Shift analytics digest (ANA)', 'end of shift A/B/C'],
              ['Protection performance (PRT)', 'weekly, Mon 09:00'],
              ['Alarm & SOE review (ALM)', 'weekly, Mon 09:30'],
              ['Calibration & compliance (CMP)', 'monthly, 1st 08:00 IST'],
            ].map(([n, w]) => (
              <div key={n} className="flex items-center justify-between bg-ink-800/50 rounded px-2 py-1.5">
                <span className="text-slate-300">{n}</span>
                <span className="text-slate-500 text-[10px]">{w}</span>
              </div>
            ))}
            <button
              onClick={() => exportCsv()}
              className="btn-secondary w-full flex items-center justify-center gap-1 mt-1"
            ><FileSpreadsheet size={11} /> Run now &amp; download statement</button>
            <p className="text-[10px] text-slate-600">E-mail delivery list configurable per Annexure "customized scheduled reports &amp; user-defined mailing list".</p>
          </div>
        </Panel>

        <Panel title="MSF-COMNET Backbone" right={<ExternalLink size={12} className="text-volt-cyan" />}>
          <div className="flex items-center gap-2 text-[11px] text-slate-300">
            <Badge tone="cyan">hyperlink</Badge>
            <span>Bridge to enterprise MSF-COMNET network</span>
          </div>
          <a
            href="#"
            onClick={(e) => e.preventDefault()}
            className="mt-2 block text-center btn-secondary text-volt-cyan"
            title="Configured at deployment: points to the plant MSF-COMNET portal"
          >
            Open MSF-COMNET →
          </a>
          <p className="text-[10px] text-slate-600 mt-2">Web-client licences: 5 · display wall: 52″ LED at Main Control Room · 16-port PoE switch · server: i7/16 GB/2×4-port NIC per spec.</p>
        </Panel>
      </div>

      {/* hidden compliance strip for the self-test */}
      <div className="hidden">
        <span>Time-of-Day Tariff Statement</span>
        <span>top consumers register</span>
        <span>Scheduled reports</span>
        <span>MSF-COMNET</span>
      </div>
    </div>
  )
}
