import { useEffect, useMemo, useState } from 'react'
import {
  Activity, AlertTriangle, Bell, CircuitBoard, FileBarChart,
  Gauge, LayoutDashboard, LineChart, LogOut, Radio, Settings2, ShieldAlert, Siren, Waves,
} from 'lucide-react'
import { clsx } from 'clsx'
import { Badge, Led } from './components/ui'
import { ROLE_LABEL, SUBSTATIONS } from './types'
import { telemetryEngine, useStore, ViewId } from './store/useStore'
import { loadSession } from './services/authService'
import DashboardView from './views/DashboardView'
import OverviewView from './views/OverviewView'
import SldView from './views/SldView'
import RelaysView from './views/RelaysView'
import MetersView from './views/MetersView'
import TrendsView from './views/TrendsView'
import AlarmsView from './views/AlarmsView'
import ReportsView from './views/ReportsView'
import DiagnosticsView from './views/DiagnosticsView'
import LoginView from './views/LoginView'
import SboModal from './components/SboModal'

const NAV: { id: ViewId; label: string; icon: typeof Gauge; perm: Parameters<ReturnType<typeof useStore.getState>['can']>[0] }[] = [
  { id: 'dashboard', label: 'SCADA Dashboard', icon: LayoutDashboard, perm: 'view_overview' },
  { id: 'overview', label: 'Executive Overview', icon: Gauge, perm: 'view_overview' },
  { id: 'sld', label: 'Single Line Diagram', icon: CircuitBoard, perm: 'view_sld' },
  { id: 'relays', label: 'Protection Relays', icon: ShieldAlert, perm: 'view_relays' },
  { id: 'meters', label: 'MFM Analytics', icon: Activity, perm: 'view_meters' },
  { id: 'trends', label: 'Trends', icon: LineChart, perm: 'view_trends' },
  { id: 'alarms', label: 'Alarms', icon: Siren, perm: 'view_reports' },
  { id: 'reports', label: 'Reports & Energy', icon: FileBarChart, perm: 'view_reports' },
  { id: 'diagnostics', label: 'Diagnostics', icon: Settings2, perm: 'view_diagnostics' },
]

/* ------------------------------ Header KPIs ------------------------------- */

function HeaderKpis() {
  const kpis = useStore((s) => s.kpis)
  const snap = useStore((s) => s.snap)
  const unack = useMemo(() => (snap ? snap.alarms.filter((a) => a.active && !a.acknowledged).length : 0), [snap])
  const crit = useMemo(() => (snap ? snap.alarms.some((a) => a.active && !a.acknowledged && a.severity === 'critical') : false), [snap])
  return (
    <div className="flex items-center gap-3">
      <div className="hidden lg:flex items-center gap-4 num text-xs">
        <span className="text-slate-500">{(kpis.mw).toFixed(2)} <span className="text-slate-400">MW</span></span>
        <span className="text-slate-600">|</span>
        <span className={clsx('font-semibold', Math.abs(kpis.hz - 50) > 0.15 ? 'text-volt-amber' : 'text-volt-green')}>{kpis.hz.toFixed(2)} Hz</span>
        <span className="text-slate-600">|</span>
        <span className="text-slate-400">PF {kpis.pf.toFixed(3)}</span>
      </div>
      <button
        onClick={() => useStore.getState().setView('alarms')}
        className={clsx('relative p-2 rounded border', crit ? 'border-red-500/60 bg-red-500/10 animate-pulseRing' : 'border-ink-500 bg-ink-800 hover:bg-ink-700')}
        title={`${unack} unacknowledged alarms`}
      >
        <Bell size={15} className={crit ? 'text-volt-red' : 'text-slate-300'} />
        {unack > 0 && (
          <span className="absolute -top-1.5 -right-1.5 bg-volt-red text-ink-900 text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
            {unack > 99 ? '99+' : unack}
          </span>
        )}
      </button>
    </div>
  )
}

/* --------------------------------- Clock ---------------------------------- */

function Clock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(t)
  }, [])
  return (
    <div className="hidden md:block text-right leading-tight">
      <div className="num text-sm text-slate-200">{now.toLocaleTimeString('en-IN', { hour12: false })}</div>
      <div className="text-[10px] text-slate-500">{now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} IST</div>
    </div>
  )
}

/* ------------------------------ Status footer ----------------------------- */

