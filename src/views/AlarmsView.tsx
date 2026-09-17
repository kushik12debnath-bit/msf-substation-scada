import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { BellOff, CheckCheck, Download } from 'lucide-react'
import { Badge, Led, Panel, fmtMs } from '../components/ui'
import { Alarm, AlarmClass, SubstationId, SUBSTATIONS } from '../types'
import { telemetryEngine, useStore } from '../store/useStore'
import { download } from './RelaysView'

const CLASS_LABEL: Record<AlarmClass, string> = {
  overvoltage: 'Overvoltage', undervoltage: 'Undervoltage', overcurrent: 'Overcurrent',
  earthfault: 'Earth Fault', 'freq-drift': 'Frequency Drift', trip: 'Trip',
  'comm-fail': 'Comm Fail', 'breaker-op': 'Switching', info: 'Info',
}

const SEV_TONE: Record<Alarm['severity'], 'red' | 'amber' | 'cyan' | 'slate'> = {
  critical: 'red', major: 'amber', warning: 'cyan', info: 'slate',
}

export default function AlarmsView() {
  const snap = useStore((s) => s.snap)
  const user = useStore((s) => s.user)
  const can = useStore((s) => s.can)
  const [filter, setFilter] = useState<'active' | 'all' | 'unack'>('active')
  const [ss, setSs] = useState<SubstationId | 'ALL'>('ALL')
  const [cls, setCls] = useState<AlarmClass | 'ALL'>('ALL')

  const alarms = snap?.alarms ?? []
  const filtered = useMemo(
    () => alarms.filter((a) =>
      (filter === 'active' ? a.active : filter === 'unack' ? a.active && !a.acknowledged : true) &&
      (ss === 'ALL' || a.substation === ss) &&
      (cls === 'ALL' || a.cls === cls)),
    [alarms, filter, ss, cls],
  )

  const stats = useMemo(() => {
    const act = alarms.filter((a) => a.active)
    return {
      active: act.length,
      unack: act.filter((a) => !a.acknowledged).length,
      crit: act.filter((a) => a.severity === 'critical' && !a.acknowledged).length,
    }
  }, [alarms])

  if (!snap) return null

  return (
    <div className="h-full flex flex-col gap-3 p-3 min-h-0">
      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-3 max-w-md">
        <div className="panel px-3 py-2"><div className="num text-xl text-slate-100">{stats.active}</div><div className="text-[9px] uppercase tracking-widest text-slate-500">active alarms</div></div>
        <div className="panel px-3 py-2"><div className="num text-xl text-volt-amber">{stats.unack}</div><div className="text-[9px] uppercase tracking-widest text-slate-500">un-acknowledged</div></div>
        <div className="panel px-3 py-2"><div className="num text-xl text-volt-red">{stats.crit}</div><div className="text-[9px] uppercase tracking-widest text-slate-500">critical</div></div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 panel p-1 text-xs">
          {(['active', 'unack', 'all'] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={clsx('px-2.5 py-1 rounded', filter === f ? 'bg-cyan-500/15 text-volt-cyan' : 'text-slate-400')}>
              {f === 'unack' ? 'un-acked' : f}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 panel p-1 text-xs">
          <button onClick={() => setSs('ALL')} className={clsx('px-2 py-1 rounded', ss === 'ALL' ? 'bg-cyan-500/15 text-volt-cyan' : 'text-slate-400')}>ALL</button>
          {SUBSTATIONS.map((s) => (
            <button key={s.id} onClick={() => setSs(s.id)} className={clsx('px-2 py-1 rounded', ss === s.id ? 'bg-cyan-500/15 text-volt-cyan' : 'text-slate-400')}>{s.id}</button>
          ))}
        </div>
        <select value={cls} onChange={(e) => setCls(e.target.value as AlarmClass | 'ALL')} className="bg-ink-900 border border-ink-500 rounded px-2 py-1.5 text-xs">
          <option value="ALL">All classes</option>
          {Object.entries(CLASS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>

        <div className="ml-auto flex items-center gap-2">
          <button
            disabled={!can('ack_alarm') || stats.unack === 0}
            onClick={() => telemetryEngine.ackAll(user.displayName)}
            className="btn-primary flex items-center gap-1 disabled:opacity-30"
            title={can('ack_alarm') ? 'Acknowledge all filtered alarms' : 'Operators and above may acknowledge'}
          ><CheckCheck size={13} /> ACK all ({stats.unack})</button>
          <button
            onClick={() => download('annunciator.csv', [
              'timestamp,substation,source,class,severity,message,ack,ack_by',
              ...filtered.map((a) => [new Date(a.ts).toISOString(), a.substation, a.source, a.cls, a.severity, `"${a.message}"`, a.acknowledged ? 'YES' : 'NO', a.ackBy ?? ''].join(',')),
            ].join('\n'))}
            className="btn-secondary flex items-center gap-1"
          ><Download size={12} /> CSV</button>
        </div>
      </div>

      {/* Table */}
      <Panel title={`Alarm Annunciator — ${filtered.length} records`} className="flex-1 min-h-0">
        <div className="h-full overflow-auto">
          <table className="w-full text-[11px]">
            <thead className="text-[9px] uppercase tracking-widest text-slate-500 border-b border-ink-700 sticky top-0 bg-ink-850">
              <tr>
                <th className="text-left px-2 py-1.5">Time (ms)</th>
                <th className="text-left px-2 py-1.5">SS</th>
                <th className="text-left px-2 py-1.5">Source</th>
                <th className="text-left px-2 py-1.5">Class</th>
                <th className="text-left px-2 py-1.5">Severity</th>
                <th className="text-left px-2 py-1.5">Message</th>
                <th className="text-left px-2 py-1.5">State</th>
                <th className="text-left px-2 py-1.5">Ack</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 300).map((a) => (
                <tr key={a.id} className={clsx('border-b border-ink-800/70 hover:bg-ink-800/40',
                  a.active && !a.acknowledged && a.severity === 'critical' && 'bg-red-950/30')}>
                  <td className="px-2 py-1.5 num text-slate-400 whitespace-nowrap">{fmtMs(a.ts)}</td>
                  <td className="px-2 py-1.5 num text-slate-300">{a.substation}</td>
                  <td className="px-2 py-1.5 num text-slate-300">{a.source}</td>
                  <td className="px-2 py-1.5 text-slate-400">{CLASS_LABEL[a.cls]}</td>
                  <td className="px-2 py-1.5"><Badge tone={SEV_TONE[a.severity]}>{a.severity}</Badge></td>
                  <td className="px-2 py-1.5 text-slate-200">{a.message}</td>
                  <td className="px-2 py-1.5">
                    <span className="flex items-center gap-1.5">
                      <Led color={a.active ? (a.acknowledged ? 'amber' : 'red') : 'gray'} size={7} flash={a.active && !a.acknowledged} />
                      <span className={clsx('text-[10px]', a.active ? (a.acknowledged ? 'text-volt-amber' : 'text-volt-red') : 'text-slate-600')}>
                        {a.active ? (a.acknowledged ? 'ACKED' : 'ACTIVE') : 'RESET'}
                      </span>
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    {a.acknowledged ? (
                      <span className="text-[10px] text-slate-500">{a.ackBy} · {fmtMs(a.ackAt!)}</span>
                    ) : (
                      <button
                        disabled={!can('ack_alarm')}
                        onClick={() => telemetryEngine.ackAlarm(a.id, user.displayName)}
                        className="btn-secondary px-2 py-0.5 text-[10px] disabled:opacity-25 flex items-center gap-1"
                        title={can('ack_alarm') ? 'Acknowledge' : 'Guest cannot acknowledge'}
                      ><BellOff size={10} /> ack</button>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="text-center py-10 text-slate-500 text-xs">No alarms matching filter — plant is healthy ✓</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <p className="text-[10px] text-slate-600">
        Annunciator workflow per Annexure: threshold breach → flash/un-ack → operator acknowledgment (Operator role and above) → auto-reset when condition clears. Every acknowledgment is written to the audit trail.
      </p>
    </div>
  )
}
