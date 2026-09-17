/* ============================================================================
 * MSF Web SCADA — Report Kit
 * Shared infrastructure for the MSF report family so that every report:
 *   • draws on the SAME base data model  (figures reconcile across reports —
 *     ISO 9001 §8.7 control of documented information, ISO 50001 §4.4 EnPI basis)
 *   • carries document control metadata  (number, rev, issue time, digest)
 *   • declares applicable standards      (ISO / BIS / NABL / IEC)
 *   • exports a sectioned CSV identical in structure to the printed document
 * ==========================================================================*/

import { Alarm, AuditEntry, SubstationId, SUBSTATIONS } from '../types'
import { EngineSnapshot, RelayTripRecord } from './mockTelemetryService'

/* ------------------------------ report family ----------------------------- */

export type ReportKind = 'energy' | 'analytics' | 'protection' | 'alarms' | 'compliance'

export interface ReportMeta {
  kind: ReportKind
  code: string        // document-series code, used in report numbers
  title: string
  subtitle: string
  standards: string[] // applicable standards declared on the document header
}

export const REPORT_REGISTRY: Record<ReportKind, ReportMeta> = {
  energy: {
    kind: 'energy', code: 'ENR',
    title: 'Energy & Event Statement',
    subtitle: 'Consumption register, ToD billing and event annexes',
    standards: ['ISO 50001:2018 §4.4', 'IS 16444 (metering)', 'IEC 62053-22 Cl. 0.5S'],
  },
  analytics: {
    kind: 'analytics', code: 'ANA',
    title: 'Energy Analytics Report',
    subtitle: 'Load profile, load-duration, PF & ToD analytics with EnPI',
    standards: ['ISO 50001:2018 §6.4', 'ISO 50006 (EnPI)', 'IEC 61724-1 (data quality)'],
  },
  protection: {
    kind: 'protection', code: 'PRT',
    title: 'Protection Performance Report',
    subtitle: 'IDMT relay operations, clearing-time statistics and settings register',
    standards: ['IEC 60255-151 (IDMT)', 'IEEE 242 (Buff)', 'IS 3231 (relays)'],
  },
  alarms: {
    kind: 'alarms', code: 'ALM',
    title: 'Alarm & SOE Analysis Report',
    subtitle: 'Annunciator distribution, acknowledgement performance and SOE annex',
    standards: ['IEC 62682 (alarm mgmt)', 'ISA 18.2 (rationalisation)', 'IEC 61850-5 SOE'],
  },
  compliance: {
    kind: 'compliance', code: 'CMP',
    title: 'Calibration & Compliance Report',
    subtitle: 'NABL calibration register, BIS standards conformity and ISO system audit',
    standards: ['ISO/IEC 17025:2017', 'IS 16444 / IS 13779', 'ISO 9001:2015 §7.1.5'],
  },
}

export const REPORT_ORDER: ReportKind[] = ['energy', 'analytics', 'protection', 'alarms', 'compliance']

/* --------------------------------- scope ---------------------------------- */

export type Period = 'shift' | 'daily' | 'monthly'
export interface PeriodScope { period: Period; shift: 'A' | 'B' | 'C' }

export const SHIFTS = [
  { id: 'A', label: 'Shift A · 06:00–14:00', from: 6, to: 14 },
  { id: 'B', label: 'Shift B · 14:00–22:00', from: 14, to: 22 },
  { id: 'C', label: 'Shift C · 22:00–06:00', from: 22, to: 30 },
] as const

export const TOD_SLOTS = [
  { label: 'Normal (06:00–18:00)', rate: 7.85, from: 6, to: 18 },
  { label: 'Peak (18:00–22:00)', rate: 9.40, from: 18, to: 22 },
  { label: 'Off-peak (22:00–06:00)', rate: 5.90, from: 22, to: 30 },
]

export function scopeHours(s: PeriodScope): number {
  return s.period === 'shift' ? 8 : s.period === 'daily' ? 24 : 24 * 30
}

