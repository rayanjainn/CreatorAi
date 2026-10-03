// Deterministic transcript: evenly spaced sentences across the input duration.
// queueResult() scripts the next replies (an output object, an Error, or a function).
import { TranscribeInput } from './contract.js';

const SENTENCES = [
  'Here is the one mistake most creators make with their hooks.',
  'You have about three seconds before someone scrolls away.',
  'So lead with the payoff, then explain how you got there.',
  'Try it on your next video and watch the retention graph.',
];

const queued = [];
export const calls = [];

export function queueResult(...results) {
  queued.push(...results);
}

export function reset() {
  queued.length = 0;
  calls.length = 0;
}

export async function transcribe(input) {
  const req = TranscribeInput.parse(input);
  calls.push(req);
  if (queued.length) {
    let next = queued.shift();
    if (typeof next === 'function') next = await next(req);
    if (next instanceof Error) throw next;
    return next;
  }
  const durationMs = req.durationMs ?? 20_000;
  const step = Math.floor(durationMs / SENTENCES.length);
  return {
    language: req.language ?? 'en',
    durationMs,
    segments: SENTENCES.map((text, i) => ({ startMs: i * step, endMs: (i + 1) * step - 100, text })),
  };
}
