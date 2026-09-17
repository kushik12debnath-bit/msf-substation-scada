/* ============================================================================
 * MSF Web SCADA — Global Store (Zustand)
 * Challenge 3 solution: ingestion decoupled from rendering.
 * The engine ticks at 250 ms; the store buffers that into a 250 ms batched
 * dispatch so React re-renders at most 4×/second.
 * ==========================================================================*/

import { create } from 'zustand'
import {
  hasPermission, Permission, Role, ROLE_PERMISSIONS,
  SboSession, SubstationId, User,
} from '../types'
import {
  EngineSnapshot, Kpis, telemetryEngine,
} from '../services/mockTelemetryService'
import { clearSession } from '../services/authService'

export type ViewId =
  | 'dashboard' | 'overview' | 'sld' | 'relays' | 'meters' | 'trends' | 'alarms' | 'reports' | 'diagnostics'

export interface DiagnosticsSelection {
  substation: SubstationId
  breakerId: string
}

export type DiagnosticsTab = 'gateways' | 'modbus' | 'injection' | 'audit' | 'users'

interface AppState {
  /* ------------------------------ auth / RBAC ---------------------------- */
  user: User
  authed: boolean
  login: (u: User) => void
  logout: () => void
  can: (p: Permission) => boolean

  /* ---------------------------- navigation ------------------------------- */
  view: ViewId
  setView: (v: ViewId) => void

  /* ------------------------------- SLD state ----------------------------- */
  selectedSubstation: SubstationId
  setSelectedSubstation: (s: SubstationId) => void
  selectedBreakerId: string | null
  setSelectedBreakerId: (id: string | null) => void
  sbo: SboSession | null
  openSbo: (s: SboSession) => void
  closeSbo: () => void
  sboResult: string | null
  setSboResult: (r: string | null) => void

  /* --------------------------- telemetry stream -------------------------- */
  snap: EngineSnapshot | null
  kpis: Kpis
  lastDispatchAt: number
  dispatchDelayMs: number

  /* --------------------------- diagnostics drill ------------------------- */
  diag: DiagnosticsSelection
  setDiag: (d: DiagnosticsSelection) => void
  diagTab: DiagnosticsTab
  setDiagTab: (t: DiagnosticsTab) => void
}

const GUEST: User = { username: 'guest', displayName: 'Guest', role: 'guest' }

export const useStore = create<AppState>((set, get) => ({
  user: GUEST,
  authed: false,
  login: (u) => {
    telemetryEngine.setSession(u.displayName, u.role)
    set({ user: u, authed: true, view: 'dashboard' })
  },
  logout: () => {
    clearSession()
    telemetryEngine.setSession('Guest', 'guest')
    set({ user: GUEST, authed: false, view: 'dashboard', sbo: null, selectedBreakerId: null })
  },
  /* Authority is bound at sign-in: no in-session role shifting. */
  can: (p) => hasPermission(get().user.role, p),

  view: 'dashboard',
  setView: (v) => set({ view: v }),

  selectedSubstation: 'MRS',
  setSelectedSubstation: (s) => set({ selectedSubstation: s, selectedBreakerId: null }),

  selectedBreakerId: null,
  setSelectedBreakerId: (id) => set({ selectedBreakerId: id }),

  sbo: null,
  openSbo: (s) => set({ sbo: s, sboResult: null }),
  closeSbo: () => set({ sbo: null, sboResult: null }),
  sboResult: null,
  setSboResult: (r) => set({ sboResult: r }),

  snap: null,
  kpis: {
    mw: 0, mva: 0, mvar: 0, pf: 0.97, hz: 50, carbonOffsetTons: 0,
    closedVcbs: 0, trippedVcbs: 0, commOkVcbs: 0,
  },
  lastDispatchAt: 0,
  dispatchDelayMs: 250,

  diag: { substation: 'MRS', breakerId: '' },
  setDiag: (d) => set({ diag: d }),
  diagTab: 'gateways',
  setDiagTab: (t) => set({ diagTab: t }),
}))

/* ---------------------------------------------------------------------------
 * Telemetry → store bridge with a 250 ms batch throttle.
 * The engine itself emits at 250 ms; this guard guarantees that even if the
 * engine rate is raised, the UI still consumes at most one batch per interval.
 * -------------------------------------------------------------------------*/
let lastPaint = 0
const BATCH_MS = 250

export function connectTelemetry() {
  telemetryEngine.start('Operator Console', 'operator')
  telemetryEngine.subscribe((s) => {
    const now = performance.now()
    if (now - lastPaint < BATCH_MS) return
    lastPaint = now
    useStore.setState({ snap: s, kpis: telemetryEngine.getKpis(), lastDispatchAt: Date.now() })
  })
}

/** Direct engine access for actions (SBO, ack, settings, injection…) */
export { telemetryEngine }
