/* ============================================================================
 * MSF Web SCADA — Mock Telemetry Engine
 * Simulates the complete MSF substation network described in the Annexure:
 *   5 substations, 134 VCBs, 104 relays (LK MC61CNX class), 134 MFMs
 *   (LK WL5010 class 0.5), Raspberry-Pi edge gateways over RS485 Modbus RTU.
 *
 * Industrial design notes (see prompt Challenges 1–4):
 *  C1: telemetry is modelled as contiguous Modbus register BLOCK reads
 *      (one burst per device group) — never per-tag polling.
 *  C2: SBO control with interlock validation + PIN (two-man rule).
 *  C3: data is buffered internally and dispatched in 250 ms batches.
 *  C4: per-gateway heartbeat + packet-loss; stale amber COMM_FAIL state.
 * ==========================================================================*/

import {
  Alarm, AuditEntry, Breaker, Gateway, InterlockResult, Mfm, Relay,
  RelaySettings, Role, SboSession, SubstationId, SUBSTATIONS, SwitchCommand,
} from '../types'

/* ----------------------------- utilities --------------------------------- */

/** Deterministic PRNG (mulberry32) */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Box–Muller gaussian noise */
function gauss(rand: () => number, mean = 0, std = 1): number {
  const u = Math.max(1e-9, rand())
  const v = rand()
  return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const uid = (() => {
  let n = 0
  return (p: string) => `${p}-${(++n).toString(36)}-${Date.now().toString(36)}`
})()

const DEMO_PIN = '1234'
export const SBO_DEMO_PIN = DEMO_PIN

/* --------------------------- IDMT protection ------------------------------ */

const CURVE_CONSTANTS: Record<RelaySettings['curve'], { k: number; a: number }> = {
  'normal-inverse': { k: 0.14, a: 0.02 },
  'very-inverse': { k: 13.5, a: 1 },
  'extremely-inverse': { k: 80, a: 2 },
  'definite-time': { k: 1, a: 0 },
}

/** IEC 60255 IDMT operate time (seconds) */
export function idmtOperateTime(s: RelaySettings, faultA: number): number {
  const M = faultA / s.pickupA
  if (M < 1.02) return Infinity
  const c = CURVE_CONSTANTS[s.curve]
  if (s.curve === 'definite-time') return clamp(s.tms * 3.0, 0.05, 30)
  return clamp(s.tms * (c.k / (Math.pow(M, c.a) - 1)), 0.04, 30)
}

/* ------------------------------ trip records ------------------------------ */

export interface RelayTripRecord {
  id: string
  relayId: string
  ts: number
  type: 'OC' | 'EF'
  phase: 'R' | 'Y' | 'B' | 'N'
  faultA: number
  pickupA: number
  clearingMs: number
  curve: RelaySettings['curve']
  tms: number
}

/* ------------------------------ network build ----------------------------- */

interface FeederSeed { loadA: number; kind: 'incomer' | 'buscoupler' | 'feeder'; bus: 'A' | 'B'; voltage: 'ht' | 'lt' }

function buildNetwork() {
  const breakers: Breaker[] = []
  const relays: Relay[] = []
  const mfms: Mfm[] = []
  const seeds = new Map<string, FeederSeed>()
  const rand = mulberry32(20260915)

  for (const ss of SUBSTATIONS) {
    let slave = 1
    const n = ss.vcbCount
    const feederCount = n - 3 // 2 incomers + 1 buscoupler
    const mk = (name: string, kind: FeederSeed['kind'], bus: 'A' | 'B', voltage: 'ht' | 'lt', loadA: number): Breaker => {
      const b: Breaker = {
        id: `${ss.id}:${name}`,
        name,
        substation: ss.id,
        kind,
        bus,
        voltage,
        state: rand() < 0.92 ? 'closed' : 'open',
        slaveId: slave++,
        inService: rand() > 0.03,
        springCharged: rand() > 0.05,
        remoteLocal: rand() > 0.08 ? 'remote' : 'local',
        tripLatch: false,
        earthFaultLatch: false,
        commOk: true,
        lastUpdate: Date.now(),
      }
      seeds.set(b.id, { loadA, kind, bus, voltage })
      breakers.push(b)
      return b
    }

    // Incomers from the 11 kV grid (Bus-A and Bus-B)
    const incA = mk('INC-A', 'incomer', 'A', 'ht', 620 + rand() * 260)
    const incB = mk('INC-B', 'incomer', 'B', 'ht', 540 + rand() * 260)
    mk('BUS-CP', 'buscoupler', 'B', 'ht', 20 + rand() * 60)

    for (let f = 1; f <= feederCount; f++) {
      const bus: 'A' | 'B' = f % 2 === 1 ? 'A' : 'B'
      // every ~7th feeder is an LT (415 V) distribution section
      const voltage: 'ht' | 'lt' = f % 7 === 0 ? 'lt' : 'ht'
      const loadA = voltage === 'lt' ? 420 + rand() * 620 : 14 + rand() * (f % 5 === 0 ? 90 : 55)
      mk(`F-${String(f).padStart(2, '0')}`, 'feeder', bus, voltage, loadA)
    }

    // One relay per breaker that has protection (incomers, coupler, most feeders)
    for (const b of breakers.filter((x) => x.substation === ss.id)) {
      const hasRelay = relays.filter((r) => r.substation === ss.id).length < ss.relayCount
      if (!hasRelay) break
      const pickup = b.kind === 'incomer' ? 800 : b.kind === 'buscoupler' ? 400 : b.voltage === 'lt' ? 900 : 160
      const r: Relay = {
        id: `RLY:${b.id}`,
        name: `${b.name}-RLY`,
        substation: ss.id,
        breakerId: b.id,
        slaveId: slave++,
        model: 'LK MC61CNX (L&T / Siemens equiv.)',
        curve: (['normal-inverse', 'very-inverse', 'extremely-inverse', 'definite-time'] as const)[
          Math.floor(rand() * 4)
        ],
        tms: Number((0.05 + rand() * 0.55).toFixed(2)),
        pickupA: pickup,
        earthPickupA: b.voltage === 'lt' ? 120 : 40,
        instPickupA: pickup * 8,
        ir: 0, iy: 0, ib: 0, iN: 0, cbctLeakage: 0,
        tripCoilHealthy: rand() > 0.02,
        ledFault: [false, false, false, false],
        ocTripCount: Math.floor(rand() * 6),
        efTripCount: Math.floor(rand() * 3),
        lastTripAt: null,
      }
      relays.push(r)
    }

    // One MFM per breaker
    for (const b of breakers.filter((x) => x.substation === ss.id)) {
      const seed = seeds.get(b.id)!
      const m: Mfm = {
        id: `MFM:${b.id}`,
        name: `${b.name}-MFM`,
        substation: ss.id,
        breakerId: b.id,
        slaveId: slave++,
        model: 'LK WL5010 (Class 0.5)',
        ctRatio: b.voltage === 'lt' ? 1600 : 800,
        online: true,
        vRY: 11000, vYB: 11000, vBR: 11000,
        vR: 6350, vY: 6350, vB: 6350,
        iR: 0, iY: 0, iB: 0, iN: 0,
        kW: 0, kVAR: 0, kVA: 0, pf: 0.97, pfR: 0.97, pfY: 0.97, pfB: 0.97, freq: 50,
        thdV: 2.2, thdI: 3.4,
        kWhImport: 120000 + rand() * 900000,
        kWhExport: rand() * 40000,
        kVAh: 150000 + rand() * 800000,
        harmonics: [1.6, 2.8, 1.9, 1.1, 0.7, 0.4],
      }
      if (b.voltage === 'lt') {
        m.vRY = 415; m.vYB = 415; m.vBR = 415
        m.vR = 240; m.vY = 240; m.vB = 240
      }
      mfms.push(m)
    }
  }
  return { breakers, relays, mfms, seeds }
}

/* ------------------------------- the engine ------------------------------- */

export interface EngineSnapshot {
  ts: number
  tick: number
  breakers: Breaker[]
  relays: Relay[]
  mfms: Mfm[]
  gateways: Gateway[]
  alarms: Alarm[]
  audit: AuditEntry[]
  trips: RelayTripRecord[]
  /** engine back-reference (non-enumerable in usage, stable identity) — lets report
   *  builders integrate the live trend rings straight from the telemetry source. */
  engine: TelemetryEngine
}

export interface Kpis {
  mw: number
  mva: number
  mvar: number
  pf: number
  hz: number
  carbonOffsetTons: number
  closedVcbs: number
  trippedVcbs: number
  commOkVcbs: number
}

type Listener = (s: EngineSnapshot) => void

class TelemetryEngine {
  private breakers: Breaker[] = []
  private relays: Relay[] = []
  private mfms: Mfm[] = []
  private seeds = new Map<string, FeederSeed>()
  private gateways: Gateway[] = []
  private alarms: Alarm[] = []
  private audit: AuditEntry[] = []
  private trips: RelayTripRecord[] = []
  private alarmIndex = new Map<string, Alarm>()
  private listeners = new Set<Listener>()
  private timer: number | null = null
  private tick = 0
  private rand = mulberry32(987654321)
  private snap: EngineSnapshot
  private sessionUser = 'system'
  private sessionRole: Role = 'guest'
  private pendingTrips = new Map<string, number>() // breakerId -> timeout handle
  private trendBuffer = new Map<string, { t: number; ir: number; vRY: number; kw: number; pf: number; hz: number }[]>()

  /* history ring for trend view (per breaker, last 240 samples) */
  static readonly TREND_LEN = 240

  constructor() {
    const net = buildNetwork()
    this.breakers = net.breakers
    this.relays = net.relays
    this.mfms = net.mfms
    this.seeds = net.seeds
    this.gateways = SUBSTATIONS.map((s) => ({
      substation: s.id,
      piModel: 'Raspberry Pi 4B edge gateway (RS485→USB, Modbus RTU 9600 8-N-1 + Modbus TCP)',
      state: 'online' as const,
      latencyMs: 8 + Math.random() * 14,
      packetLossPct: 0,
      pollsPerSec: 4,
      registersPerPoll: Math.ceil(s.activeTags / 24) * 24, // block reads
      uptimePct: 99.2 + Math.random() * 0.7,
      lastHeartbeat: Date.now(),
      baud: 9600,
    }))
    this.seedHistory()
    this.seedRelayTripLogs()
    this.pushAudit('system', 'guest', 'ENGINE_BOOT', 'MOCK-ENGINE', 'Mock telemetry engine initialised (5 SS, no field hardware)')
    this.snap = this.buildSnapshot()
  }

  /* ------------------------- lifecycle & subscription -------------------- */

  start(user = 'system', role: Role = 'guest') {
    this.sessionUser = user
    this.sessionRole = role
    if (this.timer !== null) return
    this.timer = window.setInterval(() => this.step(), 250)
  }

  stop() {
    if (this.timer !== null) window.clearInterval(this.timer)
    this.timer = null
  }

  setSession(user: string, role: Role) {
    this.sessionUser = user
    this.sessionRole = role
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    fn(this.snap)
    return () => this.listeners.delete(fn)
  }

  getSnapshot(): EngineSnapshot {
    return this.snap
  }

  /* ------------------------------ simulation ----------------------------- */

  private step() {
    this.tick++
    const now = Date.now()
    const dt = 0.25 // seconds
    const hour = new Date(now).getHours() + new Date(now).getMinutes() / 60
    // Daily load profile — peaks morning & evening
    const loadFactor = 0.78 + 0.22 * Math.sin(((hour - 6.5) / 24) * 2 * Math.PI)

    /* -- Challenge 4: gateway heartbeat, packet loss, partitions ---------- */
    for (const g of this.gateways) {
      if (g.state !== 'offline') {
        g.latencyMs = clamp(g.latencyMs + gauss(this.rand, 0, 1.2), 6, g.state === 'degraded' ? 900 : 60)
        g.packetLossPct = clamp(g.packetLossPct + (g.state === 'degraded' ? gauss(this.rand, 0.4, 0.3) : -g.packetLossPct * 0.3), 0, 22)
        g.uptimePct = clamp(g.uptimePct, 90, 99.99)
        g.lastHeartbeat = now
      }
      const prev = g.state
      if (this.rand() < (g.state === 'online' ? 0.0035 : 0.09)) {
        g.state = g.state === 'online' ? (this.rand() < 0.85 ? 'degraded' : 'offline') : 'online'
        if (g.state === 'offline') g.packetLossPct = 100
        if (prev !== g.state) {
          if (g.state !== 'online') {
            this.raiseAlarm(g.substation, `GWY-${g.substation}`, 'comm-fail', g.state === 'offline' ? 'critical' : 'major',
              `Gateway ${g.substation} ${g.state === 'offline' ? 'COMM_FAIL — network partition' : 'DEGRADED — packet loss'} (${g.packetLossPct.toFixed(1)}%)`)
          } else {
            this.clearAlarm(`GWY-${g.substation}`, 'comm-fail')
            this.raiseAlarm(g.substation, `GWY-${g.substation}`, 'info', 'info', `Gateway ${g.substation} heartbeat restored (latency ${g.latencyMs.toFixed(0)} ms)`)
          }
        }
      }
    }

    const freq = 50 + gauss(this.rand, 0, 0.028)
    const perSsClosed = new Map<SubstationId, number>()

    for (const b of this.breakers) {
      const g = this.gateways.find((x) => x.substation === b.substation)!
      const commOk = g.state === 'online'
      const wasCommOk = b.commOk
      b.commOk = commOk
      b.lastUpdate = now

      if (b.commOk !== wasCommOk) {
        if (!commOk) this.raiseAlarm(b.substation, b.name, 'comm-fail', 'warning', `${b.name} data STALE — gateway ${b.substation} unreachable`)
        else this.clearAlarm(b.name, 'comm-fail')
      }
      if (!commOk) continue // frozen values → STALE data on the SLD

      perSsClosed.set(b.substation, (perSsClosed.get(b.substation) ?? 0) + (b.state === 'closed' ? 1 : 0))

      const mfm = this.mfms.find((m) => m.breakerId === b.id)!
      const relay = this.relays.find((r) => r.breakerId === b.id)
      const seed = this.seeds.get(b.id)!
      const energized = b.state === 'closed'

      /* analog values with gaussian jitter (spec: HT 11kV ±1.2%, LT 415V ±1.5%) */
      const jitterV = b.voltage === 'lt' ? 0.015 : 0.012
      const vNom = b.voltage === 'lt' ? 415 : 11000
      const v = energized ? vNom * (1 + gauss(this.rand, 0, jitterV / 2.2)) : vNom * 0.02 * this.rand()
      const iBase = seed.loadA * loadFactor
      const iAvg = energized ? Math.max(0, iBase * (1 + gauss(this.rand, 0, 0.035)) + gauss(this.rand, 0, iBase * 0.012)) : 0
      const unbal = 1 + gauss(this.rand, 0, 0.02)
      const iR = iAvg * unbal, iY = iAvg * (2 - unbal), iB = iAvg * (1 + gauss(this.rand, 0, 0.018))
      const pf = energized ? clamp(0.94 + this.rand() * 0.05, 0.94, 0.99) : 0
      // per-phase PF scatter around the aggregate (Annexure: phase PF R/Y/B)
      const pfR = clamp(pf + gauss(this.rand, 0, 0.008), 0.92, 0.995)
      const pfY = clamp(pf + gauss(this.rand, 0, 0.008), 0.92, 0.995)
      const pfB = clamp(pf + gauss(this.rand, 0, 0.008), 0.92, 0.995)
      const freqM = freq + gauss(this.rand, 0, 0.004)

      mfm.vRY = v; mfm.vYB = v * (1 + gauss(this.rand, 0, 0.003)); mfm.vBR = v * (1 + gauss(this.rand, 0, 0.003))
      const vPh = v / Math.sqrt(3)
      mfm.vR = vPh; mfm.vY = vPh * (1 + gauss(this.rand, 0, 0.002)); mfm.vB = vPh * (1 + gauss(this.rand, 0, 0.002))
      mfm.iR = iR; mfm.iY = iY; mfm.iB = iB
      mfm.iN = energized ? Math.abs(iR + iY + iB) * 0.04 + Math.abs(gauss(this.rand, 0, 1.5)) : 0
      mfm.pf = pf; mfm.pfR = pfR; mfm.pfY = pfY; mfm.pfB = pfB; mfm.freq = freqM
      mfm.kW = (Math.sqrt(3) * v * iAvg * pf) / 1000
      mfm.kVAR = (Math.sqrt(3) * v * iAvg * Math.sqrt(Math.max(0.0001, 1 - pf * pf))) / 1000
      mfm.kVA = mfm.kW / Math.max(0.5, pf)
      mfm.thdV = clamp(mfm.thdV + gauss(this.rand, 0, 0.08), 1.2, 5.5)
      mfm.thdI = clamp(mfm.thdI + gauss(this.rand, 0, 0.15), 1.5, 9)
      mfm.kWhImport += (mfm.kW * dt) / 3600
      mfm.kVAh += (mfm.kVA * dt) / 3600
      mfm.online = true
      mfm.harmonics = mfm.harmonics.map((h) => clamp(h + gauss(this.rand, 0, 0.12), 0.1, 8))

      if (relay) {
        relay.ir = iR; relay.iy = iY; relay.ib = iB
        relay.iN = mfm.iN
        relay.cbctLeakage = energized ? clamp(relay.cbctLeakage + gauss(this.rand, 0, 0.05), 0.05, seed.kind === 'incomer' ? 6 : 3) : 0
        relay.tripCoilHealthy = this.rand() > 0.001 ? relay.tripCoilHealthy : !relay.tripCoilHealthy
        relay.ledFault = [b.state === 'tripped', relay.cbctLeakage > relay.earthPickupA / 4, iAvg > relay.pickupA, !relay.tripCoilHealthy]
      }

      /* ---- threshold / annunciator checks (Challenge: alarm workflow) ---- */
      if (energized) {
        const vLimHi = vNom * 1.1, vLimLo = vNom * 0.9
        if (v > vLimHi) this.raiseAlarm(b.substation, b.name, 'overvoltage', 'major', `${b.name} OVERVOLTAGE ${v.toFixed(0)} V > ${vLimHi.toFixed(0)} V`, v, vLimHi)
        else this.clearAlarm(b.name, 'overvoltage')
        if (v < vLimLo) this.raiseAlarm(b.substation, b.name, 'undervoltage', 'major', `${b.name} UNDERVOLTAGE ${v.toFixed(0)} V < ${vLimLo.toFixed(0)} V`, v, vLimLo)
        else this.clearAlarm(b.name, 'undervoltage')
        if (Math.abs(freqM - 50) > 0.15) this.raiseAlarm(b.substation, b.name, 'freq-drift', 'major', `${b.name} FREQUENCY DRIFT ${freqM.toFixed(3)} Hz`, freqM, 50)
        else this.clearAlarm(b.name, 'freq-drift')
        if (relay && iAvg > relay.pickupA * 1.02 && b.state === 'closed') {
          this.raiseAlarm(b.substation, b.name, 'overcurrent', 'warning', `${b.name} OVERCURRENT PICKUP ${iAvg.toFixed(0)} A ≥ ${relay.pickupA} A (IDMT running)`, iAvg, relay.pickupA)
        } else this.clearAlarm(b.name, 'overcurrent')
        if (relay && relay.cbctLeakage > relay.earthPickupA / 2) {
          this.raiseAlarm(b.substation, b.name, 'earthfault', 'warning', `${b.name} CBCT LEAKAGE ${relay.cbctLeakage.toFixed(2)} A (EF pickup ${relay.earthPickupA} A)`, relay.cbctLeakage, relay.earthPickupA / 2)
        } else this.clearAlarm(b.name, 'earthfault')
      } else {
        for (const c of ['overvoltage', 'undervoltage', 'freq-drift', 'overcurrent', 'earthfault'] as const) this.clearAlarm(b.name, c)
      }
    }

    /* ---- aggregate KPIs ---- */
    let mw = 0, mvar = 0
    for (const m of this.mfms) {
      const b = this.breakers.find((x) => x.id === m.breakerId)!
      if (b.kind === 'incomer' && b.state === 'closed' && b.commOk) { mw += m.kW; mvar += m.kVAR }
    }
    const mva = Math.sqrt(mw * mw + mvar * mvar)

    this.snap = this.buildSnapshot(now, { mw, mvar, mva, hz: freq })
    for (const fn of this.listeners) fn(this.snap)
  }

  private buildSnapshot(now = Date.now(), kpi?: { mw: number; mvar: number; mva: number; hz: number }): EngineSnapshot {
    // refresh trend ring buffers for SLD-selected trend persistence
    for (const b of this.breakers) {
      const m = this.mfms.find((x) => x.breakerId === b.id)!
      let buf = this.trendBuffer.get(b.id)
      if (!buf) { buf = []; this.trendBuffer.set(b.id, buf) }
      buf.push({ t: now, ir: m.iR, vRY: m.vRY, kw: m.kW, pf: m.pf, hz: m.freq })
      if (buf.length > TelemetryEngine.TREND_LEN) buf.shift()
    }
    this.snapKpis = kpi ?? this.snapKpis
    return {
      ts: now,
      tick: this.tick,
      breakers: this.breakers.map((b) => ({ ...b })),
      relays: this.relays.map((r) => ({ ...r })),
      mfms: this.mfms.map((m) => ({ ...m })),
      gateways: this.gateways.map((g) => ({ ...g })),
      alarms: this.alarms,
      audit: this.audit,
      trips: this.trips,
      /** engine back-reference: reports integrate the live trend rings from the source */
      engine: this,
    }
  }

  private snapKpis = { mw: 0, mvar: 0, mva: 0, hz: 50 }

  getKpis(): Kpis {
    const { mw, mvar, mva, hz } = this.snapKpis
    const closed = this.breakers.filter((b) => b.state === 'closed').length
    const tripped = this.breakers.filter((b) => b.state === 'tripped').length
    const commOk = this.breakers.filter((b) => b.commOk).length
    // 2050 carbon-neutral tracker: grid CO2 factor 0.82 kg/kWh avoided via solar blend 38%
    const carbonOffsetTons = (this.mfms.reduce((s, m) => s + m.kWhExport, 0) * 0.82) / 1000
    return { mw: mw / 1000, mvar: mvar / 1000, mva: mva / 1000, pf: mva > 0 ? mw / mva : 0.97, hz, carbonOffsetTons, closedVcbs: closed, trippedVcbs: tripped, commOkVcbs: commOk }
  }

  /** Energisation model for the SLD (IEC 617-2-8 symbology) */
  busState(ss: SubstationId): { busA: boolean; busB: boolean } {
    const bs = this.breakers.filter((b) => b.substation === ss)
    const incA = bs.find((b) => b.name === 'INC-A')!
    const incB = bs.find((b) => b.name === 'INC-B')!
    const cp = bs.find((b) => b.name === 'BUS-CP')!
    const healthy = (b: Breaker) => b.commOk && b.inService
    let busA = incA.state === 'closed' && healthy(incA)
    let busB = incB.state === 'closed' && healthy(incB)
    if (cp.state === 'closed' && healthy(cp)) { busA = busA || busB; busB = busB || busA }
    return { busA, busB }
  }

  feederEnergized(b: Breaker): boolean {
    const { busA, busB } = this.busState(b.substation)
    if (b.state !== 'closed' || !b.commOk) return false
    if (b.kind === 'incomer') return true
    return b.bus === 'A' ? busA : busB
  }

  /* --------------------------- alarm bookkeeping ------------------------- */

  private raiseAlarm(ss: SubstationId, source: string, cls: Alarm['cls'], severity: Alarm['severity'], message: string, value?: number, limit?: number) {
    const key = `${ss}:${source}:${cls}`
    const existing = this.alarmIndex.get(key)
    if (existing && existing.active) { existing.ts = Date.now(); existing.value = value; return }
    const a: Alarm = {
      id: uid('alm'), ts: Date.now(), substation: ss, source, cls, severity,
      message, value, limit, acknowledged: false, active: true,
    }
    this.alarms.unshift(a)
    if (this.alarms.length > 400) this.alarms.pop()
    this.alarmIndex.set(key, a)
  }

  private clearAlarm(source: string, cls: Alarm['cls']) {
    for (const [key, a] of this.alarmIndex) {
      if (a.source === source && a.cls === cls && a.active) {
        a.active = false
        this.alarmIndex.delete(key)
      }
    }
  }

  ackAlarm(id: string, user: string) {
    const a = this.alarms.find((x) => x.id === id)
    if (a && !a.acknowledged) {
      a.acknowledged = true
      a.ackBy = user
      a.ackAt = Date.now()
      this.pushAudit(user, this.sessionRole, 'ALARM_ACK', a.source, `${a.cls} alarm acknowledged — ${a.message}`)
    }
  }

  ackAll(user: string) {
    for (const a of this.alarms) {
      if (!a.acknowledged) { a.acknowledged = true; a.ackBy = user; a.ackAt = Date.now() }
    }
    this.pushAudit(user, this.sessionRole, 'ALARM_ACK_ALL', 'ANNUNCIATOR', 'All active alarms acknowledged (page-level)')
  }

  getAlarms(): Alarm[] { return this.alarms }
  getAudit(): AuditEntry[] { return this.audit }

  private pushAudit(user: string, role: Role, action: string, target: string, detail: string, verifiedBy?: string) {
    this.audit.unshift({ id: uid('aud'), ts: Date.now(), user, role, action, target, detail, verifiedBy })
    if (this.audit.length > 400) this.audit.pop()
  }

  /* ------------------- SBO breaker control (Challenge 2) ------------------ */

  validateInterlocks(b: Breaker, cmd: SwitchCommand): InterlockResult {
    if (!b.commOk) return { allowed: false, reason: 'COMM_FAIL — gateway unreachable, remote operation blocked' }
    if (b.remoteLocal === 'local') return { allowed: false, reason: 'Breaker is in LOCAL mode — switch to REMOTE at the panel' }
    if (!b.inService) return { allowed: false, reason: 'Breaker in TEST position — service/Test selector must be in SERVICE' }
    if (cmd === 'close') {
      if (b.state === 'closed') return { allowed: false, reason: 'Breaker already CLOSED' }
      if (b.tripLatch) return { allowed: false, reason: 'Trip latch active — perform Trip Reset before Close' }
      if (b.earthFaultLatch) return { allowed: false, reason: 'Earth-fault latch active — Close interlocked (safety)' }
      if (!b.springCharged) return { allowed: false, reason: 'Spring not charged — closing coil disabled' }
      const { busA, busB } = this.busState(b.substation)
      if (b.kind === 'feeder' && !(busA || busB)) return { allowed: false, reason: 'Both busbars de-energized — no source available' }
    }
    if (cmd === 'trip' && b.state !== 'closed') return { allowed: false, reason: 'Breaker is not CLOSED' }
    if (cmd === 'trip-reset' && b.state !== 'tripped') return { allowed: false, reason: 'No active trip latch on this breaker' }
    return { allowed: true }
  }

  /** Full SBO execution: purpose → confirm → PIN → interlocks → operate */
  executeSbo(session: SboSession, user: string, role: Role, pin: string): InterlockResult {
    const b = this.breakers.find((x) => x.id === session.breakerId)
    if (!b) return { allowed: false, reason: 'Unknown breaker' }
    if (pin !== DEMO_PIN) {
      this.pushAudit(user, role, 'SBO_REJECTED', b.name, 'PIN verification failed — command aborted')
      return { allowed: false, reason: 'PIN verification failed — command aborted (attempt logged to audit trail)' }
    }
    const il = this.validateInterlocks(b, session.command)
    if (!il.allowed) {
      this.pushAudit(user, role, 'SBO_BLOCKED', b.name, `Interlock: ${il.reason}`)
      return il
    }
    if (session.command === 'trip') {
      this.doTrip(b, 'COMMAND', user, `Manual TRIP via SBO — purpose: ${session.purpose}`)
    } else if (session.command === 'close') {
      b.state = 'closed'
      b.tripLatch = false
      this.raiseAlarm(b.substation, b.name, 'breaker-op', 'info', `${b.name} CLOSED remotely by ${user} (SBO, purpose: ${session.purpose})`)
      this.pushAudit(user, role, 'BREAKER_CLOSE', b.name, `Remote CLOSE executed — purpose: ${session.purpose}`, user)
    } else {
      b.state = 'open'
      b.tripLatch = false
      this.raiseAlarm(b.substation, b.name, 'breaker-op', 'info', `${b.name} trip latch RESET by ${user}`)
      this.pushAudit(user, role, 'TRIP_RESET', b.name, 'Trip latch reset after protection operation')
    }
    this.snap = this.buildSnapshot()
    for (const fn of this.listeners) fn(this.snap)
    return { allowed: true }
  }

  private doTrip(b: Breaker, cause: 'PROTECTION_OC' | 'PROTECTION_EF' | 'COMMAND', by?: string, detail = '') {
    b.state = 'tripped'
    b.tripLatch = true
    const relay = this.relays.find((r) => r.breakerId === b.id)
    const mfm = this.mfms.find((m) => m.breakerId === b.id)
    const faultA = mfm ? Math.max(mfm.iR, mfm.iY, mfm.iB) : 0
    if (relay && (cause === 'PROTECTION_OC' || cause === 'PROTECTION_EF')) {
      const rec: RelayTripRecord = {
        id: uid('trp'), relayId: relay.id, ts: Date.now(),
        type: cause === 'PROTECTION_OC' ? 'OC' : 'EF',
        phase: cause === 'PROTECTION_OC' ? (['R', 'Y', 'B'] as const)[Math.floor(this.rand() * 3)] : 'N',
        faultA: cause === 'PROTECTION_OC' ? faultA * (2 + this.rand() * 4) : relay.cbctLeakage * (8 + this.rand() * 10),
        pickupA: cause === 'PROTECTION_OC' ? relay.pickupA : relay.earthPickupA,
        clearingMs: Math.round(40 + this.rand() * 180),
        curve: relay.curve, tms: relay.tms,
      }
      this.trips.unshift(rec)
      if (this.trips.length > 600) this.trips.pop()
      if (cause === 'PROTECTION_OC') relay.ocTripCount++
      else relay.efTripCount++
      relay.lastTripAt = rec.ts
      relay.ledFault[0] = true
      this.raiseAlarm(b.substation, b.name, cause === 'PROTECTION_OC' ? 'overcurrent' : 'earthfault', 'critical',
        `${b.name} TRIPPED — ${cause === 'PROTECTION_OC' ? 'Overcurrent' : 'Earth Fault'} ${rec.faultA.toFixed(0)} A, cleared in ${rec.clearingMs} ms (${relay.name})`)
    } else {
      this.raiseAlarm(b.substation, b.name, 'trip', 'major', `${b.name} TRIPPED — ${detail || 'remote command'}`)
    }
    if (by) this.pushAudit(by, this.sessionRole, 'BREAKER_TRIP', b.name, detail)
    else this.pushAudit('protection', 'engineer', 'BREAKER_TRIP', b.name, detail || 'Protection element operated')
  }

  /* ---------------------- fault injection (dev tool) ---------------------- */

  injectFault(breakerId: string, type: 'oc' | 'ef', magnitudeMult = 3, user = 'demo'): InterlockResult {
    const b = this.breakers.find((x) => x.id === breakerId)
    const relay = this.relays.find((r) => r.breakerId === breakerId)
    if (!b || !relay) return { allowed: false, reason: 'Unknown feeder' }
    if (b.state !== 'closed') return { allowed: false, reason: 'Feeder is not energized (breaker open) — close it first' }
    if (!b.commOk) return { allowed: false, reason: 'COMM_FAIL — cannot inject on stale gateway' }
    const mfm = this.mfms.find((m) => m.breakerId === breakerId)!
    const t = type === 'oc'
      ? idmtOperateTime(relay, mfm.iR * magnitudeMult)
      : clamp(relay.tms * 0.8, 0.1, 6)
    /* Breaker-fail simulation: small chance the breaker mechanism fails to open,
     * forcing breaker-fail (50Z/62BF) stage → upstream incomer trip (Annexure:
     * "Breaker failure protection" + "blocking the upstream relay"). */
    const breakerFail = this.rand() < 0.1
    const handle = window.setTimeout(() => {
      this.pendingTrips.delete(breakerId)
      if (breakerFail) {
        this.raiseAlarm(b.substation, b.name, 'trip', 'critical',
          `BREAKER FAIL — ${b.name} failed to open on ${type === 'oc' ? 'OC' : 'EF'} operation; 50Z timer expired (200 ms stage)`)
        const inc = this.breakers.find(
          (x) => x.substation === b.substation && x.kind === 'incomer' && x.bus === b.bus && x.state === 'closed')
        if (inc) {
          this.doTrip(inc, 'PROTECTION_OC', undefined, `Upstream ${inc.name} cleared by breaker-fail protection for failed ${b.name}`)
          this.pushAudit('protection', 'engineer', 'BREAKER_FAIL', b.name, `50Z stage tripped upstream ${inc.name} (fault cleared, bus-${b.bus} isolated)`)
        } else {
          this.pushAudit('protection', 'engineer', 'BREAKER_FAIL', b.name, '50Z stage — no upstream breaker available (fault persists on dead bus)')
        }
      } else if (type === 'oc') {
        this.doTrip(b, 'PROTECTION_OC', undefined, `Injected OC fault (${magnitudeMult.toFixed(1)}× pickup) — IDMT cleared`)
      } else {
        this.doTrip(b, 'PROTECTION_EF', undefined, 'Injected Earth-Fault via CBCT (injected)')
      }
      b.earthFaultLatch = type === 'ef'
      this.snap = this.buildSnapshot()
      for (const fn of this.listeners) fn(this.snap)
    }, t * 1000)
    this.pendingTrips.set(breakerId, handle)
    this.pushAudit(user, this.sessionRole, 'FAULT_INJECT', b.name, `${type.toUpperCase()} fault injected — relay ${relay.name} pickup in ${t.toFixed(2)} s (${relay.curve}, TMS ${relay.tms})${breakerFail ? ' [breaker-fail scenario armed]' : ''}`)
    return { allowed: true, reason: `Relay ${relay.name} will trip in ${t.toFixed(2)} s${breakerFail ? ' — ⚠ breaker-fail scenario armed (10% chance)' : ''}` }
  }

  cancelInjection(breakerId: string) {
    const h = this.pendingTrips.get(breakerId)
    if (h) { window.clearTimeout(h); this.pendingTrips.delete(breakerId) }
  }

  /* ------------------------ relay settings (Engineer) --------------------- */

  updateRelaySettings(relayId: string, s: Partial<RelaySettings>, user: string) {
    const r = this.relays.find((x) => x.id === relayId)
    if (!r) return
    Object.assign(r, {
      ...s,
      tms: s.tms !== undefined ? clamp(s.tms, 0.01, 1.6) : r.tms,
    })
    this.pushAudit(user, this.sessionRole, 'RELAY_SETTING', r.name,
      `Settings changed → curve ${r.curve}, TMS ${r.tms}, I> ${r.pickupA} A, I>> ${r.instPickupA} A, Ie> ${r.earthPickupA} A`)
    this.snap = this.buildSnapshot()
    for (const fn of this.listeners) fn(this.snap)
  }

  getRelayTrips(relayId?: string): RelayTripRecord[] {
    return relayId ? this.trips.filter((t) => t.relayId === relayId) : this.trips
  }

  getTrendBuffer(breakerId: string) {
    return this.trendBuffer.get(breakerId) ?? []
  }

  /* --------------------------- historical series -------------------------- */

  /** Deterministic synthetic history for Today vs Yesterday / Previous-shift compare */
  historicalSeries(ss: SubstationId, startTs: number, points: number, stepMs: number, metric: 'mw' | 'hz'): { t: number; v: number }[] {
    const out: { t: number; v: number }[] = []
    const seedBase = [...ss].reduce((s, c) => s + c.charCodeAt(0), 0)
    const r = mulberry32(seedBase * 7919 + Math.floor(startTs / 86400000))
    const base = metric === 'mw' ? 18 + (seedBase % 9) : 50
    for (let i = 0; i < points; i++) {
      const t = startTs + i * stepMs
      const hour = ((t % 86400000) / 3600000 + 5.5) % 24
      const shape = 0.72 + 0.28 * Math.sin(((hour - 6.5) / 24) * 2 * Math.PI)
      const v = metric === 'mw' ? base * shape * (1 + gauss(r, 0, 0.05)) : 50 + gauss(r, 0, 0.03)
      out.push({ t, v: Math.max(0, v) })
    }
    return out
  }

  /* ------------------------------ boot seeding ---------------------------- */

  private seedHistory() {
    // pre-fill trend rings so charts are alive on first paint
    const now = Date.now()
    for (const b of this.breakers) {
      const seed = this.seeds.get(b.id)!
      const buf: { t: number; ir: number; vRY: number; kw: number; pf: number; hz: number }[] = []
      for (let i = TelemetryEngine.TREND_LEN; i > 0; i--) {
        const t = now - i * 250
        const iA = seed.kind === 'incomer' ? seed.loadA * 0.9 : seed.loadA * 0.85
        buf.push({
          t,
          ir: b.state === 'closed' ? iA * (1 + gauss(this.rand, 0, 0.03)) : 0,
          vRY: b.voltage === 'lt' ? 415 * (1 + gauss(this.rand, 0, 0.006)) : 11000 * (1 + gauss(this.rand, 0, 0.005)),
          kw: (Math.sqrt(3) * (b.voltage === 'lt' ? 415 : 11000) * iA * 0.97) / 1000,
          pf: 0.94 + this.rand() * 0.05,
          hz: 50 + gauss(this.rand, 0, 0.03),
        })
      }
      this.trendBuffer.set(b.id, buf)
    }
  }

  private seedRelayTripLogs() {
    // 15 OC + 15 EF historical trips per relay (spec: "15 for OC & 15 for EF")
    const now = Date.now()
    for (const r of this.relays) {
      for (let i = 0; i < 15; i++) {
        this.trips.push(this.makeHistTrip(r, 'OC', now - (i + 1) * (36e5 * (5 + this.rand() * 80))))
      }
      for (let i = 0; i < 15; i++) {
        this.trips.push(this.makeHistTrip(r, 'EF', now - (i + 1) * (36e5 * (11 + this.rand() * 120))))
      }
    }
    this.trips.sort((a, b) => b.ts - a.ts)
  }

  private makeHistTrip(r: Relay, type: 'OC' | 'EF', ts: number): RelayTripRecord {
    return {
      id: uid('trp'), relayId: r.id, ts,
      type,
      phase: type === 'OC' ? (['R', 'Y', 'B'] as const)[Math.floor(this.rand() * 3)] : 'N',
      faultA: type === 'OC' ? r.pickupA * (1.4 + this.rand() * 6) : r.earthPickupA * (1.1 + this.rand() * 3),
      pickupA: type === 'OC' ? r.pickupA : r.earthPickupA,
      clearingMs: Math.round(35 + this.rand() * 320),
      curve: r.curve, tms: r.tms,
    }
  }
}

export const telemetryEngine = new TelemetryEngine()
