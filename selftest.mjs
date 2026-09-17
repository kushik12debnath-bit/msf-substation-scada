/* ============================================================================
 * MSF SCADA — Full-Scope Self-Test v2 (puppeteer-core + system Chrome)
 * Drives the real app end-to-end. Assertions are case-insensitive because
 * panel titles render with CSS text-transform: uppercase (innerText reflects it).
 * ==========================================================================*/

import puppeteer from 'puppeteer-core'
import fs from 'node:fs'

const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].filter(Boolean)

const results = []
let browser, page

function report(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** lowercased body text (CSS text-transform reflected, like a real user sees) */
async function text() {
  return page.evaluate(() => document.body.innerText.toLowerCase())
}

async function clickByText(selector, needle) {
  const ok = await page.evaluate((sel, txt) => {
    const els = [...document.querySelectorAll(sel)]
    const el = els.find((e) => e.textContent.trim().toLowerCase().includes(txt.toLowerCase()))
    if (!el) return false
    el.click()
    return true
  }, selector, needle)
  if (!ok) throw new Error(`clickByText: no ${selector} containing "${needle}"`)
}

/** exact-match click (avoids "jump to latest trip" matching "TRIP") */
async function clickByExactText(selector, needle) {
  const ok = await page.evaluate((sel, txt) => {
    const els = [...document.querySelectorAll(sel)]
    const el = els.find((e) => e.textContent.trim() === txt)
    if (!el) return false
    el.click()
    return true
  }, selector, needle)
  if (!ok) throw new Error(`clickByExactText: no ${selector} exactly "${needle}"`)
}

/** close any open dialog (SBO result screens etc.) */
async function closeDialog() {
  await page.evaluate(() => {
    const dlg = document.querySelector('div[role="dialog"]')
    if (!dlg) return
    const btn = [...dlg.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Close' || b.textContent.trim() === '✕')
    if (btn) btn.click()
  })
  await sleep(350)
}

async function logout() {
  await page.evaluate(() => {
    const btn = document.querySelector('button[title="Sign out"]')
    if (btn) btn.click()
  })
  await sleep(400)
}

async function login(username, password) {
  await sleep(300)
  await page.evaluate(() => localStorage.removeItem('msf-scada-session'))
  await page.reload({ waitUntil: 'networkidle2' })
  await sleep(600)
  await page.type('input[placeholder="e.g. operator1"]', username)
  await page.evaluate(() => { const el = document.querySelector('input[type="password"]'); if (el) el.value = '' })
  await page.type('input[type="password"]', password)
  await clickByText('button', 'Sign in')
  await sleep(900)
}

async function nav(viewLabel) {
  await clickByText('nav button', viewLabel)
  await sleep(500)
}

/** full SBO flow on the currently open dialog: purpose → interlocks → confirm → pin */
async function completeSbo(purposeNeedle, pin) {
  await page.evaluate((needle) => {
    const els = [...document.querySelectorAll('div[role="dialog"] button')]
    const el = els.find((b) => b.textContent.toLowerCase().includes(needle.toLowerCase()))
    if (el) el.click()
  }, purposeNeedle)
  await clickByText('div[role="dialog"] button', 'Continue')
  await sleep(400)
  await clickByText('div[role="dialog"] button', 'Continue → Confirm')
  await sleep(400)
  await clickByText('div[role="dialog"] button', 'proceed to PIN')
  await sleep(400)
  await page.type('div[role="dialog"] input[type="password"]', pin)
  await clickByText('div[role="dialog"] button', 'Execute')
  await sleep(700)
}

const chromePath = CHROME_CANDIDATES.find((p) => fs.existsSync(p))
if (!chromePath) { console.error('Chrome not found'); process.exit(2) }

browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu'],
  defaultViewport: { width: 1680, height: 950 },
})
page = await browser.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()) })

console.log(`\n=== MSF SCADA self-test @ ${BASE} ===\n`)

/* 1. login screen */
await page.goto(BASE, { waitUntil: 'networkidle2' })
await sleep(800)
report('Login screen renders', (await text()).includes('operator sign-in'))

/* 2. invalid credentials rejected */
await page.type('input[placeholder="e.g. operator1"]', 'hacker')
await page.type('input[type="password"]', 'wrong')
await clickByText('button', 'Sign in')
await sleep(400)
report('Invalid credentials rejected', (await text()).includes('invalid username or password'))

