import { Role, User } from '../types'

/* ============================================================================
 * Demo authentication — named accounts for the presentation.
 * This is a front-end simulation (no backend): credentials are public demo
 * constants and switching roles instantly re-evaluates the RBAC matrix.
 * Production deployments would swap authenticate() for a real API/JWT call.
 * ==========================================================================*/

export interface DemoAccount {
  username: string
  password: string
  displayName: string
  role: Role
  title: string
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
  { username: 'guest', password: 'guest', displayName: 'Visitor', role: 'guest', title: 'Guest — executive overview only' },
  { username: 'operator1', password: 'operator1', displayName: 'R. Sharma', role: 'operator', title: 'Operator — monitoring & alarm ack' },
  { username: 'supervisor1', password: 'supervisor1', displayName: 'P. Iyer', role: 'supervisor', title: 'Supervisor — trends, reports, diagnostics' },
  { username: 'engineer1', password: 'engineer1', displayName: 'A. Banerjee', role: 'engineer', title: 'Engineer — relay settings & thresholds' },
  { username: 'manager1', password: 'manager1', displayName: 'S. Krishnan', role: 'manager', title: 'Manager — breaker SBO authority' },
  { username: 'admin', password: 'admin', displayName: 'System Admin', role: 'admin', title: 'Admin — full authority incl. user admin' },
]

export interface AuthResult {
  ok: boolean
  user?: User
  error?: string
}

export function authenticate(username: string, password: string): AuthResult {
  const acc = DEMO_ACCOUNTS.find(
    (a) => a.username.toLowerCase() === username.trim().toLowerCase() && a.password === password,
  )
  if (!acc) return { ok: false, error: 'Invalid username or password — check the demo credentials listed below.' }
  return {
    ok: true,
    user: { username: acc.username, displayName: acc.displayName, role: acc.role },
  }
}

/** Session persistence so refresh keeps the signed-in operator */
const SESSION_KEY = 'msf-scada-session'

export function saveSession(u: User) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(u)) } catch { /* private mode */ }
}

export function loadSession(): User | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const u = JSON.parse(raw) as User
    return u?.username && u?.role ? u : null
  } catch { return null }
}

export function clearSession() {
  try { localStorage.removeItem(SESSION_KEY) } catch { /* noop */ }
}
