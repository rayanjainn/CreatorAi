// Deterministic unit vectors derived from the input text. seed() pins an exact vector
// for an input so search tests can control which row ranks first.
import { getEnv } from '../../config/env.js';
import { hash32 } from '../pick.js';

const seeded = new Map();

export function seed(input, vector) {
  seeded.set(input, vector);
}

export function reset() {
  seeded.clear();
}

export function vectorFor(input, dim = getEnv().EMBED_DIM) {
  if (seeded.has(input)) return seeded.get(input);
  // xorshift32 seeded from the input hash
  let s = hash32(input) || 1;
  const v = new Array(dim);
  for (let i = 0; i < dim; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    v[i] = ((s >>> 0) / 0xffffffff) * 2 - 1;
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

export async function embedTexts(texts) {
  return texts.map((t) => vectorFor(`text:${t}`));
}

export async function embedImages(urls) {
  return urls.map((u) => vectorFor(`image:${u}`));
}