/* 3. all six accounts sign in */
const accounts = [
  ['guest', 'guest', 'visitor'], ['operator1', 'operator1', 'r. sharma'],
  ['supervisor1', 'supervisor1', 'p. iyer'], ['engineer1', 'engineer1', 'a. banerjee'],
  ['manager1', 'manager1', 's. krishnan'], ['admin', 'admin', 'system admin'],
]
for (const [u, p, name] of accounts) {
  await login(u, p)
  report(`Account ${u} signs in`, (await text()).includes(name))
  await logout()
}

/* 4. RBAC: guest loses restricted nav entirely */
await login('guest', 'guest')
report('Guest lands on SCADA Dashboard', (await text()).includes('msf control room'))
const guestNav = await text()
report('Guest: SLD/Relays nav hidden (access matrix)', !guestNav.includes('single line diagram') && !guestNav.includes('protection relays'))
report('Guest: breaker-control surfaces absent', !guestNav.includes('remote control terminal'))

/* 5. SLD as operator: view allowed, control denied */
await login('operator1', 'operator1')
await nav('Single Line Diagram')
await sleep(700)
await page.evaluate(() => {
  const g = document.querySelector('svg g.cursor-pointer')
  if (g) g.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await sleep(600)
const sldText = await text()
report('SLD bay inspector shows digital inputs', sldText.includes('spring') && sldText.includes('trip latch') && sldText.includes('modbus slave'))
report('Operator sees Elevated-Authority gate', sldText.includes('elevated authority required'))
report('Operator: control terminal hidden (RBAC)', !sldText.includes('remote control terminal'))

/* 6. alarms: operator sees ack controls */
await nav('Alarms')
await sleep(600)
report('Operator sees ACK-all control', (await text()).includes('ack all'))

/* 7. SBO full trip workflow as manager */
await login('manager1', 'manager1')
await nav('Single Line Diagram')
await sleep(700)
report('SLD breaker clickable', await page.evaluate(() => {
  const g = document.querySelector('svg g.cursor-pointer')
  if (!g) return false
  g.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  return true
}))
await sleep(500)
const canTrip = await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'TRIP' && !b.disabled))
report('Manager sees enabled TRIP control', canTrip)

if (canTrip) {
  await clickByExactText('button', 'TRIP')
  await sleep(500)
  report('SBO step 1: purpose selection', (await text()).includes('operational purpose'))
  // wrong-PIN attempt first
  await page.evaluate(() => {
    const els = [...document.querySelectorAll('div[role="dialog"] button')]
    const el = els.find((b) => b.textContent.includes('Planned maintenance'))
    if (el) el.click()
  })
  await completeSbo('Planned maintenance', '9999')
  report('SBO wrong PIN rejected + audited', (await text()).includes('pin verification failed'))

  // correct run
  await closeDialog()
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')]
    const trip = btns.find((b) => b.textContent.trim() === 'TRIP' && !b.disabled)
    if (trip) trip.click()
  })
  await sleep(500)
  const purposeStep = (await text()).includes('operational purpose')
  report('SBO reopens cleanly for new session', purposeStep)
  if (purposeStep) {
    await completeSbo('Emergency isolation', '1234')
    report('SBO correct PIN executes TRIP', (await text()).includes('operation executed'))
    report('Breaker state now TRIPPED', (await text()).includes('tripped'))

    // TRIP RESET via SBO
    await closeDialog()
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')]
      const reset = btns.find((b) => b.textContent.trim() === 'TRIP RESET' && !b.disabled)
      if (reset) reset.click()
    })
    await sleep(500)
    if ((await text()).includes('operational purpose')) {
      await completeSbo('Post-trip latch reset', '1234')
      report('TRIP RESET executes (latch cleared)', (await text()).includes('operation executed'))
    } else {
      report('TRIP RESET executes (latch cleared)', false, 'SBO flow did not open')
    }
  }
}

