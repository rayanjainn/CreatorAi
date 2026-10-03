import { getEnv } from '../config/env.js';

// Every adapter's index.js uses this, so ADAPTERS=fake swaps out all network calls at once.
export function pick(real, fake) {
  return getEnv().ADAPTERS === 'fake' ? fake : real;
}

export function notImplemented(adapter, fn, phase) {
  return async () => {
    throw new Error(`${adapter}.${fn} (real) is not implemented yet: planned for phase ${phase}`);
  };
}

// Deterministic 32-bit FNV-1a hash, used by fakes to derive stable output from input.
export function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
