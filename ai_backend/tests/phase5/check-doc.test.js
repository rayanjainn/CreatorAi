// P5.T1: the service wrapper loads assets through media getAssetsByIds before validating.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { assertTimelineDoc, checkTimelineDoc } from '../../src/modules/timeline/service.js';
import { createProject } from '../../src/modules/projects/service.js';
import { createUser } from '../helpers/auth.js';
import { closeAll, resetDb } from '../helpers/db.js';
import { insertAsset, videoDoc } from './helpers.js';

const app = createApp({ log: { error() {} } });

let project;
let other;

beforeEach(async () => {
  await resetDb();
  const alice = await createUser(app);
  project = await createProject(alice.user.id, { name: 'Mine' });
  other = await createProject(alice.user.id, { name: 'Other' });
});
afterAll(closeAll);

describe('checkTimelineDoc(projectId, doc)', () => {
  it('accepts clips on the project\'s own assets', async () => {
    const asset = await insertAsset(project.id, { durationMs: 20_000 });
    expect(await checkTimelineDoc(project.id, videoDoc(asset.id))).toEqual([]);
  });

  it('rejects an asset from another project as not found', async () => {
    const foreign = await insertAsset(other.id, { durationMs: 20_000 });
    const issues = await checkTimelineDoc(project.id, videoDoc(foreign.id));
    expect(issues).toEqual([expect.objectContaining({ code: 'asset_not_found', path: ['tracks', 0, 'clips', 0, 'assetId'] })]);
  });

  it('checks the source range against the stored duration', async () => {
    const asset = await insertAsset(project.id, { durationMs: 3_000 });
    const issues = await checkTimelineDoc(project.id, videoDoc(asset.id, { sourceOutMs: 4_000 }));
    expect(issues).toEqual([expect.objectContaining({ code: 'source_out_of_range', path: ['tracks', 0, 'clips', 0, 'sourceOutMs'] })]);
  });

  it('assertTimelineDoc throws 400 validation_failed with prefixed paths', async () => {
    const err = await assertTimelineDoc(project.id, { schemaVersion: 1 }, ['doc']).catch((e) => e);
    expect(err).toMatchObject({ status: 400, code: 'validation_failed' });
    expect(err.details).toContainEqual(expect.objectContaining({ path: ['doc', 'output'] }));
  });
});
