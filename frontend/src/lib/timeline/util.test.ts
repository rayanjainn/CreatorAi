import { describe, expect, it } from 'vitest'
import { pyRound } from './util'

describe('pyRound matches Python round()', () => {
  it('rounds half to even on exact ties and otherwise to nearest', () => {
    expect(pyRound(0.0625, 3)).toBe(0.062)
    expect(pyRound(0.1875, 3)).toBe(0.188)
    expect(pyRound(2.5, 0)).toBe(2)
    expect(pyRound(3.5, 0)).toBe(4)
    expect(pyRound(1.0005, 3)).toBe(1) // the double is just below the tie
    expect(pyRound(1.23456789, 6)).toBe(1.234568)
    expect(pyRound(-0.0625, 3)).toBe(-0.062)
    expect(pyRound(20.481, 6)).toBe(20.481)
    expect(pyRound(0, 3)).toBe(0)
  })
})
