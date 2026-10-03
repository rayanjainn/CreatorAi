// P6.T1 pure logic, tested through agents/editing/service.js: scoring and candidate
// selection (top-K by score, within the duration limits, non-overlapping, greedy).
import { afterEach, describe, expect, it } from 'vitest';
import {
  configureEditing,
  getEditingConfig,
  resetEditing,
  scoreMoment,
  selectCandidates,
} from '../../src/modules/agents/editing/service.js';

afterEach(resetEditing);

const m = (id, startMs, endMs, score) => ({ id, startMs, endMs, score });

describe('scoreMoment', () => {
  it('is the weighted sum of the sub-scores with the configured weights, in [0, 1]', () => {
    configureEditing({ weights: { hook: 0.4, selfContained: 0.3, energy: 0.2, topicMatch: 0.1 } });
    expect(scoreMoment({ hook: 1, selfContained: 0.5, energy: 0, topicMatch: 1 })).toBeCloseTo(0.4 + 0.15 + 0 + 0.1, 6);
    expect(scoreMoment({ hook: 0, selfContained: 0, energy: 0, topicMatch: 0 })).toBe(0);
    expect(scoreMoment({ hook: 1, selfContained: 1, energy: 1, topicMatch: 1 })).toBeCloseTo(1, 6);
  });

  it('normalises weights that do not sum to 1, so the score stays in [0, 1]', () => {
    configureEditing({ weights: { hook: 2, selfContained: 2, energy: 0, topicMatch: 0 } });
    expect(scoreMoment({ hook: 1, selfContained: 1, energy: 0, topicMatch: 0 })).toBeCloseTo(1, 6);
    expect(scoreMoment({ hook: 1, selfContained: 0, energy: 1, topicMatch: 1 })).toBeCloseTo(0.5, 6);
  });

  it('weights live in config and default to a sum of 1', () => {
    const { weights } = getEditingConfig();
    expect(Object.keys(weights).sort()).toEqual(['energy', 'hook', 'selfContained', 'topicMatch']);
    expect(Object.values(weights).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });
});

describe('selectCandidates', () => {
  const seeded = [
    m('a', 0, 30_000, 0.9),
    m('b', 10_000, 40_000, 0.95), // best, overlaps a and c
    m('c', 35_000, 65_000, 0.8), // overlaps b
    m('d', 40_000, 70_000, 0.7), // touches b's end: not an overlap
    m('e', 70_000, 80_000, 0.99), // too short (10 s)
    m('f', 80_000, 150_000, 0.98), // too long (70 s)
    m('g', 90_000, 120_000, 0.6),
    m('h', 120_000, 140_000, 0.5),
  ];

  it('returns the expected top-K, best first, none overlapping, all within the limits', () => {
    const picked = selectCandidates(seeded, { k: 3, minMs: 15_000, maxMs: 60_000 });
    expect(picked.map((c) => c.id)).toEqual(['b', 'd', 'g']);
    for (const c of picked) {
      expect(c.endMs - c.startMs).toBeGreaterThanOrEqual(15_000);
      expect(c.endMs - c.startMs).toBeLessThanOrEqual(60_000);
    }
    const sorted = [...picked].sort((x, y) => x.startMs - y.startMs);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].startMs).toBeGreaterThanOrEqual(sorted[i - 1].endMs);
  });

  it('returns fewer than K when no more non-overlapping moments fit', () => {
    const picked = selectCandidates(seeded, { k: 10, minMs: 15_000, maxMs: 60_000 });
    expect(picked.map((c) => c.id)).toEqual(['b', 'd', 'g', 'h']);
  });

  it('breaks score ties by start time and uses the configured limits by default', () => {
    const tied = [m('late', 40_000, 60_000, 0.5), m('early', 0, 20_000, 0.5), m('mid', 15_000, 45_000, 0.5)];
    expect(selectCandidates(tied, { k: 2 }).map((c) => c.id)).toEqual(['early', 'late']);
    configureEditing({ candidates: { k: 1, minMs: 25_000, maxMs: 60_000 } });
    expect(selectCandidates(tied).map((c) => c.id)).toEqual(['mid']);
  });

  it('does not mutate its input', () => {
    const copy = structuredClone(seeded);
    selectCandidates(seeded, { k: 3 });
    expect(seeded).toEqual(copy);
  });
});
