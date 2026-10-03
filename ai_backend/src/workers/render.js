// P7 render worker: render.run { renderId } -> one MP4 of the pinned timeline version.
//
// claim the row (queued -> rendering) -> load the pinned version's doc -> resolve each
// clip's asset to an input (preview: the Cloudinary low-res proxy, final: the original)
// -> buildFfmpegArgs -> ffmpeg.run into a temp dir, progress from `-progress pipe:1`
// -> upload to proj/<id>/derived/renders -> asset row kind 'render' -> done.
// Any failure marks the render failed with the error (FFmpeg's stderr tail included) and
// fails the job without a retry; the temp dir is removed either way, and the worker goes
// on with the next job.
//
// Tests point the worker at local files with configureRender({ ffmpeg, resolveInput,
// storage, tmpRoot }) (e.g. the real FFmpeg adapter on tests/fixtures/fixture.mp4 while
// ADAPTERS=fake); resetRender() restores the defaults.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getFfmpeg } from '../adapters/ffmpeg/index.js';
import { getStorage } from '../adapters/storage/index.js';
import { NonRetryableError } from '../lib/errors.js';
import { createDerivedAsset, derivedFolder, getAsset } from '../modules/media/service.js';
import {
  buildFfmpegArgs,
  claimRender,
  completeRender,
  failRender,
  renderClips,
  renderSize,
  setRenderProgress,
} from '../modules/render/service.js';
import { getHead, getVersion } from '../modules/timeline/service.js';

const PROGRESS_EVERY_MS = 500;
const STDERR_TAIL_CHARS = 2000;

const even = (n) => Math.max(2, Math.round(n / 2) * 2);

// Preview input: the proxy just wide enough to fill the preview frame after crop
// (never wider than the original). Final input: the original upload.
function defaultResolveInput(asset, { kind, width, height }) {
  if (kind === 'final') {
    if (!asset.url) throw new NonRetryableError(`asset ${asset.id} has no URL`);
    return asset.url;
  }
  let proxyWidth = width;
  if (asset.width && asset.height) {
    proxyWidth = Math.min(asset.width, even(Math.max(width, (height * asset.width) / asset.height)));
  }
  return getStorage().proxyUrl(asset.publicId, { width: proxyWidth });
}

const defaults = () => ({
  ffmpeg: null, // null -> getFfmpeg() at run time
  storage: null, // null -> getStorage() at run time
  resolveInput: defaultResolveInput, // (asset, { kind, width, height }) -> path | url | { url, hasAudio }
  tmpRoot: null, // null -> os.tmpdir()
});
let config = defaults();

export function configureRender(overrides = {}) {
  config = { ...config, ...overrides };
}

export function resetRender() {
  config = defaults();
}

function describeError(err) {
  if (typeof err?.stderrTail === 'string' && err.stderrTail) {
    return `ffmpeg exited with code ${err.code}\n${err.stderrTail.slice(-STDERR_TAIL_CHARS)}`;
  }
  return err?.message ?? String(err);
}

// Throttled progress writes, chained so they land in order; flush() awaits the last one.
function progressWriter(renderId, durationMs) {
  let last = 0;
  let chain = Promise.resolve();
  return {
    onProgress({ outTimeMs }) {
      const now = Date.now();
      if (now - last < PROGRESS_EVERY_MS) return;
      last = now;
      const value = Math.min(0.99, durationMs > 0 ? outTimeMs / durationMs : 0);
      chain = chain.then(() => setRenderProgress(renderId, value)).catch(() => {});
    },
    flush: () => chain,
  };
}

async function loadInputs(render, doc) {
  const size = { kind: render.kind, ...renderSize(doc.output, render.kind) };
  const inputs = {};
  for (const clip of renderClips(doc)) {
    if (inputs[clip.assetId]) continue;
    let asset;
    try {
      asset = await getAsset(render.projectId, clip.assetId);
    } catch (err) {
      if (err?.status === 404) throw new NonRetryableError(`asset ${clip.assetId} not found`);
      throw err;
    }
    inputs[clip.assetId] = await config.resolveInput(asset, size);
  }
  return inputs;
}

async function render(claimed) {
  const ffmpeg = config.ffmpeg ?? getFfmpeg();
  const storage = config.storage ?? getStorage();
  const { timeline } = await getHead(claimed.projectId, claimed.timelineId);
  const { doc } = await getVersion(claimed.projectId, claimed.timelineId, claimed.version);
  const inputs = await loadInputs(claimed, doc);

  const dir = await fs.mkdtemp(path.join(config.tmpRoot ?? os.tmpdir(), 'render-'));
  try {
    const outputPath = path.join(dir, `render-${claimed.id}.mp4`);
    const plan = buildFfmpegArgs(doc, inputs, { kind: claimed.kind, outputPath });
    const progress = progressWriter(claimed.id, plan.durationMs);
    try {
      await ffmpeg.run(plan.args, { onProgress: progress.onProgress });
    } finally {
      await progress.flush();
    }
    const uploaded = await storage.uploadFile(outputPath, {
      folder: `${derivedFolder(claimed.projectId)}/renders`,
      resourceType: 'video',
    });
    const asset = await createDerivedAsset(claimed.projectId, {
      kind: 'render',
      parentAssetId: timeline.sourceAssetId ?? null,
      publicId: uploaded.publicId,
      url: uploaded.url,
      durationMs: plan.durationMs,
      width: plan.width,
      height: plan.height,
      meta: { renderId: claimed.id, timelineId: claimed.timelineId, version: claimed.version, kind: claimed.kind },
    });
    return { asset, plan };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

// Job handler for render.run.
export async function renderRun({ renderId }) {
  const claimed = await claimRender(renderId);
  if (!claimed) return { renderId, skipped: true };
  try {
    const { asset, plan } = await render(claimed);
    await completeRender(renderId, asset.id);
    return { renderId, status: 'done', outputAssetId: asset.id, durationMs: plan.durationMs };
  } catch (err) {
    const message = describeError(err);
    await failRender(renderId, message);
    throw new NonRetryableError(`render ${renderId} failed: ${message.slice(0, 500)}`);
  }
}
