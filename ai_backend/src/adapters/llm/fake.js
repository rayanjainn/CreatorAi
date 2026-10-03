// Deterministic LLM. Tests script replies with queueResponse(); every call is recorded
// in calls so a test can assert on the prompt the "model" received.
import { CompleteJsonInput } from './contract.js';

const queued = [];
export const calls = [];

// reply: an object (returned as JSON), a string (returned as raw text, e.g. invalid JSON),
// an Error (thrown), or a function (request) => one of those (may be async).
export function queueResponse(...replies) {
  queued.push(...replies);
}

// A reply that arrives after `ms`. With request.timeoutMs shorter than that, the call
// fails with code 'timeout', like the real adapter's AbortController does.
export function delay(ms, reply) {
  return () =>
    new Promise((resolve) => {
      setTimeout(() => resolve(reply), ms).unref?.();
    });
}

export function reset() {
  queued.length = 0;
  calls.length = 0;
}

function timeoutError(ms) {
  const err = new Error(`LLM call timed out after ${ms} ms`);
  err.code = 'timeout';
  return err;
}

async function resolveReply(reply, req) {
  if (typeof reply !== 'function') return reply;
  const pending = Promise.resolve(reply(req));
  if (!req.timeoutMs) return pending;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(timeoutError(req.timeoutMs)), req.timeoutMs);
  });
  try {
    return await Promise.race([pending, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function completeJson(request) {
  const req = CompleteJsonInput.parse(request);
  calls.push(req);
  const reply = await resolveReply(queued.length ? queued.shift() : { ok: true }, req);
  if (reply instanceof Error) throw reply;

  const text = typeof reply === 'string' ? reply : JSON.stringify(reply);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    const err = new Error('LLM returned invalid JSON');
    err.code = 'invalid_json';
    err.text = text;
    throw err;
  }
  return {
    json,
    text,
    provider: 'fake',
    model: req.model ?? 'fake-llm',
    usage: { inputTokens: Math.ceil(((req.system ?? '') + req.prompt).length / 4), outputTokens: Math.ceil(text.length / 4) },
  };
}
