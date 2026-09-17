/* ============================================================================
 * MSF Web SCADA — Report chart kit
 * Donut/pie, histogram, area-with-limit-bands and gauge charts used inside the
 * report documents. All charts are sized for print (fixed heights, explicit
 * colours) and derive from the same reconciled base data as every table.
 * ==========================================================================*/

import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { clsx } from 'clsx'
import { RANGE_DEFS, RANGE_TONE_HEX, RangeDef } from './reportKit'

const TT = { background: '#0F1522', border: '1px solid #28324A', fontSize: 11 }
const GRID = '#1B2537'
const AXIS = '#28324A'
const TICK = { fontSize: 9, fill: '#64748B' }

export function ChartFrame({ title, height = 200, children }: { title: string; height?: number; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="report-sec">{title}</h3>
      <div className="border border-ink-700 rounded bg-ink-900/40 p-2" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          {children as never}
        </ResponsiveContainer>
      </div>
    </section>
  )
}

/* ------------------------------ donut / pie -------------------------------- */

export interface Slice { name: string; value: number; color: string }

export function DonutChart({ data, unit = '', width, height }: { data: Slice[]; unit?: string; width?: number; height?: number }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  return (
    <PieChart width={width} height={height}>
      <Pie data={data} dataKey="value" nameKey="name" innerRadius={52} outerRadius={80} paddingAngle={2} stroke="#0B0F17" labelLine={false}
        label={(p: { name?: string; percent?: number }) => `${p.name} ${((p.percent ?? 0) * 100).toFixed(0)}%`}>
        {data.map((d) => <Cell key={d.name} fill={d.color} />)}
      </Pie>
      <Tooltip contentStyle={TT} formatter={(v: number) => `${v.toLocaleString('en-IN')} ${unit}`} />
      <Legend wrapperStyle={{ fontSize: 9.5 }} />
      <text x="50%" y="46%" textAnchor="middle" fill="#94A3B8" fontSize="15" fontWeight="700">
        {total >= 10000 ? `${(total / 1000).toFixed(1)}k` : total.toLocaleString('en-IN')}
      </text>
      <text x="50%" y="55%" textAnchor="middle" fill="#64748B" fontSize="9">{unit || 'total'}</text>
    </PieChart>
  )
}

/* ------------------------------- histogram --------------------------------- */

export function HistogramChart({ data, unit = '', color = '#22D3EE', width, height }: { data: { bucket: string; count: number }[]; unit?: string; color?: string; width?: number; height?: number }) {
  return (
    <BarChart width={width} height={height} data={data} margin={{ top: 6, right: 12, bottom: 0, left: -10 }}>
      <CartesianGrid stroke={GRID} />
      <XAxis dataKey="bucket" tick={TICK} stroke={AXIS} interval={0} />
      <YAxis tick={TICK} stroke={AXIS} allowDecimals={false} width={34} />
      <Tooltip contentStyle={TT} formatter={(v: number) => [`${v} ${unit}`, 'events']} />
      <Bar dataKey="count" fill={color} radius={[3, 3, 0, 0]} />
    </BarChart>
  )
}

/* --------------------------- area with limit bands ------------------------- */

