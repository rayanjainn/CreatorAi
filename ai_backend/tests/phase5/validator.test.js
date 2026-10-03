// P5.T1: Timeline JSON v1 schema and the pure semantic validator, tested through the
// timeline module's public API (service.js re-exports the schemas.js definitions).
import { describe, expect, it } from 'vitest';
import { TimelineDoc, emptyTimelineDoc, validateTimeline } from '../../src/modules/timeline/service.js';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const OTHER_PROJECT = '22222222-2222-4222-8222-222222222222';
const A1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const A2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const FOREIGN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const UNKNOWN = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const PENDING = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';

const asset = (id, durationMs, projectId = PROJECT) => ({
  id, projectId, kind: 'original', durationMs, width: 1920, height: 1080, status: 'uploaded',
});
const ASSETS = new Map([
  [A1, asset(A1, 20_000)],
  [A2, asset(A2, 60_000)],
  [FOREIGN, asset(FOREIGN, 20_000, OTHER_PROJECT)],
  [PENDING, asset(PENDING, null)],
]);

// A valid two-track doc; each invalid case below mutates a fresh copy.
function validDoc() {
  return {
    schemaVersion: 1,
    output: { width: 1080, height: 1920, fps: 30 },
    tracks: [
      {
        id: 'v1',
        type: 'video',
        clips: [
          { id: 'c1', assetId: A1, sourceInMs: 12_000, sourceOutMs: 19_500, startMs: 0, volume: 1, label: 'hook' },
          { id: 'c2', assetId: A2, sourceInMs: 0, sourceOutMs: 5_000, startMs: 7_500, volume: 0.8 },
        ],
      },
      {
        id: 'cap',
        type: 'caption',
        clips: [
          { id: 't1', startMs: 0, endMs: 2_400, text: 'Hello' },
          { id: 't2', startMs: 2_400, endMs: 5_000, text: 'World' },
        ],
      },
    ],
  };
}

const run = (doc) => validateTimeline(doc, ASSETS, { projectId: PROJECT });

describe('valid timelines', () => {
  it('accepts the reference doc', () => {
    expect(run(validDoc())).toEqual([]);
    expect(TimelineDoc.parse(validDoc())).toEqual(validDoc());
  });

  it('accepts the empty doc', () => {
    expect(run(emptyTimelineDoc())).toEqual([]);
    expect(emptyTimelineDoc()).toEqual({ schemaVersion: 1, output: { width: 1080, height: 1920, fps: 30 }, tracks: [] });
  });

  it('accepts clips that touch end-to-start, a source range ending exactly at the duration, and unsorted clips', () => {
    const doc = validDoc();
    doc.tracks[0].clips = [
      { id: 'b', assetId: A1, sourceInMs: 15_000, sourceOutMs: 20_000, startMs: 5_000, volume: 0 },
      { id: 'a', assetId: A1, sourceInMs: 0, sourceOutMs: 5_000, startMs: 0, volume: 2 },
    ];
    expect(run(doc)).toEqual([]);
  });

  it('accepts a plain object as assetsById', () => {
    expect(validateTimeline(validDoc(), Object.fromEntries(ASSETS), { projectId: PROJECT })).toEqual([]);
  });

  it('accepts several video tracks and a timeline without captions', () => {
    const doc = validDoc();
    doc.tracks = [
      doc.tracks[0],
      { id: 'v2', type: 'video', clips: [{ id: 'c9', assetId: A1, sourceInMs: 0, sourceOutMs: 1_000, startMs: 0, volume: 1 }] },
    ];
    expect(run(doc)).toEqual([]);
  });
});

