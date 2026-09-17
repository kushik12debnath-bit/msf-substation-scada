import { useEffect, useState } from 'react'
import { KeyRound, LogIn, ShieldCheck, User as UserIcon } from 'lucide-react'
import { clsx } from 'clsx'
import { Badge, Led } from '../components/ui'
import { DEMO_ACCOUNTS, authenticate, saveSession } from '../services/authService'
import { telemetryEngine, useStore } from '../store/useStore'
import { ROLE_LABEL, SUBSTATIONS } from '../types'

/* ============================================================================
 * Login screen — control-room style sign-in with demo accounts.
 * One-click role cards speed up the presentation; passwords are demo-grade.
 * ==========================================================================*/

export default function LoginView() {
  const login = useStore((s) => s.login)
  const snap = useStore((s) => s.snap)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [clock, setClock] = useState(new Date())

  useEffect(() => {
    const t = window.setInterval(() => setClock(new Date()), 1000)
    return () => window.clearInterval(t)
  }, [])

  const doLogin = (u: string, p: string) => {
    const res = authenticate(u, p)
    if (!res.ok || !res.user) { setError(res.error ?? 'Authentication failed'); return }
    saveSession(res.user)
    telemetryEngine.setSession(res.user.displayName, res.user.role)
    login(res.user)
  }

  return (
    <div className="h-full flex items-center justify-center p-4 bg-ink-900 relative overflow-hidden">
      {/* ambient grid + scanline */}
      <div className="absolute inset-0 sld-grid opacity-60" />
      <div className="absolute left-0 right-0 h-24 bg-gradient-to-b from-transparent via-cyan-500/5 to-transparent animate-scan pointer-events-none" />

      <div className="relative w-full max-w-4xl grid md:grid-cols-2 gap-0 panel border-ink-500 shadow-2xl overflow-hidden">
        {/* Left: brand + live plant strip */}
        <div className="bg-ink-850/60 border-b md:border-b-0 md:border-r border-ink-600 p-7 flex flex-col">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded bg-gradient-to-br from-cyan-500/30 to-cyan-500/5 border border-cyan-500/40 flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M13 2 4.5 13.5h5.5L9 22l8.5-11.5h-5.5L13 2Z" fill="#22D3EE" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-100 leading-tight">MSF <span className="text-volt-cyan">SCADA</span></h1>
              <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Substation EMS · IEC 617-2-8</p>
            </div>
          </div>

          <p className="text-xs text-slate-400 mt-5 leading-relaxed">
            Sign in to the control room console. Authority is granted strictly per the
            RBAC matrix — breaker Trip/Close (SBO + PIN) is exclusive to <b className="text-amber-300">Manager</b> and
            <b className="text-amber-300"> Admin</b>.
          </p>

          {/* live plant strip */}
          <div className="mt-auto pt-6 space-y-2">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-slate-500">
              <span className="flex items-center gap-1"><Led color="green" size={6} /> mock telemetry engine live</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {snap ? (
                <>
                  <div className="panel py-1.5"><div className="num text-sm text-volt-cyan">{useStore.getState().kpis.mw.toFixed(1)}</div><div className="text-[8px] text-slate-500">MW</div></div>
                  <div className="panel py-1.5"><div className="num text-sm text-volt-green">{snap.gateways.filter((g) => g.state === 'online').length}/5</div><div className="text-[8px] text-slate-500">GWY</div></div>
                  <div className="panel py-1.5"><div className="num text-sm text-volt-amber">{snap.alarms.filter((a) => a.active && !a.acknowledged).length}</div><div className="text-[8px] text-slate-500">ALM</div></div>
              </>
              ) : (
                <div className="col-span-3 text-[10px] text-slate-600">connecting to telemetry…</div>
              )}
            </div>
            <div className="flex gap-1.5 flex-wrap pt-1">
              {SUBSTATIONS.map((s) => {
                const g = snap?.gateways.find((x) => x.substation === s.id)
                return (
                  <span key={s.id} className="flex items-center gap-1 text-[9px] text-slate-500 border border-ink-700 rounded px-1.5 py-0.5">
                    <Led color={g?.state === 'online' ? 'green' : g?.state === 'degraded' ? 'amber' : 'red'} size={5} />
                    {s.id}
                  </span>
                )
              })}
            </div>
          </div>
        </div>

        {/* Right: credentials */}
        <div className="p-7 flex flex-col gap-4">
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2"><ShieldCheck size={15} className="text-volt-cyan" /> Operator Sign-In</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">{clock.toLocaleTimeString('en-IN', { hour12: false })} · {clock.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'short' })}</p>
          </div>

          <form
            className="space-y-3"
            onSubmit={(e) => { e.preventDefault(); doLogin(username, password) }}
          >
            <label className="block">
              <span className="text-[10px] uppercase tracking-widest text-slate-500">Username</span>
              <div className="flex items-center gap-2 border border-ink-500 rounded bg-ink-900 px-3 mt-1 focus-within:border-volt-cyan">
                <UserIcon size={14} className="text-slate-500" />
                <input
                  autoFocus
                  value={username}
                  onChange={(e) => { setUsername(e.target.value); setError(null) }}
                  placeholder="e.g. operator1"
                  className="w-full bg-transparent py-2.5 text-sm outline-none placeholder:text-slate-600"
                />
              </div>
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-widest text-slate-500">Password</span>
              <div className="flex items-center gap-2 border border-ink-500 rounded bg-ink-900 px-3 mt-1 focus-within:border-volt-cyan">
                <KeyRound size={14} className="text-slate-500" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(null) }}
                  placeholder="••••••"
                  className="w-full bg-transparent py-2.5 text-sm outline-none placeholder:text-slate-600"
                />
              </div>
            </label>

            {error && (
              <div className="text-[11px] text-red-300 border border-red-500/40 bg-red-500/10 rounded px-3 py-2">{error}</div>
            )}

            <button type="submit" className="btn-primary w-full py-2.5 flex items-center justify-center gap-2 text-sm">
              <LogIn size={15} /> Sign in
            </button>
          </form>

          <div className="relative text-center">
            <span className="text-[9px] uppercase tracking-widest text-slate-600 bg-ink-900 px-2 -top-1.5 relative">demo accounts — click to fill</span>
          </div>
          <div className="grid gap-1.5 -mt-3">
            {DEMO_ACCOUNTS.map((a) => (
              <button
                key={a.username}
                onClick={() => { setUsername(a.username); setPassword(a.password); setError(null) }}
                className="w-full text-left border border-ink-700 hover:border-volt-cyan/60 rounded px-3 py-1.5 flex items-center gap-2 group"
              >
                <Led color={a.role === 'admin' ? 'red' : a.role === 'manager' ? 'amber' : a.role === 'guest' ? 'gray' : 'cyan'} size={7} />
                <span className="text-[11px] num text-slate-200 w-24">{a.username}</span>
                <span className="text-[10px] text-slate-500 flex-1 truncate">{a.title}</span>
                <Badge tone="slate" className="opacity-70 group-hover:opacity-100">{ROLE_LABEL[a.role]}</Badge>
              </button>
            ))}
          </div>
          <p className="text-[10px] text-slate-600">
            Passwords match the username (demo build). Sessions persist across refresh;
            use <b>Sign out</b> in the header to switch accounts.
          </p>
        </div>
      </div>
    </div>
  )
}