export interface AreaSeries { t: string; v: number }
export function LimitAreaChart({
  data, unit = '', color = '#22D3EE', width, height,
  alarmLine, hardLine, alarmLabel, hardLabel,
}: {
  data: AreaSeries[]; unit?: string; color?: string; width?: number; height?: number
  alarmLine?: number; hardLine?: number; alarmLabel?: string; hardLabel?: string
}) {
  return (
    <AreaChart width={width} height={height} data={data} margin={{ top: 8, right: 14, bottom: 0, left: -10 }}>
      <CartesianGrid stroke={GRID} />
      <XAxis dataKey="t" tick={{ ...TICK, fontSize: 8.5 }} stroke={AXIS} interval={1} />
      <YAxis tick={TICK} stroke={AXIS} width={48} domain={[0, (max: number) => Math.max(max * 1.18, hardLine ?? 0, alarmLine ?? 0) * 1.05]} />
      <Tooltip contentStyle={TT} formatter={(v: number) => [`${v} ${unit}`, 'measured']} />
      <defs>
        <linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.45} />
          <stop offset="100%" stopColor={color} stopOpacity={0.03} />
        </linearGradient>
      </defs>
      <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.8} fill="url(#ag)" isAnimationActive={false} />
      {alarmLine !== undefined && (
        <ReferenceLine y={alarmLine} stroke={RANGE_TONE_HEX.amber} strokeDasharray="6 3" strokeWidth={1.2}
          label={{ value: alarmLabel ?? `alarm ${alarmLine}${unit}`, position: 'insideTopRight', fill: RANGE_TONE_HEX.amber, fontSize: 9 }} />
      )}
      {hardLine !== undefined && (
        <ReferenceLine y={hardLine} stroke={RANGE_TONE_HEX.red} strokeDasharray="3 3" strokeWidth={1.2}
          label={{ value: hardLabel ?? `hard limit ${hardLine}${unit}`, position: 'insideTopRight', fill: RANGE_TONE_HEX.red, fontSize: 9 }} />
      )}
    </AreaChart>
  )
}

/* --------------------------------- gauge ----------------------------------- */

export function GaugeChart({ value, min = 0, max = 1, label, bandColor = '#4ADE80' }: { value: number; min?: number; max?: number; label: string; bandColor?: string }) {
  const pct = Math.min(1, Math.max(0, (value - min) / (max - min)))
  const R = 52; const CX = 70; const CY = 66
  const a0 = Math.PI * 0.85; const a1 = Math.PI * 0.15 + Math.PI * 2
  const ang = a0 + (a1 - a0) * pct
  const pt = (a: number) => `${CX + R * Math.cos(a)},${CY + R * Math.sin(a)}`
  const arc = (from: number, to: number, stroke: string, w: number) => (
    <path key={`${from}-${to}`} d={`M ${pt(from)} A ${R} ${R} 0 ${to - from > Math.PI ? 1 : 0} 1 ${pt(to)}`} fill="none" stroke={stroke} strokeWidth={w} strokeLinecap="round" />
  )
  return (
    <svg viewBox="0 0 140 92" className="w-full h-full">
      {arc(a0, a1, '#1B2537', 10)}
      {arc(a0, a0 + (a1 - a0) * pct, bandColor, 10)}
      <circle cx={CX + (R - 4) * Math.cos(ang)} cy={CY + (R - 4) * Math.sin(ang)} r="4.5" fill="#E2E8F0" />
      <text x={CX} y={CY - 6} textAnchor="middle" fill="#E2E8F0" fontSize="15" fontWeight="700" className="num">
        {value >= 100 ? value.toFixed(0) : value.toFixed(2)}
      </text>
      <text x={CX} y={CY + 6} textAnchor="middle" fill="#64748B" fontSize="8">{label}</text>
    </svg>
  )
}

/* ------------------------ grouped comparison bars -------------------------- */

export function GroupedBars({ data, bars, width, height }: { data: Record<string, string | number>[]; bars: { key: string; name: string; color: string }[]; width?: number; height?: number }) {
  return (
    <BarChart width={width} height={height} data={data} margin={{ top: 6, right: 12, bottom: 0, left: -10 }} barGap={2}>
      <CartesianGrid stroke={GRID} />
      <XAxis dataKey="name" tick={{ ...TICK, fontSize: 8.5 }} stroke={AXIS} />
      <YAxis tick={TICK} stroke={AXIS} width={44} />
      <Tooltip contentStyle={TT} />
      <Legend wrapperStyle={{ fontSize: 9.5 }} />
      {bars.map((b) => <Bar key={b.key} dataKey={b.key} name={b.name} fill={b.color} radius={[3, 3, 0, 0]} />)}
    </BarChart>
  )
}