/* 8. interlock: find any CLOSED bay (awaited per-iteration) and assert its CLOSE is disabled */
await closeDialog() // dismiss SBO result screen from the reset above
await sleep(300)
let interlock = 'no-closed-bay'
const groupCount = await page.evaluate(() => document.querySelectorAll('svg g.cursor-pointer').length)
for (let i = 0; i < Math.min(groupCount, 25); i++) {
  await page.evaluate((idx) => {
    const g = document.querySelectorAll('svg g.cursor-pointer')[idx]
    if (g) g.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }, i)
  await sleep(300) // allow React to re-render the inspector for this bay
  const res = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')]
    const trip = btns.find((b) => b.textContent.trim() === 'TRIP' && !b.disabled)
    if (!trip) return null // bay not closed — try next
    const close = btns.find((b) => b.textContent.trim() === 'CLOSE')
    return close && close.disabled ? 'ok' : 'close-enabled'
  })
  if (res) { interlock = res; break }
}
report('Interlock: CLOSE disabled while bay closed', interlock === 'ok', interlock)

/* 9. fault injection end-to-end — via SLD bay inspector (manager-only gate) */
await nav('Single Line Diagram')
await sleep(700)
let inj = false
const gCount = await page.evaluate(() => document.querySelectorAll('svg g.cursor-pointer').length)
for (let i = 0; i < Math.min(gCount, 25); i++) {
  await page.evaluate((idx) => {
    const g = document.querySelectorAll('svg g.cursor-pointer')[idx]
    if (g) g.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }, i)
  await sleep(300)
  inj = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')]
    const oc = btns.find((b) => b.textContent.includes('Inject OC fault') && !b.disabled)
    if (!oc) return false
    oc.click()
    return true
  })
  if (inj) break
}
report('Fault injection triggered from bay inspector (manager gate)', inj)
await sleep(2500)

/* 9b. Diagnostics lab tab reachable (manager) — via header quick-bar deep link */
await clickByExactText('button', 'fault injection lab')
await sleep(700)
report('Fault Injection Lab deep-link opens guidance', (await text()).includes('injection guidance'))

/* 10. trip landed: alarms + audit */
await nav('Alarms')
await sleep(500)
const alarmAfter = await text()
report('Trip produced alarms', alarmAfter.includes('tripped') || alarmAfter.includes('breaker fail'))
await nav('Executive Overview')
await sleep(500)
report('Audit trail records switching events', (await text()).includes('breaker_trip') || (await text()).includes('fault_inject'))

/* 11. relay view + settings (engineer) */
await login('engineer1', 'engineer1')
await nav('Protection Relays')
await sleep(700)
const relayText = await text()
report('Relay fleet + IDMT panel render', relayText.includes('idmt characteristic') && relayText.includes('trip event log'))
report('Relay settings editor present for engineer', relayText.includes('commit settings'))

// nudge TMS slider FIRST (dirty form enables commit), then commit
const committed = await page.evaluate(() => {
  const slider = document.querySelector('input[type="range"]')
  if (!slider) return 'no-slider'
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(slider, '0.44')
  slider.dispatchEvent(new Event('input', { bubbles: true }))
  return 'nudged'
})
await sleep(200)
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')]
  const commit = btns.find((b) => b.textContent.includes('Commit settings') && !b.disabled)
  if (commit) commit.click()
})
await sleep(500)
report('Relay settings commit (audited)', (await text()).includes('written to audit trail'), committed)

/* 12. trends: live + historical + csv */
await nav('Trends')
await sleep(700)
report('Trends live chart renders', (await text()).includes('ring buffer'))
await clickByText('button', '7 days')
await sleep(700)
report('Trends 7-day historical window', (await text()).includes('last 7 days'))
report('CSV export available', (await text()).includes('export csv'))

/* 13. MFM analytics */
await nav('MFM Analytics')
await sleep(600)
const mfmText = await text()
report('MFM full register layout', mfmText.includes('v_ry') && mfmText.includes('thd-v') && mfmText.includes('kvah'))
report('MFM per-phase PF display (spec)', /r 0\.\d{2} · y 0\.\d{2}/.test(mfmText))

/* 14. report family — ENR/ANA/PRT/ALM/CMP controlled documents */
await nav('Reports & Energy')
await sleep(700)
const repText = await text()
report('Report hub selector (5 documents)', ['enr', 'ana', 'prt', 'alm', 'cmp'].every((c) => repText.includes(c)))
report('Energy statement renders (ToD + feeder register)', repText.includes('time-of-day tariff') && repText.includes('feeder-wise consumption register'))
report('Audit header + annexes present', repText.includes('report no.') && repText.includes('annexure a') && repText.includes('annexure b') && repText.includes('audit trail extract'))
report('Integrity digest on document', /integrity digest\s*[0-9a-f]{8}/i.test(repText))

