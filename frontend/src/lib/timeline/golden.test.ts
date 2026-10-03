import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import golden from './golden.json'
import { applyOp, layerChanges, OpError, validate, setIdGenerator } from './index'
import { closeTo, counterIds, fromJson } from './testing'

type Ctx = { asset_durations: Record<string, number>; silences: Record<string, [number, number][]>; words: Record<string, { word: string; start: number; end: number }[]> }
const G = golden as unknown as {
  ctx: Ctx
  inputs: Record<string, unknown>
  validate: { name: string; input: string; asset_durations: Record<string, number> | null; expected: [string, string, string | null][] }[]
  cases: { name: string; input: string; op: string; params: Record<string, unknown>; expected: { timeline?: unknown; error?: { code: string; op: string | null } } }[]
  sequences: { name: string; input: string; steps: { op: string; params: Record<string, unknown>; expected: { timeline?: unknown; error?: { code: string; op: string | null } } }[] }[]
  layer_changes: { name: string; before: string; after: string; expected: { status: string; layer: string; kind: string; item_ids: string[]; sources: string[] }[] }[]
}

const ctx = {
  assetDurations: G.ctx.asset_durations,
  silences: G.ctx.silences,
  wordsProvider: (id: string) => G.ctx.words[id] ?? [],
}

beforeEach(() => counterIds(1000))
afterEach(() => setIdGenerator(null))

function runStep(t: ReturnType<typeof fromJson>, op: string, params: Record<string, unknown>, expected: { timeline?: unknown; error?: { code: string; op: string | null } }) {
  if (expected.error) {
    let err: unknown = null
    try {
      applyOp(t, op, params, ctx)
    } catch (e) {
      err = e
    }
    expect(err, `expected ${op} to fail with ${expected.error.code}`).toBeInstanceOf(OpError)
    expect((err as OpError).code).toBe(expected.error.code)
    expect((err as OpError).details.op ?? null).toBe(expected.error.op)
    return t
  }
  const out = applyOp(t, op, params, ctx)
  const diff = closeTo(out, expected.timeline)
  expect(diff, `${op} ${JSON.stringify(params)}`).toBeNull()
  return out
}

describe('golden: ops match the Python implementation', () => {
  for (const c of G.cases) {
    it(c.name, () => {
      runStep(fromJson(G.inputs[c.input]), c.op, c.params, c.expected)
    })
  }
})

describe('golden: seeded random op sequences match step by step', () => {
  for (const s of G.sequences) {
    it(s.name, () => {
      let t = fromJson(G.inputs[s.input])
      s.steps.forEach((step, n) => {
        const next = runStep(t, step.op, step.params, step.expected)
        t = next
        void n
      })
    })
  }
})

describe('golden: validate()', () => {
  for (const v of G.validate) {
    it(v.name, () => {
      const got = validate(fromJson(G.inputs[v.input]), v.asset_durations).map((x) => [x.code, x.path, x.item_id])
      expect(got).toEqual(v.expected)
    })
  }
})

describe('golden: layerChanges()', () => {
  for (const c of G.layer_changes) {
    it(c.name, () => {
      expect(layerChanges(fromJson(G.inputs[c.before]), fromJson(G.inputs[c.after]))).toEqual(c.expected)
    })
  }
})
