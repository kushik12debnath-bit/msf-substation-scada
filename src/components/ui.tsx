import { ReactNode } from 'react'
import { clsx } from 'clsx'
import { Permission } from '../types'
import { useStore } from '../store/useStore'

/* ------------------------------ formatting -------------------------------- */

export const fmt = (v: number | undefined | null, d = 1): string =>
  v === undefined || v === null || Number.isNaN(v) ? '—' : v.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d })

export const fmtInt = (v: number | undefined | null): string =>
  v === undefined || v === null || Number.isNaN(v) ? '—' : Math.round(v).toLocaleString('en-IN')

export const fmtTime = (ts: number): string =>
  new Date(ts).toLocaleTimeString('en-IN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })

export const fmtMs = (ts: number): string => {
  const d = new Date(ts)
  return `${d.toLocaleTimeString('en-IN', { hour12: false })}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

/* --------------------------------- Panel ---------------------------------- */

export function Panel({ title, right, children, className }: { title?: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx('panel flex flex-col min-w-0', className)}>
      {(title || right) && (
        <header className="flex items-center justify-between gap-2 px-3 py-2 border-b border-ink-600/60">
          <h3 className="panel-title">{title}</h3>
          {right}
        </header>
      )}
      <div className="flex-1 min-h-0 min-w-0 p-3">{children}</div>
    </section>
  )
}

/* ---------------------------------- LED ----------------------------------- */

export type LedColor = 'red' | 'green' | 'amber' | 'cyan' | 'gray'

export function Led({ color, flash = false, size = 10, glow = true, title }: { color: LedColor; flash?: boolean; size?: number; glow?: boolean; title?: string }) {
  const map: Record<LedColor, string> = {
    red: 'bg-volt-red glow-red',
    green: 'bg-volt-green glow-green',
    amber: 'bg-volt-amber glow-amber',
    cyan: 'bg-volt-cyan glow-cyan',
    gray: 'bg-slate-600',
  }
  return (
    <span
      title={title}
      style={{ width: size, height: size }}
      className={clsx('inline-block rounded-full shrink-0', map[color], flash && 'animate-flash')}
    />
  )
}

/* --------------------------------- Badge ---------------------------------- */

export function Badge({ children, tone = 'slate', className }: { children: ReactNode; tone?: 'slate' | 'red' | 'green' | 'amber' | 'cyan' | 'violet'; className?: string }) {
  const map = {
    slate: 'bg-slate-700/40 text-slate-300 border-slate-600/50',
    red: 'bg-red-500/10 text-red-300 border-red-500/40',
    green: 'bg-green-500/10 text-green-300 border-green-500/40',
    amber: 'bg-amber-500/10 text-amber-300 border-amber-500/40',
    cyan: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/40',
    violet: 'bg-violet-500/10 text-violet-300 border-violet-500/40',
  }
  return (
    <span className={clsx('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border', map[tone], className)}>
      {children}
    </span>
  )
}

/* -------------------------------- RoleGate -------------------------------- */

export function RoleGate({ perm, children, fallback }: { perm: Permission; children: ReactNode; fallback?: ReactNode }) {
  const user = useStore((s) => s.user)
  const allowed = useStore((s) => s.can(perm))
  if (allowed) return <>{children}</>
  return fallback ? <>{fallback}</> : (
    <div className="flex items-center gap-2 text-amber-300/90 text-xs border border-amber-500/30 bg-amber-500/5 rounded px-3 py-2">
      <span className="text-sm">🔒</span>
      Action Disabled: Elevated Authority Required
      <span className="text-slate-500">— signed in as {user.role}</span>
    </div>
  )
}

/* --------------------------------- Modal ---------------------------------- */

export function Modal({ open, onClose, title, children, width = 'max-w-lg' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: string }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 no-print" role="dialog" aria-modal>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className={clsx('relative w-full panel border-ink-500 shadow-2xl', width)}>
        <header className="flex items-center justify-between px-4 py-3 border-b border-ink-600">
          <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-100 text-lg leading-none px-1" aria-label="Close">✕</button>
        </header>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}

/* ------------------------------- Stat cards ------------------------------- */

export function Kpi({ label, value, unit, sub, tone = 'cyan' }: { label: string; value: string; unit?: string; sub?: ReactNode; tone?: 'cyan' | 'green' | 'amber' | 'red' | 'violet' }) {
  const map = {
    cyan: 'text-volt-cyan', green: 'text-volt-green', amber: 'text-volt-amber',
    red: 'text-volt-red', violet: 'text-violet-300',
  }
  return (
    <div className="panel px-4 py-3 flex flex-col gap-1 min-w-0">
      <span className="panel-title truncate">{label}</span>
      <span className={clsx('num text-2xl font-semibold leading-none', map[tone])}>
        {value}{unit && <span className="text-xs text-slate-400 ml-1">{unit}</span>}
      </span>
      {sub && <span className="text-[11px] text-slate-500 truncate">{sub}</span>}
    </div>
  )
}

export function Spinner({ label = 'Connecting to telemetry…' }: { label?: string }) {
  return (
    <div className="h-full w-full flex flex-col items-center justify-center gap-3 text-slate-400">
      <div className="w-10 h-10 rounded-full border-2 border-ink-500 border-t-volt-cyan animate-spin" />
      <span className="text-xs tracking-widest uppercase">{label}</span>
    </div>
  )
}