export function scopeCode(s: PeriodScope): string {
  return s.period === 'shift' ? `SH-${s.shift}` : s.period === 'daily' ? 'DLY' : 'MON'
}

export function scopeLabel(s: PeriodScope, now = Date.now()): string {
  const d = new Date(now)
  if (s.period === 'shift') return SHIFTS.find((x) => x.id === s.shift)!.label
  if (s.period === 'daily') return `Daily — ${d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`
  return `Monthly — ${d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}`
}

/* ------------------------------- base model ------------------------------- */

/** Deterministic pseudo-random from a string seed — stable between renders/prints */
export function seeded(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 10000) / 10000
}

export interface FeederRegRow {
  id: string; name: string; bus: 'A' | 'B'; voltage: string; slaveId: number
  state: 'closed' | 'open' | 'tripped'; online: boolean
  kw: number; mdKw: number; kwh: number; kvarh: number; kvah: number; pf: number
  mfm: string; mfmModel: string
}

export interface SsCompareRow {
  id: SubstationId; name: string; kwh: number; kw: number
  closed: number; total: number; trips: number
}

/**
 * Single source of truth for ALL reports. Built once per (substation, scope);
 * every report module consumes this so numbers never disagree between documents.
 */
export function buildBaseData(snap: EngineSnapshot, ss: SubstationId, scope: PeriodScope) {
  const now = Date.now()
  const hours = scopeHours(scope)
  const windowMs = hours * 3600000

  const spec = SUBSTATIONS.find((s) => s.id === ss)!
  const mfms = snap.mfms.filter((m) => m.substation === ss)
  const feeders = mfms
    .map((m) => ({ m, b: snap.breakers.find((x) => x.id === m.breakerId)! }))
    .filter(({ b }) => b.kind === 'feeder')

  /* live-window integration over the 60 s trend ring (0.25 s sampling) */
  const ring = feeders.map(({ m }) => snap.engine.getTrendBuffer(m.breakerId))
  const liveKwh = ring.reduce((sum, buf) => {
    if (buf.length < 2) return sum
    let e = 0
    for (let i = 1; i < buf.length; i++) {
      const dt = (buf[i].t - buf[i - 1].t) / 3600000
      e += ((buf[i - 1].kw + buf[i].kw) / 2) * dt
    }
    return sum + e
  }, 0)

  const energyKwh = Math.max(1, liveKwh * (hours / 0.25))

  const todSplit = TOD_SLOTS.map((slot) => {
    const share = slot.label.startsWith('Peak') ? 0.31 : slot.label.startsWith('Off') ? 0.27 : 0.42
    return { ...slot, kwh: energyKwh * share, cost: energyKwh * share * slot.rate }
  })
  const totalCost = todSplit.reduce((s, t) => s + t.cost, 0)

  /* per-feeder register with deterministic per-feeder jitter */
  const regRows: FeederRegRow[] = feeders.map(({ m, b }) => {
    const on = b.state === 'closed' ? 1 : b.state === 'tripped' ? 0.12 : 0
    const jitter = 0.94 + seeded(b.id) * 0.12
    const kwh0 = energyKwh * on * jitter * (m.kW > 0 ? 1 : 0.05)
    return {
      id: b.id, name: b.name, bus: b.bus, voltage: b.voltage, slaveId: b.slaveId,
      state: b.state, online: m.online,
      kw: m.kW * on, mdKw: m.kW * on * jitter * 1.18,
      kwh: kwh0, kvarh: kwh0 * Math.tan(Math.acos(Math.min(0.99, Math.max(0.75, m.pf)))),
      kvah: 0, pf: m.pf, mfm: m.name, mfmModel: m.model,
    }
  }).sort((a, b) => b.kwh - a.kwh)

  /* normalise feeder kWh to the summary energy — keeps §1 ≡ §2 reconciliation */
  const regTotalKwh = regRows.reduce((s, r) => s + r.kwh, 0) || 1
  for (const r of regRows) r.kwh *= energyKwh / regTotalKwh
  for (const r of regRows) {
    r.kvarh = r.kwh * Math.tan(Math.acos(Math.min(0.99, Math.max(0.75, r.pf))))
    r.kvah = Math.hypot(r.kwh, r.kvarh)
  }

  const mdKw = Math.max(...regRows.map((r) => r.mdKw), 0)
  const pfAvg = mfms.reduce((s, m) => s + m.pf, 0) / Math.max(1, mfms.length)
  const kvarhTotal = regRows.reduce((s, r) => s + r.kvarh, 0)
  const kvahTotal = regRows.reduce((s, r) => s + r.kvah, 0)

  /* protection trips in window, mapped via relays for substation attribution */
  const relaySs = new Map(snap.relays.map((r) => [r.id, r.substation] as const))
  const tripRecords: RelayTripRecord[] = snap.trips.filter((t) => relaySs.get(t.relayId) === ss && t.ts >= now - windowMs)
  const relays = snap.relays.filter((r) => r.substation === ss)

  /* alarms + audit scoped to the substation */
  const alarms: Alarm[] = snap.alarms.filter((a) => a.substation === ss).slice(0, 40)
  const audit: AuditEntry[] = snap.audit.filter((a) => a.target.includes(`:${ss}`) || a.target.includes(ss)).slice(0, 30)

  /* plant-wide comparison */
  const compare: SsCompareRow[] = SUBSTATIONS.map((s) => {
    const sm = snap.mfms.filter((m) => m.substation === s.id)
    const sf = snap.breakers.filter((b) => b.substation === s.id && b.kind === 'feeder')
    const closed = sf.filter((b) => b.state === 'closed').length
    const kw = sm.reduce((acc, m) => {
      const b = snap.breakers.find((x) => x.id === m.breakerId)
      return acc + (b && b.kind === 'feeder' ? m.kW : 0)
    }, 0)
    const sRelayIds = new Set(snap.relays.filter((r) => r.substation === s.id).map((r) => r.id))
    return {
      id: s.id, name: s.name, kwh: kw * hours * 0.97, kw, closed, total: sf.length,
      trips: snap.trips.filter((t) => sRelayIds.has(t.relayId) && t.ts >= now - windowMs).length,
    }
  })

  /* billing */
  const demandCharge = mdKw * 1.05 * 190
  const pfIncentive = pfAvg >= 0.95 ? totalCost * 0.0025 : 0
  const fixedCharge = scope.period === 'monthly' ? 190 * (kvahTotal / Math.max(1, hours)) / 1000 : 0
  const netPayable = totalCost + demandCharge + fixedCharge - pfIncentive

  /* hourly plant load envelope (7 days) for analytics load-duration */
  const hourlyMw = snap.engine.historicalSeries(ss, now - 7 * 86400000, 168, 3600000, 'mw')

  return {
    now, spec, mfms, feeders, hours, windowMs, energyKwh, todSplit, totalCost,
    regRows, mdKw, pfAvg, kvarhTotal, kvahTotal,
    tripRecords, relays, alarms, audit, compare,
    demandCharge, pfIncentive, fixedCharge, netPayable, hourlyMw,
  }
}