function StatusBar() {
  const snap = useStore((s) => s.snap)
  const kpis = useStore((s) => s.kpis)
  const user = useStore((s) => s.user)
  if (!snap) return null
  const gwyOffline = snap.gateways.filter((g) => g.state === 'offline').length
  const gwyDeg = snap.gateways.filter((g) => g.state === 'degraded').length
  return (
    <footer className="no-print flex items-center gap-4 px-4 h-8 border-t border-ink-600 bg-ink-850 text-[11px] text-slate-500 shrink-0 overflow-x-auto">
      <span className="flex items-center gap-1.5"><Led color={gwyOffline ? 'red' : gwyDeg ? 'amber' : 'green'} size={7} /> Gateways: {snap.gateways.length - gwyOffline - gwyDeg}/{snap.gateways.length} online{gwyDeg ? ` · ${gwyDeg} degraded` : ''}{gwyOffline ? ` · ${gwyOffline} COMM_FAIL` : ''}</span>
      <span className="text-slate-700">|</span>
      <span>Modbus RTU 9600 8-N-1 · block reads {snap.gateways[0]?.registersPerPoll ?? 0} reg/poll</span>
      <span className="text-slate-700">|</span>
      <span>UI dispatch 250 ms batch · engine tick {snap.tick}</span>
      <span className="text-slate-700">|</span>
      <span>VCBs {kpis.closedVcbs} closed / {kpis.trippedVcbs} tripped / {kpis.commOkVcbs} comm-OK</span>
      <span className="text-slate-700">|</span>
      <span className="flex items-center gap-1"><Radio size={11} /> MSF-COMNET: <a href="#" onClick={(e) => e.preventDefault()} className="text-volt-cyan hover:underline">linked</a></span>        <span className="ml-auto flex items-center gap-2">
        <Badge tone="violet">MOCK TELEMETRY ENGINE</Badge>
        <span className="text-slate-400">{user.displayName} · {ROLE_LABEL[user.role]}</span>
      </span>
    </footer>
  )
}

/* --------------------------- Critical alarm banner ------------------------ */

function CriticalBanner() {
  const snap = useStore((s) => s.snap)
  const crit = snap?.alarms.find((a) => a.active && !a.acknowledged && a.severity === 'critical')
  if (!crit) return null
  return (
    <button
      onClick={() => useStore.getState().setView('alarms')}
      className="no-print w-full flex items-center gap-2 px-4 py-1.5 bg-red-950/70 border-b border-red-500/40 text-left"
    >
      <AlertTriangle size={14} className="text-volt-red animate-flash shrink-0" />
      <span className="text-xs text-red-200 truncate">
        <b>CRITICAL</b> · [{crit.substation}] {crit.message}
      </span>
      <span className="ml-auto text-[10px] text-red-300/70 shrink-0">click to open annunciator →</span>
    </button>
  )
}

/* ---------------------------------- App ----------------------------------- */

