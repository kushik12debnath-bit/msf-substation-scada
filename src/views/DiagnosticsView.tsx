import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { Activity, Cpu, Radio, ShieldCheck, Syringe, Users } from 'lucide-react'
import { Badge, Led, Panel, fmt, fmtMs } from '../components/ui'
import { Role, SUBSTATIONS } from '../types'
import { telemetryEngine, useStore } from '../store/useStore'

/* ============================================================================
 * System Diagnostics — Challenge 1 & 4 surfaces:
 *  - Gateway heartbeat / packet loss / latency (Challenge 4)
 *  - Modbus block-register map (Challenge 1: block reads, not per-tag polls)
 * ==========================================================================*/

export default function DiagnosticsView() {
  const snap = useStore((s) => s.snap)
  const user = useStore((s) => s.user)
  const canInject = useStore((s) => s.can('fault_injection'))
  const canUsers = useStore((s) => s.can('user_admin'))
  const canAudit = useStore((s) => s.can('view_audit'))
  const tab = useStore((s) => s.diagTab)
  const setTab = useStore((s) => s.setDiagTab)
  const [injSs, setInjSs] = useState('MRS')
  const [injResult, setInjResult] = useState<string | null>(null)

  const injFeeders = useMemo(
    () =>
      snap?.breakers.filter(
        (b) => b.substation === injSs && b.kind === 'feeder' && snap.relays.some((r) => r.breakerId === b.id),
      ) ?? [],
    [snap, injSs],
  )

  if (!snap) return null

  const tabs = [
    { id: 'gateways' as const, label: 'Gateway Health', icon: Radio, show: true },
    { id: 'modbus' as const, label: 'Modbus Register Map', icon: Cpu, show: true },
    { id: 'injection' as const, label: 'Fault Injection Lab', icon: Syringe, show: canInject },
    { id: 'audit' as const, label: 'System Audit Log', icon: ShieldCheck, show: canAudit },
    { id: 'users' as const, label: 'User Administration', icon: Users, show: canUsers },
  ].filter((t) => t.show)

  return (
    <div className="h-full flex flex-col gap-3 p-3 min-h-0">
      <div className="flex items-center gap-1 panel p-1 text-xs w-fit">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded', tab === t.id ? 'bg-cyan-500/15 text-volt-cyan' : 'text-slate-400')}>
            <t.icon size={12} /> {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {tab === 'gateways' && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {snap.gateways.map((g) => {
                const spec = SUBSTATIONS.find((s) => s.id === g.substation)!
                return (
                  <Panel
                    key={g.substation}
                    title={`Gateway ${g.substation} — marshalling panel`}
                    right={<Badge tone={g.state === 'online' ? 'green' : g.state === 'degraded' ? 'amber' : 'red'}>{g.state.toUpperCase()}</Badge>}
                  >
                    <div className="space-y-1.5 text-[11px]">
                      <div className="flex items-center gap-2 text-slate-400">
                        <Cpu size={12} className="text-volt-cyan" /> {g.piModel}
                      </div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                        <span className="text-slate-500">Heartbeat</span><span className="num text-right text-slate-200">{fmtMs(g.lastHeartbeat)}</span>
                        <span className="text-slate-500">Latency</span>
                        <span className={clsx('num text-right', g.latencyMs > 120 ? 'text-volt-amber' : 'text-volt-green')}>{fmt(g.latencyMs, 0)} ms</span>
                        <span className="text-slate-500">Packet loss</span>
                        <span className={clsx('num text-right', g.packetLossPct > 3 ? 'text-volt-amber' : 'text-slate-200')}>{g.packetLossPct.toFixed(1)} %</span>
                        <span className="text-slate-500">Poll rate</span><span className="num text-right text-slate-200">{g.pollsPerSec}/s</span>
                        <span className="text-slate-500">Block read</span><span className="num text-right text-slate-200">{g.registersPerPoll} reg</span>
                        <span className="text-slate-500">Serial</span><span className="num text-right text-slate-200">RS485 · {g.baud} · 8-N-1</span>
                        <span className="text-slate-500">Uptime 30d</span><span className="num text-right text-slate-200">{g.uptimePct.toFixed(2)} %</span>
                        <span className="text-slate-500">Devices</span><span className="num text-right text-slate-200">{spec.vcbCount + spec.relayCount + spec.mfmCount} IEDs</span>
                      </div>
                      {/* heartbeat sparkline strip */}
                      <div className="flex items-end gap-[2px] h-8 pt-1">
                        {Array.from({ length: 40 }).map((_, i) => {
                          const h = 20 + Math.random() * 80
                          const bad = g.state !== 'online' && i > 30
                          return <div key={i} className={clsx('flex-1 rounded-sm', bad ? 'bg-volt-amber/70' : 'bg-cyan-500/50')} style={{ height: `${bad ? Math.random() * 40 : h}%` }} />
                        })}
                      </div>
                      {/* marshalling box contents per Annexure BOM */}
                      <div className="border-t border-ink-700 pt-1.5 text-[10px] text-slate-500">
                        <b className="text-slate-400">Marshalling box (IP54, RAL7032):</b> RS485→Ethernet converter · 12-port Ethernet switch · feeder MCBs · UPS backup · relay base units · 12-port LIU + patch cords · CAT6 shielded trunk to server room
                      </div>
                    </div>
                  </Panel>
                )
              })}
            </div>
            <p className="text-[10px] text-slate-600">
              Challenge 4 — heartbeat & packet-loss monitors: on partition, bays transition to amber <b>STALE/COMM_FAIL</b>; last-good values freeze on the SLD until heartbeat restores.
            </p>
          </div>
        )}

        {tab === 'modbus' && (
          <div className="space-y-3">
            <p className="text-[11px] text-slate-400">
              Challenge 1 — RS485 multi-drop mitigation: telemetry is grouped into contiguous holding-register <b>block reads</b>
              (voltage block, current block, power block, status bitmask) — one burst per device per poll cycle, never per-tag polling.
            </p>
            {SUBSTATIONS.map((spec) => {
              const g = snap.gateways.find((x) => x.substation === spec.id)!
              return (
                <Panel key={spec.id} title={`${spec.id} gateway — register block map (${g.registersPerPoll} registers/poll burst)`}>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[10px] num">
                      <thead className="text-slate-500 border-b border-ink-700">
                        <tr><th className="text-left py-1 pr-4">Block (FC03)</th><th className="text-left">Start</th><th className="text-left">Length</th><th className="text-left">Payload</th><th className="text-left">Devices</th></tr>
                      </thead>
                      <tbody className="text-slate-300">
                        {[
                          ['BLK-1 STATUS', '0x0000', 24, 'ON/OFF/TRIP bits, spring, service/test, remote/local bitmask', `${spec.vcbCount} VCBs`],
                          ['BLK-2 VOLTAGE', '0x0030', 48, 'V_RY/V_YB/V_BR, V_R/V_Y/V_B (float32×2 reg each)', `${spec.mfmCount} MFMs`],
                          ['BLK-3 CURRENT', '0x0060', 56, 'I_R/I_Y/I_B/I_N primary amps', `${spec.mfmCount} MFMs`],
                          ['BLK-4 POWER', '0x00A0', 64, 'kW, kVAr, kVA, PF, Hz + THD_V/THD_I', `${spec.mfmCount} MFMs`],
                          ['BLK-5 ENERGY', '0x0100', 80, 'kWh imp/exp, kVAh cumulative', `${spec.mfmCount} MFMs`],
                          ['BLK-6 RELAY', '0x0200', 72, 'OC/EF element status, trip counters, LED bits, CBCT mA', `${spec.relayCount} relays`],
                        ].map(([name, start, len, payload, devs]) => (
                          <tr key={name as string} className="border-b border-ink-800/60 hover:bg-ink-800/40">
                            <td className="py-1.5 pr-4 text-volt-cyan">{name}</td>
                            <td>{start}</td><td>{len} reg</td>
                            <td className="text-slate-400 font-display">{payload}</td>
                            <td>{devs}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              )
            })}
          </div>
        )}

        {tab === 'injection' && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            <Panel title="Fault Injection Lab — Admin/Manager only" right={<Badge tone="violet">DEVELOPER TRIGGER</Badge>}>
              <div className="space-y-3 text-xs">
                <p className="text-slate-400">
                  Select a substation and feeder, then inject an instantaneous Overcurrent or Earth-Fault to test the
                  end-to-end protection workflow: relay pickup → IDMT timer → breaker trip → annunciator → SBO trip-reset → restore.
                </p>
                <div className="flex items-center gap-1 panel p-1">
                  {SUBSTATIONS.map((s) => (
                    <button key={s.id} onClick={() => setInjSs(s.id)}
                      className={clsx('px-2.5 py-1 rounded', injSs === s.id ? 'bg-violet-500/15 text-violet-300' : 'text-slate-400')}>{s.id}</button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2 max-h-56 overflow-auto">
                  {injFeeders.map((b) => (
                    <div key={b.id} className="flex items-center gap-1.5 bg-ink-800/60 rounded px-2 py-1.5">
                      <span className="num text-slate-200 flex-1 truncate">{b.name}</span>
                      <button
                        disabled={b.state !== 'closed'}
                        onClick={() => setInjResult(telemetryEngine.injectFault(b.id, 'oc', 3.4, user.displayName).reason ?? 'injected')}
                        className="btn-danger px-1.5 py-0.5 text-[9px] disabled:opacity-25"
                      >OC</button>
                      <button
                        disabled={b.state !== 'closed'}
                        onClick={() => setInjResult(telemetryEngine.injectFault(b.id, 'ef', 0, user.displayName).reason ?? 'injected')}
                        className="btn-secondary px-1.5 py-0.5 text-[9px] text-violet-300 disabled:opacity-25"
                      >EF</button>
                    </div>
                  ))}
                </div>
                {injResult && (
                  <div className="border border-violet-500/40 bg-violet-500/10 rounded p-2 text-violet-200 text-[11px]">
                    {injResult} — watch the annunciator & SLD. Close the feeder via SBO after the trip to restore.
                  </div>
                )}
              </div>
            </Panel>
            <Panel title="Injection Guidance">
              <ol className="text-[11px] text-slate-400 list-decimal pl-4 space-y-1.5">
                <li>Pick an energized feeder (breaker CLOSED, gateway online).</li>
                <li><b>OC</b> — injects 3.4× pickup; the IDMT curve computes the operate time and the relay trips, breaker latches.</li>
                <li><b>EF</b> — injects CBCT earth-fault; trip + earth-fault latch engages (Close interlocked until reset).</li>
                <li>Open <b>Single Line Diagram</b> — the bay turns amber-flashing; bus may de-energize if an incomer tripped.</li>
                <li>Sign in as <b>Manager/Admin</b> → bay inspector → <b>TRIP RESET</b> (SBO + PIN 1234) → <b>CLOSE</b>.</li>
                <li>Every step lands in the audit trail with user, role and purpose.</li>
              </ol>
            </Panel>
          </div>
        )}

        {tab === 'audit' && (
          <Panel title={`System Audit Log — ${snap.audit.length} entries (Admin/Manager)`}>
            <div className="overflow-auto max-h-[calc(100vh-230px)]">
              <table className="w-full text-[11px]">
                <thead className="text-[9px] uppercase tracking-widest text-slate-500 border-b border-ink-700 sticky top-0 bg-ink-850">
                  <tr><th className="text-left px-2 py-1.5">Time</th><th className="text-left">User</th><th className="text-left">Role</th><th className="text-left">Action</th><th className="text-left">Target</th><th className="text-left">Detail</th></tr>
                </thead>
                <tbody>
                  {snap.audit.map((a) => (
                    <tr key={a.id} className="border-b border-ink-800/60 hover:bg-ink-800/40">
                      <td className="px-2 py-1.5 num text-slate-400">{fmtMs(a.ts)}</td>
                      <td className="text-slate-200">{a.user}</td>
                      <td><Badge tone="slate">{a.role}</Badge></td>
                      <td className={clsx('num', a.action.includes('REJECT') || a.action.includes('BLOCK') ? 'text-volt-red' : a.action.includes('TRIP') ? 'text-volt-amber' : 'text-volt-cyan')}>{a.action}</td>
                      <td className="num text-slate-300">{a.target}</td>
                      <td className="text-slate-400">{a.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}

        {tab === 'users' && (
          <Panel title="User Administration (Annexure: rename/add/modify users)">
            <div className="space-y-1.5 text-[11px] max-w-2xl">
              {(['guest', 'operator', 'supervisor', 'engineer', 'manager', 'admin'] as Role[]).map((r) => (
                <div key={r} className="flex items-center gap-2 bg-ink-800/50 rounded px-2 py-1.5">
                  <Led color={r === 'admin' ? 'red' : r === 'manager' ? 'amber' : 'cyan'} size={7} />
                  <span className="text-slate-200 w-24 capitalize">{r}</span>
                  <span className="text-slate-500 flex-1">{permissionSummary(r)}</span>
                  <Led color="gray" size={7} title="authority is fixed per named sign-in" />
                </div>
              ))}
              <p className="text-[10px] text-slate-600 pt-1">
                Authority is bound to the <b className="text-slate-400">named account at sign-in</b> and cannot be switched from within a session.
                To operate under a different authority, sign out and sign in with the respective account — every privilege change is
                recorded in the audit trail. Breaker control stays exclusive to Manager/Admin per the authority matrix.
              </p>
            </div>
          </Panel>
        )}
      </div>
    </div>
  )
}

function permissionSummary(r: Role): string {
  switch (r) {
    case 'guest': return 'Executive overview only · controls hidden'
    case 'operator': return 'All screens · alarm acknowledgment · no control'
    case 'supervisor': return '+ trend config, report scheduling, diagnostics'
    case 'engineer': return '+ relay TMS/curve settings, threshold adjustment'
    case 'manager': return '+ breaker SBO control, trip reset, audit log'
    case 'admin': return '+ user administration (full authority)'
  }
}