export type ReportBase = ReturnType<typeof buildBaseData>

/* ---------------------------- document control ---------------------------- */

/** 32-bit FNV-1a → 8-hex record digest (integrity reference on every document) */
export function digestOf(input: string): string {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16).toUpperCase().padStart(8, '0')
}

export interface DocMeta {
  reportNo: string
  docRef: string
  digest: string
  revision: string
  generatedAt: number
}

export function makeDocMeta(kind: ReportKind, ss: SubstationId, scope: PeriodScope, base: ReportBase): DocMeta {
  const meta = REPORT_REGISTRY[kind]
  const seq = String(1 + Math.floor(seeded(`${kind}-${ss}-${scope.period}-${scope.shift}`) * 899))
  const reportNo = `MSF/${meta.code}/${ss}/${scope.period === 'shift' ? `SH${scope.shift}` : scope.period === 'daily' ? 'DY' : 'MO'}/${seq}`
  const docRef = `MSF-SCADA-DOC-${base.spec.id}-${base.spec.activeTags}T`
  const digest = digestOf(
    [reportNo, ss, scopeCode(scope), base.energyKwh.toFixed(3), base.mdKw.toFixed(3),
      base.pfAvg.toFixed(4), base.tripRecords.length, base.alarms.length].join('|'),
  )
  const revision = `R${1 + Math.floor(seeded(`${reportNo}-rev`) * 2)}.0`
  return { reportNo, docRef, digest, revision, generatedAt: base.now }
}

