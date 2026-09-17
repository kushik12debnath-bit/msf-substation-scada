/* ============================================================================
 * MSF Web SCADA — Core Domain Types
 * Derived from: MSF SCADA Annexure (Technical Specification — Electrical
 * Assets Metering & Monitoring through SCADA, MSF Substation, 6 pages)
 * ==========================================================================*/

/* ---------------------------------- Roles --------------------------------- */

export type Role = 'guest' | 'operator' | 'supervisor' | 'engineer' | 'manager' | 'admin'

export interface User {
  username: string
  displayName: string
  role: Role
}

export type Permission =
  | 'view_overview'
  | 'view_sld'
  | 'view_relays'
  | 'view_meters'
  | 'view_trends'
  | 'view_reports'
  | 'ack_alarm'
  | 'config_trends'
  | 'config_reports'
  | 'view_diagnostics'
  | 'edit_relay_settings'
  | 'edit_thresholds'
  | 'breaker_control'
  | 'trip_reset'
  | 'fault_injection'
  | 'user_admin'
  | 'view_audit'

export const ROLE_LABEL: Record<Role, string> = {
  guest: 'Guest',
  operator: 'Operator',
  supervisor: 'Supervisor',
  engineer: 'Engineer',
  manager: 'Manager',
  admin: 'Admin',
}

/** Authority matrix per Annexure §"Access control" + SBO hardening */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  guest: ['view_overview'],
  operator: [
    'view_overview', 'view_sld', 'view_relays', 'view_meters', 'view_trends',
    'view_reports', 'ack_alarm',
  ],
  supervisor: [
    'view_overview', 'view_sld', 'view_relays', 'view_meters', 'view_trends',
    'view_reports', 'ack_alarm', 'config_trends', 'config_reports', 'view_diagnostics',
  ],
  engineer: [
    'view_overview', 'view_sld', 'view_relays', 'view_meters', 'view_trends',
    'view_reports', 'ack_alarm', 'config_trends', 'config_reports', 'view_diagnostics',
    'edit_relay_settings', 'edit_thresholds',
  ],
  manager: [
    'view_overview', 'view_sld', 'view_relays', 'view_meters', 'view_trends',
    'view_reports', 'ack_alarm', 'config_trends', 'config_reports', 'view_diagnostics',
    'edit_relay_settings', 'edit_thresholds', 'breaker_control', 'trip_reset',
    'fault_injection', 'view_audit',
  ],
  admin: [
    'view_overview', 'view_sld', 'view_relays', 'view_meters', 'view_trends',
    'view_reports', 'ack_alarm', 'config_trends', 'config_reports', 'view_diagnostics',
    'edit_relay_settings', 'edit_thresholds', 'breaker_control', 'trip_reset',
    'fault_injection', 'user_admin', 'view_audit',
  ],
}

export function hasPermission(role: Role, perm: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(perm)
}

/* ------------------------------ Substations ------------------------------- */

export type SubstationId = 'MRS' | 'RF1' | 'RF2' | 'PR1' | 'PR2'

export interface SubstationSpec {
  id: SubstationId
  name: string
  vcbCount: number
  relayCount: number
  mfmCount: number
  tagTier: number
  activeTags: number
}

/** Tag matrix from the Annexure (§ SCADA tags requirement) */
export const SUBSTATIONS: SubstationSpec[] = [
  { id: 'MRS', name: 'MRS Substation', vcbCount: 47, relayCount: 47, mfmCount: 47, tagTier: 5000, activeTags: 4841 },
  { id: 'RF1', name: 'RF1 Substation', vcbCount: 35, relayCount: 15, mfmCount: 35, tagTier: 3000, activeTags: 2005 },
  { id: 'RF2', name: 'RF2 Substation', vcbCount: 19, relayCount: 9, mfmCount: 19, tagTier: 2000, activeTags: 1157 },
  { id: 'PR1', name: 'PR1 Substation', vcbCount: 16, relayCount: 16, mfmCount: 16, tagTier: 2000, activeTags: 1648 },
  { id: 'PR2', name: 'PR2 Substation', vcbCount: 17, relayCount: 17, mfmCount: 17, tagTier: 2000, activeTags: 1751 },
]

export const TOTAL_VCBS = SUBSTATIONS.reduce((s, x) => s + x.vcbCount, 0) // 134
export const TOTAL_RELAYS = SUBSTATIONS.reduce((s, x) => s + x.relayCount, 0) // 104 (spec hardware: 110)
export const TOTAL_MFMS = SUBSTATIONS.reduce((s, x) => s + x.mfmCount, 0) // 134
export const TOTAL_TAGS = SUBSTATIONS.reduce((s, x) => s + x.activeTags, 0) // 11,402 active of 14,000 tier

/* ------------------------------ Breaker / SLD ----------------------------- */

export type BreakerState = 'closed' | 'open' | 'tripped'
export type FeederKind = 'incomer' | 'buscoupler' | 'feeder'
export type FeederVoltage = 'ht' | 'lt'

export interface Breaker {
  id: string
  name: string
  substation: SubstationId
  kind: FeederKind
  /** Process bus section this feeder hangs from (Bus-A / Bus-B) */
  bus: 'A' | 'B'
  voltage: FeederVoltage
  state: BreakerState
  /** Modbus RTU slave id on the RS485 multi-drop (1–247) */
  slaveId: number
  /** Service / Test trolley position (draw-out VCB) */
  inService: boolean
  springCharged: boolean
  remoteLocal: 'remote' | 'local'
  /** Software interlocks */
  tripLatch: boolean
  earthFaultLatch: boolean
  /** Communication health of the gateway serving this bay */
  commOk: boolean
  lastUpdate: number
}

