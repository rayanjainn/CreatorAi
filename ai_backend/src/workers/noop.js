// Smoke job proving the API -> queue -> worker path works end to end.
export async function noop(data) {
  return { ok: true, echo: data.message ?? null, processedAt: new Date().toISOString() };
}