export default function App() {
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const can = useStore((s) => s.can)
  const snap = useStore((s) => s.snap)
  const openSbo = useStore((s) => s.openSbo)
  const user = useStore((s) => s.user)
  const authed = useStore((s) => s.authed)
  const logout = useStore((s) => s.logout)
  const [subBarOpen, setSubBarOpen] = useState(true)

  // Browser tab title reflects live load
  useEffect(() => {
    document.title = snap ? `MSF SCADA · ${useStore.getState().kpis.mw.toFixed(1)} MW · ${snap.gateways.filter((g) => g.state === 'online').length}/5 GWY` : 'MSF SCADA'
  }, [snap])

  // Keyboard shortcut: Esc closes selection
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') useStore.getState().setSelectedBreakerId(null) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const visibleNav = NAV.filter((n) => can(n.perm))

  // Session restore: a persisted session signs the user back in automatically
  useEffect(() => {
    if (authed) return
    const u = loadSession()
    if (u) useStore.getState().login(u)
  }, [authed])

  // Unauthenticated → login screen
  if (!authed) return <LoginView />

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="no-print flex items-center gap-4 px-4 h-14 border-b border-ink-600 bg-ink-850 shrink-0">
        <button className="flex items-center gap-2.5" onClick={() => setView('overview')}>
          <div className="w-8 h-8 rounded bg-gradient-to-br from-cyan-500/30 to-cyan-500/5 border border-cyan-500/40 flex items-center justify-center">
            <ZapIcon />
          </div>
          <div className="leading-tight text-left">
            <div className="text-sm font-bold tracking-wide text-slate-100">MSF <span className="text-volt-cyan">SCADA</span></div>
            <div className="text-[9px] uppercase tracking-[0.22em] text-slate-500">Substation EMS · IEC 617-2-8</div>
          </div>
        </button>

        <div className="h-6 w-px bg-ink-600 hidden sm:block" />
        <HeaderKpis />

        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={() => setSubBarOpen((o) => !o)}
            className="hidden xl:flex items-center gap-1.5 text-[11px] text-slate-400 border border-ink-500 rounded px-2 py-1.5 hover:bg-ink-800"
            title="Toggle substation quick-jump bar"
          >
            <Waves size={12} /> Substations
          </button>
          <Clock />
          <div className="hidden md:flex items-center gap-2 pl-3 border-l border-ink-600">
            <div className="text-right leading-tight">
              <div className="text-[11px] text-slate-200">{user.displayName}</div>
              <div className="text-[9px] text-slate-500">{ROLE_LABEL[user.role]}</div>
            </div>
            <button
              onClick={logout}
              title="Sign out"
              className="p-2 rounded border border-ink-500 bg-ink-800 hover:bg-ink-700 text-slate-400 hover:text-red-300"
            >
              <LogOut size={13} />
            </button>
          </div>
        </div>
      </header>

      <CriticalBanner />

      {/* Substation quick bar */}
      {subBarOpen && (
        <div className="no-print hidden xl:flex items-center gap-2 px-4 py-1.5 border-b border-ink-700 bg-ink-900/60 text-[11px] shrink-0">
          <span className="text-slate-500 uppercase tracking-widest text-[10px] mr-1">Go to:</span>
          {SUBSTATIONS.map((s) => {
            const g = snap?.gateways.find((x) => x.substation === s.id)
            return (
              <button
                key={s.id}
                onClick={() => { useStore.getState().setSelectedSubstation(s.id); setView('sld') }}
                className="flex items-center gap-1.5 border border-ink-600 rounded px-2 py-1 hover:border-volt-cyan/50 hover:text-slate-200 text-slate-400"
              >
                <Led color={g?.state === 'online' ? 'green' : g?.state === 'degraded' ? 'amber' : 'red'} size={6} flash={g?.state !== 'online'} />
                {s.id}
                <span className="text-slate-600">{s.vcbCount} VCB · {s.activeTags} tags</span>
              </button>
            )
          })}
          <button
            onClick={() => { const s = useStore.getState().snap; if (!s) return; const t = s.breakers.find((b) => b.state === 'tripped'); if (t) { useStore.getState().setSelectedSubstation(t.substation); useStore.getState().setSelectedBreakerId(t.id); setView('sld') } }}
            className="ml-auto text-volt-amber hover:underline"
          >
            ⚡ jump to latest trip
          </button>
          <button onClick={() => openSboDemo()} className="text-volt-cyan hover:underline" title="Fault Injection Simulator — Admin/Manager only">fault injection lab</button>
        </div>
      )}

      {/* Nav tabs */}
      <nav className="no-print flex items-center gap-1 px-3 h-10 border-b border-ink-700 bg-ink-900/80 overflow-x-auto shrink-0">
        {visibleNav.map((n) => (
          <button
            key={n.id}
            onClick={() => setView(n.id)}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-t text-xs whitespace-nowrap border-b-2',
              view === n.id
                ? 'text-volt-cyan border-volt-cyan bg-ink-800/60'
                : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-ink-800/40',
            )}
          >
            <n.icon size={13} /> {n.label}
          </button>
        ))}
        {!can('view_sld') && (
          <span className="ml-auto text-[10px] text-slate-600 pr-2">Guest mode — limited screens (Annexure access-control matrix)</span>
        )}
      </nav>

      {/* Main */}
      <main className="flex-1 min-h-0 overflow-hidden">
        {view === 'dashboard' && <DashboardView />}
        {view === 'overview' && <OverviewView />}
        {view === 'sld' && <SldView />}
        {view === 'relays' && <RelaysView />}
        {view === 'meters' && <MetersView />}
        {view === 'trends' && <TrendsView />}
        {view === 'alarms' && <AlarmsView />}
        {view === 'reports' && <ReportsView />}
        {view === 'diagnostics' && <DiagnosticsView />}
      </main>

      <StatusBar />
      <SboModal />
    </div>
  )
}

function openSboDemo() {
  const st = useStore.getState()
  st.setView('diagnostics')
  st.setDiagTab('injection')
  st.setDiag({ substation: 'MRS', breakerId: 'MRS:F-01' })
}

function ZapIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M13 2 4.5 13.5h5.5L9 22l8.5-11.5h-5.5L13 2Z" fill="#22D3EE" />
    </svg>
  )
}