/* ------------------------------ Relay model ------------------------------- */

export type IDMTCurve = 'normal-inverse' | 'very-inverse' | 'extremely-inverse' | 'definite-time'

export const CURVE_LABEL: Record<IDMTCurve, string> = {
  'normal-inverse': 'Normal Inverse (IEC SI)',
  'very-inverse': 'Very Inverse (IEC VI)',
  'extremely-inverse': 'Extremely Inverse (IEC EI)',
  'definite-time': 'Definite Time (DT)',
}

export interface RelaySettings {
  curve: IDMTCurve
  tms: number // 0.01 – 1.60
  pickupA: number // primary amps
  earthPickupA: number
  instPickupA: number // instantaneous high-set
}

export interface RelayLive {
  ir: number
  iy: number
  ib: number
  iN: number
  cbctLeakage: number // mA through CBCT
  tripCoilHealthy: boolean
  ledFault: [boolean, boolean, boolean, boolean]
}

export interface Relay extends RelaySettings, RelayLive {
  id: string
  name: string
  substation: SubstationId
  breakerId: string
  slaveId: number
  model: string // LK MC61CNX / L&T / Siemens equivalent
  ocTripCount: number
  efTripCount: number
  lastTripAt: number | null
}

/* -------------------------------- MFM model ------------------------------- */

export interface MfmReading {
  // Line voltages
  vRY: number
  vYB: number
  vBR: number
  // Phase voltages
  vR: number
  vY: number
  vB: number
  // Currents
  iR: number
  iY: number
  iB: number
  iN: number
  // Power
  kW: number
  kVAR: number
  kVA: number
  pf: number
  /** Per-phase power factor (Annexure MFM spec: phase PF R, Y, B) */
  pfR: number
  pfY: number
  pfB: number
  freq: number
  // Power quality
  thdV: number
  thdI: number
  // Energy registers (cumulative)
  kWhImport: number
  kWhExport: number
  kVAh: number
  // Harmonics spectrum (H2..H7, % of fundamental) for bar view
  harmonics: number[]
}

export interface Mfm extends MfmReading {
  id: string
  name: string
  substation: SubstationId
  breakerId: string
  slaveId: number
  model: string // LK WL5010 / equivalent, Class 0.5
  ctRatio: number
  online: boolean
}

/* -------------------------------- Gateway --------------------------------- */

export type GatewayState = 'online' | 'degraded' | 'offline'

export interface Gateway {
  substation: SubstationId
  /** Raspberry Pi edge gateway — RS485 → USB (Modbus RTU) + ETH (Modbus TCP) */
  piModel: string
  state: GatewayState
  latencyMs: number
  packetLossPct: number
  pollsPerSec: number
  registersPerPoll: number
  uptimePct: number
  lastHeartbeat: number
  baud: number // 9600, 8-N-1
}

/* --------------------------------- Alarms --------------------------------- */

export type AlarmClass =
  | 'overvoltage' | 'undervoltage' | 'overcurrent' | 'earthfault'
  | 'freq-drift' | 'trip' | 'comm-fail' | 'breaker-op' | 'info'

export type AlarmSeverity = 'critical' | 'major' | 'warning' | 'info'

export interface Alarm {
  id: string
  ts: number
  substation: SubstationId
  source: string
  cls: AlarmClass
  severity: AlarmSeverity
  message: string
  value?: number
  limit?: number
  acknowledged: boolean
  ackBy?: string
  ackAt?: number
  active: boolean
}

/* --------------------------------- Audit ---------------------------------- */

export interface AuditEntry {
  id: string
  ts: number
  user: string
  role: Role
  action: string
  target: string
  detail: string
  /** SBO second-person verification recorded for two-man rule compliance */
  verifiedBy?: string
}

/* --------------------------------- Trends --------------------------------- */

export interface TrendPoint {
  t: number
  ir?: number
  iy?: number
  ib?: number
  iN?: number
  vRY?: number
  vYB?: number
  vBR?: number
  kw?: number
  pf?: number
  hz?: number
}

export interface TrendSeriesKey {
  key: keyof TrendPoint
  label: string
  color: string
  unit: string
}

export const TREND_SERIES: TrendSeriesKey[] = [
  { key: 'ir', label: 'I_R', color: '#F87171', unit: 'A' },
  { key: 'iy', label: 'I_Y', color: '#FBBF24', unit: 'A' },
  { key: 'ib', label: 'I_B', color: '#60A5FA', unit: 'A' },
  { key: 'iN', label: 'I_N', color: '#A78BFA', unit: 'A' },
  { key: 'vRY', label: 'V_RY', color: '#4ADE80', unit: 'V' },
  { key: 'vYB', label: 'V_YB', color: '#34D399', unit: 'V' },
  { key: 'vBR', label: 'V_BR', color: '#22D3EE', unit: 'V' },
  { key: 'kw', label: 'kW', color: '#F472B6', unit: 'kW' },
  { key: 'pf', label: 'PF', color: '#FCA5A5', unit: '' },
  { key: 'hz', label: 'Hz', color: '#E879F9', unit: 'Hz' },
]

/* ------------------------------ Control/SBO ------------------------------- */

export type SwitchCommand = 'trip' | 'close' | 'trip-reset'

export interface SboSession {
  breakerId: string
  command: SwitchCommand
  purpose: string
  step: 'purpose' | 'confirm' | 'pin'
}

export interface InterlockResult {
  allowed: boolean
  reason?: string
}