/* ----------------------------- timeline lines ------------------------------ */

export function DualLineChart({ data, a, b, nameA, nameB, colorA = '#22D3EE', colorB = '#A78BFA', dashedB = true, unit = '', width, height }: {
  data: Record<string, number | null>[]
  a: string; b: string; nameA: string; nameB: string
  colorA?: string; colorB?: string; dashedB?: boolean; unit?: string; width?: number; height?: number
}) {
  return (
    <LineChart width={width} height={height} data={data} margin={{ top: 8, right: 14, bottom: 0, left: -10 }}>
      <CartesianGrid stroke={GRID} />
      <XAxis dataKey="idx" tick={TICK} stroke={AXIS} />
      <YAxis tick={TICK} stroke={AXIS} width={48} />
      <Tooltip contentStyle={TT} formatter={(v: number) => [`${v} ${unit}`, '']} />
      <Legend wrapperStyle={{ fontSize: 9.5 }} />
      <Line type="monotone" dataKey={a} name={nameA} stroke={colorA} dot={{ r: 2 }} strokeWidth={1.6} isAnimationActive={false} connectNulls />
      <Line type="monotone" dataKey={b} name={nameB} stroke={colorB} dot={false} strokeWidth={1.4} strokeDasharray={dashedB ? '5 3' : undefined} isAnimationActive={false} connectNulls />
    </LineChart>
  )
}

/* --------------------- range & limit definitions table --------------------- */

/**
 * Exact-value / acceptance-band register printed inside every report so each
 * measured figure carries its nominal value, acceptable range, hard limit and
 * the governing standard clause (ISO 9001 §8.5.1 control of production...
 * applied to documented acceptance criteria).
 */
export function RangeDefsTable({ highlight }: { highlight?: string[] }) {
  const defs = highlight?.length ? RANGE_DEFS.filter((d) => highlight.includes(d.id)) : RANGE_DEFS
  return (
    <section>
      <h3 className="report-sec">Range &amp; Limit Definitions — exact values and governing standards</h3>
      <div className="border border-ink-700 rounded overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead className="bg-ink-800/70">
            <tr>
              {['Parameter', 'Nominal / design value', 'Acceptable operating range', 'Hard limit', 'Governing standard / clause'].map((h, i) => (
                <th key={h} className={clsx(
                  'py-1.5 px-2 text-[9px] font-semibold uppercase tracking-widest text-slate-500 border-b border-ink-600 whitespace-nowrap',
                  i === 0 ? 'text-left' : 'text-left',
                )}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {defs.map((d: RangeDef) => (
              <tr key={d.id} className="hover:bg-ink-800/40">
                <td className="py-1.5 px-2 border-b border-ink-800/50">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: RANGE_TONE_HEX[d.tone] }} />
                    <span className="text-slate-200 whitespace-nowrap">{d.parameter}</span>
                  </span>
                </td>
                <td className="py-1.5 px-2 border-b border-ink-800/50 num text-slate-100 whitespace-nowrap">{d.nominal}</td>
                <td className="py-1.5 px-2 border-b border-ink-800/50 num text-slate-300">{d.acceptableRange}</td>
                <td className="py-1.5 px-2 border-b border-ink-800/50 num text-slate-400">{d.hardLimit}</td>
                <td className="py-1.5 px-2 border-b border-ink-800/50 text-slate-500">{d.standard}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[9px] text-slate-600 mt-1.5 leading-relaxed">
        Colour key: <span className="text-slate-300">green</span> — metering/voltage classes · <span className="text-slate-300">cyan</span> — system/alarms ·
        <span className="text-slate-300"> amber</span> — PF &amp; EnPI bands · <span className="text-slate-300">red</span> — protection/SOE ·
        <span className="text-slate-300"> violet</span> — power quality. Reference lines on charts correspond to these values.
      </p>
    </section>
  )
}