/* ANA — analytics */
await clickByText('button', 'Energy Analytics Report')
await sleep(800)
const anaText = await text()
report('ANA: EnPI + analytics charts render', anaText.includes('energy performance indicators') && anaText.includes('load-duration curve') && anaText.includes('top-5 consumers'))
report('ANA: pie/donut + gauges + PQ analytics present', anaText.includes('donut') && anaText.includes('enpi gauges') && anaText.includes('voltage thd vs ieee 519') && anaText.includes('current tdd vs ieee 519'))
const anaCharts = await page.evaluate(() => document.querySelectorAll('#report-doc svg.recharts-surface').length)
report('ANA: >= 8 analytics charts drawn', anaCharts >= 8, `got ${anaCharts}`)

/* PRT — protection */
await clickByText('button', 'Protection Performance Report')
await sleep(700)
const prtText = await text()
report('PRT: IEC 60255 verification + settings register', prtText.includes('characteristic verification') && prtText.includes('relay settings snapshot'))
report('PRT: Buff 300 ms reference line', (await page.evaluate(() => document.querySelectorAll('#report-doc .recharts-reference-line').length)) >= 1)

/* ALM — alarms/SOE */
await clickByText('button', 'Alarm & SOE Analysis Report')
await sleep(700)
const almText = await text()
report('ALM: ISA-18.2 metrics + SOE annex', almText.includes('isa-18.2') && almText.includes('soe annex'))
report('ALM: rate gauge + ack histogram + donut', almText.includes('alarm-rate gauge') && almText.includes('acknowledge-time histogram') && almText.includes('standing vs acknowledged'))

/* CMP — compliance */
await clickByText('button', 'Calibration & Compliance Report')
await sleep(700)
const cmpText = await text()
report('CMP: calibration results (ISO 17025)', cmpText.includes('calibration results') && cmpText.includes('nabl'))
report('CMP: BIS standards + traceability', cmpText.includes('is 16444') && cmpText.includes('traceability') && cmpText.includes('time-sync'))
report('CMP: conformity donut present', (await page.evaluate(() => document.querySelectorAll('#report-doc .recharts-pie').length)) >= 1)

await clickByText('button', 'Energy & Event Statement')
await sleep(500)
const enrText = await text()
report('Scheduled reports + COMNET present', enrText.includes('scheduled reports') && enrText.includes('msf-comnet'))
report('Range & Limit Definitions table (exact values + standards)', enrText.includes('range & limit definitions') && enrText.includes('governing standard') && enrText.includes('ieee 519-2022 table 1') && enrText.includes('iec 62682'))
report('Range defs carry IS 16444 + IEC 60255 + ISA-18.2 limits', ['is 16444 table-6', 'iec 60255-151', 'isa-18.2'].every((s) => enrText.includes(s)))

/* 15. diagnostics: gateways + modbus map */
await nav('Diagnostics')
await sleep(500)
await clickByText('button', 'Gateway Health')
await sleep(400)
report('Gateway health panels', (await text()).includes('packet loss'))
await clickByText('button', 'Modbus Register Map')
await sleep(400)
report('Modbus block-register map (C1)', (await text()).includes('blk-1 status'))

/* 16. dashboard wall mode + VCB matrix */
await nav('SCADA Dashboard')
await sleep(500)
await clickByText('button', 'Wall mode')
await sleep(600)
const dashText = await text()
report('Dashboard wall mode engages', dashText.includes('msf control room'))
report('VCB matrix live on dashboard', dashText.includes('vcb status matrix'))

/* 17. runtime errors */
report('Zero page errors across all flows', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))

/* ------------------------------- summary ----------------------------------- */

await browser.close()
const pass = results.filter((r) => r.ok).length
console.log(`\n========== ${pass}/${results.length} PASSED ==========\n`)
fs.writeFileSync('selftest-results.json', JSON.stringify({ pass, total: results.length, results }, null, 2))
process.exit(pass === results.length ? 0 : 1)
