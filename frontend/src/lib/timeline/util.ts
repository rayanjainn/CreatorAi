/** Python-compatible `round(x, n)` (round-half-to-even on the exact binary value), so results match the backend. */
export function pyRound(x: number, n: number): number {
  if (!Number.isFinite(x)) return x
  const sign = x < 0 ? -1 : 1
  const a = Math.abs(x)
  const f = a.toFixed(Math.min(100, n + 30))
  const dot = f.indexOf('.')
  const tail = f.slice(dot + 1 + n)
  const base = f.slice(0, dot + 1 + n)
  let r = Number(base)
  if (/^50*$/.test(tail)) {
    // exact tie: round half to even on the last kept digit
    const lastDigit = Number(base.replace('.', '').slice(-1))
    if (lastDigit % 2 === 1) r += Math.pow(10, -n)
  } else if (Number(tail[0]) >= 5) {
    r += Math.pow(10, -n)
  }
  // clean binary noise from the addition
  return sign * Number(r.toFixed(n))
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
