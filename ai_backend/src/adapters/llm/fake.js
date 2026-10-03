// Deterministic LLM. Tests script replies with queueResponse(); every call is recorded
// in calls so a test can assert on the prompt the "model" received.
import { CompleteJsonInput } from './contract.js';

const queued = [];
export const calls = [];

// reply: an object (returned as JSON), a string (returned as raw text, e.g. invalid JSON),
// an Error (thrown), or a function (request) => one of those.
export function queueResponse(...replies) {
  queued.push(...replies);
}

export function reset() {
  queued.length = 0;
  calls.length = 0;
}

export async function completeJson(request) {
  const req = CompleteJsonInput.parse(request);
  calls.push(req);
  let reply = queued.length ? queued.shift() : { ok: true };
  if (typeof reply === 'function') reply = await reply(req);
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