/* ------------------------------ CSV helpers ------------------------------- */

export function csvEsc(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function csvSection(lines: string[], title: string, header?: string[], rows?: (string | number)[][]) {
  lines.push('')
  lines.push(`${title}`)
  if (header && rows) {
    lines.push(header.join(','))
    for (const r of rows) lines.push(r.map(csvEsc).join(','))
  }
}

export function csvFooter(lines: string[], meta: DocMeta, standards: string[], preparedBy: string, notes?: string) {
  if (notes && notes.trim()) csvSection(lines, 'OPERATOR NOTES', undefined, [[notes.trim()]])
  lines.push('')
  lines.push(`APPLICABLE STANDARDS,${standards.join('; ')}`)
  lines.push(`RECORD DIGEST (FNV-1a),${meta.digest}`)
  lines.push(`DOCUMENT REF,${meta.docRef} · REV ${meta.revision}`)
  lines.push(`PREPARED BY,${preparedBy}`)
  lines.push(`END OF REPORT — ${meta.reportNo} — machine-generated by MSF Web SCADA v1.0`)
}

export const iso = (ts: number) => new Date(ts).toISOString()
export const fmtMs = (ts: number) => {
  const d = new Date(ts)
  return `${d.toLocaleTimeString('en-IN', { hour12: false })}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

/* ===========================================================================
 * RANGE & LIMIT DEFINITIONS — exact nominal values, acceptable bands and the
 * standard/clause behind each figure. Declared once here and printed inside
 * every report (§ Range & Limit Definitions) so measured values always carry
 * their acceptance criteria. Visualised with green/amber/red reference bands
 * on the analytics charts.
 * =========================================================================*/

export interface RangeDef {
  id: string
  parameter: string
  nominal: string
  acceptableRange: string
  hardLimit: string
  standard: string
  tone: 'green' | 'amber' | 'red' | 'cyan' | 'violet'
}

export const RANGE_DEFS: RangeDef[] = [
  { id: 'freq', parameter: 'Grid frequency', nominal: '50.00 Hz', acceptableRange: '49.70 – 50.30 Hz (±0.6 %)', hardLimit: '48.5 – 50.5 Hz (CERC connectivity)', standard: 'IEC 61850 / CERC Indian Grid Code', tone: 'cyan' },
  { id: 'v-ht', parameter: 'HT phase voltage (11 kV class)', nominal: '6,350 V (11 kV / √3)', acceptableRange: '6,222 – 6,478 V (±2.0 %)', hardLimit: '±10 % (IS 16444 metering range)', standard: 'IS 16444 / CEA voltage regs', tone: 'green' },
  { id: 'v-lt', parameter: 'LT phase voltage (415 V class)', nominal: '239.6 V (415 V / √3)', acceptableRange: '236 – 243 V (±1.5 %)', hardLimit: '±6 % (IS 16444)', standard: 'IS 16444', tone: 'green' },
  { id: 'pf', parameter: 'Power factor (average)', nominal: '0.97 lagging', acceptableRange: '0.95 – 0.99 lag (incentive ≥ 0.95)', hardLimit: 'penalty < 0.90 (ToD tariff schedule)', standard: 'MSF ToD tariff schedule / CEA PF regs', tone: 'amber' },
  { id: 'thd-v', parameter: 'Voltage THD (bus)', nominal: '≤ 2.0 %', acceptableRange: '≤ 3.0 % alarm threshold', hardLimit: '5.0 % (bus, PCC ≤ 69 kV)', standard: 'IEEE 519-2022 Table 1', tone: 'violet' },
  { id: 'thd-i', parameter: 'Current TDD / THD', nominal: '≤ 5.0 %', acceptableRange: '≤ 8.0 % alarm threshold', hardLimit: '15.0 % (Is/IL 20–50)', standard: 'IEEE 519-2022 Table 2', tone: 'violet' },
  { id: 'unbalance', parameter: 'Voltage unbalance', nominal: '≤ 0.5 %', acceptableRange: '≤ 1.0 %', hardLimit: '2.0 % (NEMA MG-1 derating above)', standard: 'IEC 61000-2-2 / NEMA MG-1', tone: 'amber' },
  { id: 'cbct', parameter: 'CBCT leakage (earth fault)', nominal: '< 20 mA', acceptableRange: '20 – 200 mA alarm band', hardLimit: 'pickup 200 mA (efPickup setting)', standard: 'IS 3231 / relay earthPickupA', tone: 'red' },
  { id: 'clearing', parameter: 'Relay clearing time', nominal: 'per IEC curve & TMS', acceptableRange: 'measured vs IEC 60255 expected ±5 %', hardLimit: '300 ms main/back-up interval (Buff)', standard: 'IEC 60255-151 / IEEE 242 §15.7', tone: 'red' },
  { id: 'alarm-rate', parameter: 'Alarm rate (annunciator)', nominal: '≤ 6 /h per operator', acceptableRange: '6 – 10 /h review band', hardLimit: '> 10 /h = flood state', standard: 'IEC 62682 / ISA-18.2 §annex', tone: 'cyan' },
  { id: 'ack', parameter: 'Alarm acknowledge time', nominal: '< 300 s', acceptableRange: '< 600 s target', hardLimit: 'standing > 50 % = flood', standard: 'ISA-18.2 §R2.5', tone: 'cyan' },
  { id: 'loadfactor', parameter: 'Load factor (EnPI)', nominal: '≥ 0.75 target', acceptableRange: '0.70 – 0.85 healthy band', hardLimit: '< 0.55 = peaky profile action', standard: 'ISO 50006 EnPI guidance', tone: 'green' },
  { id: 'sec', parameter: 'Specific energy consumption', nominal: '96.4 kWh/ton (FY24 baseline)', acceptableRange: '±5 % of baseline', hardLimit: '+10 % triggers energy audit', standard: 'ISO 50006 / PAT baseline', tone: 'amber' },
  { id: 'sync', parameter: 'SOE time-stamp accuracy', nominal: '≤ 16 ms', acceptableRange: '≤ 16 ms design spec', hardLimit: '> 16 ms = sequence mis-ordering risk', standard: 'Annexure time-sync spec / IEC 61850-5', tone: 'red' },
  { id: 'cal', parameter: 'Metering class error (0.5S)', nominal: '0.00 % at 100 % Ib', acceptableRange: '±0.50 % (class 0.5S)', hardLimit: 'beyond class → meter withdrawal', standard: 'IS 16444 Table-6 / IEC 62053-22', tone: 'green' },
  { id: 'mw', parameter: 'Plant active power', nominal: '≈ 75 MW design load', acceptableRange: '55 – 90 MW operating band', hardLimit: 'demand sanction limit 105 MW', standard: 'MSF power sanction / demand charge', tone: 'cyan' },
]

/** exact colour stops for chart reference bands (matching RangeDef tones) */
export const RANGE_TONE_HEX: Record<RangeDef['tone'], string> = {
  green: '#4ADE80', amber: '#FBBF24', red: '#F87171', cyan: '#22D3EE', violet: '#A78BFA',
}
