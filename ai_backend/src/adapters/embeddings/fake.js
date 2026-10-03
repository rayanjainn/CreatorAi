// Deterministic unit vectors derived from the input text. seed() pins an exact vector
// for an input so search tests can control which row ranks first.
// Scriptable for tests: setImageSupport(false) makes supportsImages() false and
// embedImages() reject with code 'unsupported'; failNext(err) makes the next call reject;
// calls records every call as { fn, inputs }.
import { getEnv } from '../../config/env.js';
import { hash32 } from '../pick.js';

const seeded = new Map();
const failures = [];
let images = true;
export const calls = [];

export function seed(input, vector) {
  seeded.set(input, vector);
}

export function setImageSupport(supported) {
  images = supported;
}

export function failNext(...errors) {
  failures.push(...errors);
}

export function reset() {
  seeded.clear();
  failures.length = 0;
  calls.length = 0;
  images = true;
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

function nextFailure() {
  if (failures.length) throw failures.shift();
}

export function supportsImages() {
  return images;
}

export async function embedTexts(texts) {
  calls.push({ fn: 'embedTexts', inputs: [...texts] });
  nextFailure();
  return texts.map((t) => vectorFor(`text:${t}`));
}

export async function embedImages(urls) {
  calls.push({ fn: 'embedImages', inputs: [...urls] });
  nextFailure();
  if (!images) throw Object.assign(new Error('image embeddings are not supported by this model'), { code: 'unsupported' });
  return urls.map((u) => vectorFor(`image:${u}`));
}