// [label, mutate(doc) or a replacement doc, expected path, expected code]
const INVALID = [
  ['bad schemaVersion', (d) => { d.schemaVersion = 2; }, ['schemaVersion'], 'invalid_value'],
  ['missing output', (d) => { delete d.output; }, ['output'], 'invalid_type'],
  ['zero output width', (d) => { d.output.width = 0; }, ['output', 'width'], 'too_small'],
  ['odd output height', (d) => { d.output.height = 1081; }, ['output', 'height'], 'not_multiple_of'],
  ['fractional fps', (d) => { d.output.fps = 29.97; }, ['output', 'fps'], 'invalid_type'],
  ['unknown top-level key', (d) => { d.extra = true; }, [], 'unrecognized_keys'],
  ['unknown track type', (d) => { d.tracks[1].type = 'audio'; }, ['tracks', 1, 'type'], 'invalid_union'],
  ['video clip without assetId', (d) => { delete d.tracks[0].clips[0].assetId; }, ['tracks', 0, 'clips', 0, 'assetId'], 'invalid_type'],
  ['negative startMs', (d) => { d.tracks[0].clips[0].startMs = -1; }, ['tracks', 0, 'clips', 0, 'startMs'], 'too_small'],
  ['negative sourceInMs', (d) => { d.tracks[0].clips[0].sourceInMs = -500; }, ['tracks', 0, 'clips', 0, 'sourceInMs'], 'too_small'],
  ['negative caption startMs', (d) => { d.tracks[1].clips[0].startMs = -10; }, ['tracks', 1, 'clips', 0, 'startMs'], 'too_small'],
  ['fractional ms', (d) => { d.tracks[0].clips[1].startMs = 7_500.5; }, ['tracks', 0, 'clips', 1, 'startMs'], 'invalid_type'],
  ['volume above 2', (d) => { d.tracks[0].clips[0].volume = 3; }, ['tracks', 0, 'clips', 0, 'volume'], 'too_big'],
  ['empty caption text', (d) => { d.tracks[1].clips[0].text = ''; }, ['tracks', 1, 'clips', 0, 'text'], 'too_small'],
  ['empty clip id', (d) => { d.tracks[0].clips[0].id = ''; }, ['tracks', 0, 'clips', 0, 'id'], 'too_small'],
  ['sourceOutMs equal to sourceInMs', (d) => { d.tracks[0].clips[0].sourceOutMs = 12_000; }, ['tracks', 0, 'clips', 0, 'sourceOutMs'], 'invalid_range'],
  ['sourceOutMs below sourceInMs', (d) => { d.tracks[0].clips[0].sourceOutMs = 1_000; }, ['tracks', 0, 'clips', 0, 'sourceOutMs'], 'invalid_range'],
  ['caption endMs equal to startMs', (d) => { d.tracks[1].clips[1].endMs = 2_400; }, ['tracks', 1, 'clips', 1, 'endMs'], 'invalid_range'],
  ['caption endMs below startMs', (d) => { d.tracks[1].clips[0].endMs = 0; }, ['tracks', 1, 'clips', 0, 'endMs'], 'invalid_range'],
  ['source range past the asset duration', (d) => { d.tracks[0].clips[0].sourceOutMs = 20_001; }, ['tracks', 0, 'clips', 0, 'sourceOutMs'], 'source_out_of_range'],
  ['sourceInMs past the asset duration', (d) => { Object.assign(d.tracks[0].clips[0], { sourceInMs: 25_000, sourceOutMs: 26_000 }); }, ['tracks', 0, 'clips', 0, 'sourceOutMs'], 'source_out_of_range'],
  ['unknown asset', (d) => { d.tracks[0].clips[1].assetId = UNKNOWN; }, ['tracks', 0, 'clips', 1, 'assetId'], 'asset_not_found'],
  ['malformed asset id', (d) => { d.tracks[0].clips[1].assetId = 'not-a-uuid'; }, ['tracks', 0, 'clips', 1, 'assetId'], 'invalid_format'],
  ['foreign-project asset', (d) => { d.tracks[0].clips[1].assetId = FOREIGN; }, ['tracks', 0, 'clips', 1, 'assetId'], 'asset_wrong_project'],
  ['asset without a known duration', (d) => { d.tracks[0].clips[1].assetId = PENDING; }, ['tracks', 0, 'clips', 1, 'assetId'], 'asset_duration_unknown'],
  ['overlapping video clips', (d) => { d.tracks[0].clips[1].startMs = 7_499; }, ['tracks', 0, 'clips', 1, 'startMs'], 'overlap'],
  ['overlapping caption clips', (d) => { d.tracks[1].clips[1].startMs = 2_000; }, ['tracks', 1, 'clips', 1, 'startMs'], 'overlap'],
  ['overlap reported on the later clip even when listed first', (d) => {
    d.tracks[0].clips.reverse();
    d.tracks[0].clips[0].startMs = 100;
  }, ['tracks', 0, 'clips', 0, 'startMs'], 'overlap'],
  ['duplicate clip id on one track', (d) => { d.tracks[0].clips[1].id = 'c1'; }, ['tracks', 0, 'clips', 1, 'id'], 'duplicate_id'],
  ['duplicate clip id across tracks', (d) => { d.tracks[1].clips[0].id = 'c1'; }, ['tracks', 1, 'clips', 0, 'id'], 'duplicate_id'],
  ['duplicate track id', (d) => { d.tracks[1].id = 'v1'; }, ['tracks', 1, 'id'], 'duplicate_id'],
  ['not an object', () => 'timeline', [], 'invalid_type'],
];

describe('invalid timelines', () => {
  it('has at least 12 cases', () => expect(INVALID.length).toBeGreaterThanOrEqual(12));

  it.each(INVALID)('rejects %s', (_label, mutate, path, code) => {
    let doc = validDoc();
    const replaced = mutate(doc);
    if (replaced !== undefined) doc = replaced;
    const issues = run(doc);
    expect(issues.length, JSON.stringify(issues)).toBeGreaterThan(0);
    expect(issues).toContainEqual(expect.objectContaining({ path, code, message: expect.any(String) }));
  });

  it('reports every semantic issue, not just the first', () => {
    const doc = validDoc();
    Object.assign(doc.tracks[0].clips[0], { sourceInMs: 15_000, sourceOutMs: 21_000 }); // out of range, still 6 s long
    doc.tracks[1].clips[1].id = 't1'; // duplicate
    const issues = run(doc);
    expect(issues.map((i) => i.code).sort()).toEqual(['duplicate_id', 'source_out_of_range']);
  });

  it('without a projectId, any asset in assetsById counts as the project\'s', () => {
    const doc = validDoc();
    doc.tracks[0].clips[1].assetId = FOREIGN;
    expect(validateTimeline(doc, ASSETS)).toEqual([]);
  });

  it('does not mutate its input', () => {
    const doc = validDoc();
    doc.tracks[0].clips.reverse();
    const before = JSON.stringify(doc);
    run(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });
});
