import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Lock, ShieldAlert } from 'lucide-react'
import { clsx } from 'clsx'
import { Badge, Modal } from './ui'
import { Breaker, SwitchCommand } from '../types'
import { SBO_DEMO_PIN, telemetryEngine } from '../services/mockTelemetryService'
import { useStore } from '../store/useStore'

const PURPOSES: Record<SwitchCommand, string[]> = {
  trip: ['Planned maintenance isolation', 'Emergency isolation — hazard reported', 'Load shifting / bus transfer', 'Protection test authorization'],
  close: ['Restore supply after maintenance', 'Bus section paralleling', 'Load restoration on operator order', 'Post-test re-energization'],
  'trip-reset': ['Post-trip latch reset before restoration', 'Maintenance completion release'],
}

export default function SboModal() {
  const sbo = useStore((s) => s.sbo)
  const closeSbo = useStore((s) => s.closeSbo)
  const user = useStore((s) => s.user)

  const [step, setStep] = useState<0 | 1 | 2 | 3>(0) // purpose → interlocks → confirm → pin
  const [purpose, setPurpose] = useState('')
  const [pin, setPin] = useState('')
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)

  /* Reset wizard-local state whenever a NEW SBO session opens — otherwise a
   * result screen from a previous command bleeds into the next session. */
  useEffect(() => {
    setStep(0); setPurpose(''); setPin(''); setResult(null)
  }, [sbo?.breakerId, sbo?.command])

  const breaker: Breaker | undefined = useMemo(
    () => (sbo ? telemetryEngine.getSnapshot().breakers.find((b) => b.id === sbo.breakerId) : undefined),
    [sbo, step],
  )

  if (!sbo || !breaker) return null

  const interlock = telemetryEngine.validateInterlocks(breaker, sbo.command)
  const cmdLabel = sbo.command === 'trip' ? 'TRIP (OPEN)' : sbo.command === 'close' ? 'CLOSE' : 'TRIP RESET'

  const reset = () => { setStep(0); setPurpose(''); setPin(''); setResult(null) }
  const finish = (ok: boolean, msg: string) => { setResult({ ok, msg }); setStep(3) }

  const execute = () => {
    if (!purpose) { finish(false, 'Operational purpose is mandatory for audit trail'); return }
    const r = telemetryEngine.executeSbo(sbo, user.displayName, user.role, pin)
    finish(r.allowed, r.allowed
      ? `${cmdLabel} executed on ${breaker.name} — SBO session logged (purpose: ${purpose})`
      : r.reason ?? 'Command rejected')
  }

  return (
    <Modal
      open
      onClose={() => { reset(); closeSbo() }}
      title={
        <span className="flex items-center gap-2">
          <ShieldAlert size={15} className={sbo.command === 'trip' ? 'text-volt-amber' : 'text-volt-cyan'} />
          Select-Before-Operate — {breaker.name}
          <Badge tone={sbo.command === 'close' ? 'green' : sbo.command === 'trip' ? 'amber' : 'cyan'}>{cmdLabel}</Badge>
        </span>
      }
      width="max-w-xl"
    >
      {/* Stepper */}
      <div className="flex items-center gap-1 mb-4 text-[10px] uppercase tracking-widest">
        {['1 Purpose', '2 Interlocks', '3 Confirm', '4 PIN'].map((label, i) => (
          <div key={label} className="flex items-center gap-1 flex-1">
            <span className={clsx('px-2 py-1 rounded border flex-1 text-center',
              step === i ? 'border-volt-cyan text-volt-cyan bg-cyan-500/5' : step > i ? 'border-green-500/40 text-green-400' : 'border-ink-600 text-slate-500')}>
              {label}
            </span>
            {i < 3 && <span className="text-slate-600">›</span>}
          </div>
        ))}
      </div>

      {result ? (
        <div className="space-y-4">
          <div className={clsx('flex items-start gap-2 p-3 rounded border', result.ok ? 'border-green-500/40 bg-green-500/5' : 'border-red-500/40 bg-red-500/5')}>
            {result.ok ? <CheckCircle2 size={18} className="text-volt-green mt-0.5" /> : <AlertTriangle size={18} className="text-volt-red mt-0.5" />}
            <div>
              <p className={clsx('text-sm font-semibold', result.ok ? 'text-green-300' : 'text-red-300')}>{result.ok ? 'Operation executed' : 'Operation rejected'}</p>
              <p className="text-xs text-slate-400 mt-1">{result.msg}</p>
            </div>
          </div>
          <p className="text-[11px] text-slate-500">All SBO attempts — successful or rejected — are written to the system audit trail with operator identity, purpose and verification.</p>
          <button onClick={() => { reset(); closeSbo() }} className="w-full btn-primary">Close</button>
        </div>
      ) : step === 0 ? (
        <div className="space-y-3">
          <p className="text-xs text-slate-400">
            Select the operational purpose for this command (mandatory — two-man verification record).
          </p>
          <div className="grid gap-1.5">
            {PURPOSES[sbo.command].map((p) => (
              <button
                key={p}
                onClick={() => setPurpose(p)}
                className={clsx('text-left text-xs px-3 py-2 rounded border',
                  purpose === p ? 'border-volt-cyan bg-cyan-500/10 text-slate-100' : 'border-ink-600 text-slate-300 hover:border-ink-500')}
              >
                {p}
              </button>
            ))}
          </div>
          <button
            disabled={!purpose}
            onClick={() => setStep(1)}
            className="w-full btn-primary disabled:opacity-40"
          >
            Continue → Interlock validation
          </button>
        </div>
      ) : step === 1 ? (
        <div className="space-y-3">
          <div className={clsx('p-3 rounded border text-xs space-y-1.5', interlock.allowed ? 'border-green-500/40 bg-green-500/5' : 'border-red-500/40 bg-red-500/5')}>
            <p className={clsx('font-semibold text-sm flex items-center gap-1.5', interlock.allowed ? 'text-green-300' : 'text-red-300')}>
              {interlock.allowed ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
              {interlock.allowed ? 'All software interlocks satisfied' : 'Interlock BLOCK — command not permitted'}
            </p>
            {interlock.reason && <p className="text-slate-300">{interlock.reason}</p>}
            <ul className="text-[11px] text-slate-400 list-disc pl-4 space-y-0.5">
              <li>Remote/Local selector: <b className={breaker.remoteLocal === 'remote' ? 'text-green-300' : 'text-amber-300'}>{breaker.remoteLocal.toUpperCase()}</b></li>
              <li>Service/Test position: <b className={breaker.inService ? 'text-green-300' : 'text-amber-300'}>{breaker.inService ? 'SERVICE' : 'TEST'}</b></li>
              <li>Spring charge: <b className={breaker.springCharged ? 'text-green-300' : 'text-red-300'}>{breaker.springCharged ? 'CHARGED' : 'DISCHARGED'}</b></li>
              <li>Trip latch: <b className={breaker.tripLatch ? 'text-red-300' : 'text-green-300'}>{breaker.tripLatch ? 'ACTIVE' : 'clear'}</b></li>
              <li>Earth-fault latch: <b className={breaker.earthFaultLatch ? 'text-red-300' : 'text-green-300'}>{breaker.earthFaultLatch ? 'ACTIVE' : 'clear'}</b></li>
              <li>Gateway: <b className={breaker.commOk ? 'text-green-300' : 'text-red-300'}>{breaker.commOk ? 'ONLINE' : 'COMM_FAIL'}</b></li>
            </ul>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setStep(0)} className="btn-secondary flex-1">← Back</button>
            <button
              disabled={!interlock.allowed}
              onClick={() => setStep(2)}
              className="btn-primary flex-1 disabled:opacity-40"
            >
              Continue → Confirm
            </button>
          </div>
        </div>
      ) : step === 2 ? (
        <div className="space-y-4">
          <div className="p-3 rounded border border-amber-500/40 bg-amber-500/5 text-xs text-amber-200 space-y-1">
            <p className="font-semibold flex items-center gap-1.5"><AlertTriangle size={14} /> Final confirmation</p>
            <p>You are about to issue <b>{cmdLabel}</b> on <b>{breaker.name}</b> ({breaker.substation} SS, slave {breaker.slaveId}).</p>
            <p>Purpose: <b>{purpose}</b></p>
            <p className="text-amber-300/80">Switching operations affect live electrical equipment. Verify the bay is the correct one.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setStep(1)} className="btn-secondary flex-1">← Back</button>
            <button onClick={() => setStep(3)} className="btn-danger flex-1">I confirm — proceed to PIN</button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Lock size={13} className="text-volt-cyan" />
            Secondary authentication — enter the switching PIN (two-man rule)
          </div>
          <input
            autoFocus
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={(e) => { if (e.key === 'Enter' && pin.length >= 4) execute() }}
            placeholder="• • • •"
            className="w-full num text-2xl tracking-[0.5em] text-center bg-ink-900 border border-ink-500 rounded py-3 focus:outline-none focus:border-volt-cyan"
          />
          <p className="text-[11px] text-slate-500 text-center">Demo PIN: <b className="text-volt-amber">{SBO_DEMO_PIN}</b> — wrong PINs are logged as SBO_REJECTED in the audit trail.</p>
          <div className="flex gap-2">
            <button onClick={() => setStep(2)} className="btn-secondary flex-1">← Back</button>
            <button disabled={pin.length < 4} onClick={execute} className="btn-danger flex-1 disabled:opacity-40">
              Execute {cmdLabel}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
