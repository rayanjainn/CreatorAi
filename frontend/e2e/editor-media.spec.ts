import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { API, apiGet, authHeaders, heroId, login } from "./helpers";

/**
 * Media dropped into the editor: files chosen from the computer are uploaded to the library in `light` mode (no AI key
 * needed) and added to the timeline; the library shows them. Leaves nothing behind (the library and project specs expect an
 * empty audio list): the test undoes its edits and deletes the two assets it created.
 */
test.describe.configure({ mode: "serial" });

type Timeline = {
  tracks: {
    video: { id: string; kind: string; asset_id: string; status: string }[];
    audio: { id: string; asset_id: string }[];
  };
};
type Asset = {
  id: string;
  kind: string;
  filename: string;
  status: string;
  analysis: { mode?: string };
};

test("upload a picture and a song in the editor: both land in the library and on the timeline", async ({
  page,
  request,
}) => {
  const hero = await heroId(request);
  const clips = (
    await apiGet<{ id: string; kind: string }[]>(
      request,
      `/content/${hero}/clips`,
    )
  ).filter((c) => c.kind === "short");
  const clipId = clips[clips.length - 1].id;
  const before = await apiGet<{ revision: number; timeline: Timeline }>(
    request,
    `/clips/${clipId}/edit`,
  );

  const dir = join(tmpdir(), "creatorai-e2e-editor-media");
  mkdirSync(dir, { recursive: true });
  const stamp = Date.now().toString(36);
  const png = join(dir, `still-${stamp}.png`);
  const wav = join(dir, `bed-${stamp}.wav`);
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=320x240:duration=1",
    "-frames:v",
    "1",
    png,
  ]);
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=3",
    wav,
  ]);

  const created: string[] = []; // asset ids to delete whatever happens (the library spec expects a clean library)
  try {
    await login(page);
    await page.goto(`/editor/${clipId}`);
    await expect(page.getByTestId("timeline")).toBeVisible();
    await page.getByTestId("tab-media").click();
    await expect(page.getByTestId("media-dropzone")).toContainText("Add media");

    const videoCount = await page.getByTestId("tl-video-item").count();
    await page.getByTestId("media-input").setInputFiles([png, wav]);

    // the picture becomes a video-track item, the song an audio layer; both appear in the Media tab
    await expect(page.getByTestId("tl-video-item")).toHaveCount(
      videoCount + 1,
      { timeout: 60_000 },
    );
    await expect(
      page.getByTestId("lane-audio").getByRole("button"),
    ).toHaveCount(1, { timeout: 60_000 });
    await expect(
      page.getByTestId("media-row").filter({ hasText: `still-${stamp}.png` }),
    ).toBeVisible();
    await expect(
      page.getByTestId("media-row").filter({ hasText: `bed-${stamp}.wav` }),
    ).toBeVisible();
    await expect(page.getByTestId("save-status")).toHaveAttribute(
      "data-status",
      "saved",
      { timeout: 20_000 },
    );
    // no "not valid" toast and no decode notice for the still
    await expect(page.getByText("This timeline is not valid")).toHaveCount(0);

    // the server agrees: a kind=image item with the new asset, saved as a later revision
    const after = await apiGet<{ revision: number; timeline: Timeline }>(
      request,
      `/clips/${clipId}/edit`,
    );
    expect(after.revision).toBeGreaterThan(before.revision);
    const still = after.timeline.tracks.video.find((v) => v.kind === "image");
    expect(still).toBeTruthy();
    const assets = (
      await apiGet<{ items: Asset[] }>(request, "/assets?limit=100")
    ).items;
    const stillAsset = assets.find((a) => a.id === still!.asset_id)!;
    const songAsset = assets.find((a) => a.filename === `bed-${stamp}.wav`)!;
    created.push(stillAsset.id, songAsset.id);
    expect(stillAsset.kind).toBe("image");
    const detail = await apiGet<Asset>(request, `/assets/${stillAsset.id}`);
    expect(detail.analysis.mode).toBe("light"); // no transcript, captions or embeddings were needed
    expect(songAsset.kind).toBe("audio");
    expect(
      after.timeline.tracks.audio.some((a) => a.asset_id === songAsset.id),
    ).toBe(true);

    // clicking the picture shows its inspector, and the monitor needs no proxy for a still
    await page
      .getByTestId("tl-video-item")
      .filter({ hasText: "Image" })
      .first()
      .click();
    await expect(page.getByTestId("engine-notice")).toHaveCount(0);

    // clean up: undo both additions, wait for the save, delete the assets
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.getByTestId("header-undo").click();
    await page.getByTestId("header-undo").click();
    await expect(page.getByTestId("save-status")).toHaveAttribute(
      "data-status",
      "saved",
      { timeout: 20_000 },
    );
    const clean = await apiGet<{ timeline: Timeline }>(
      request,
      `/clips/${clipId}/edit`,
    );
    expect(clean.timeline.tracks.video.some((v) => v.kind === "image")).toBe(
      false,
    );
    expect(clean.timeline.tracks.audio.length).toBe(
      before.timeline.tracks.audio.length,
    );
  } finally {
    const headers = await authHeaders(request);
    const all = (await apiGet<{ items: Asset[] }>(request, "/assets?limit=100"))
      .items;
    for (const a of all.filter(
      (x) =>
        x.filename.endsWith(`${stamp}.png`) ||
        x.filename.endsWith(`${stamp}.wav`) ||
        created.includes(x.id),
    ))
      await request.delete(`${API}/api/v1/assets/${a.id}`, { headers });
  }
});

test("panels resize and collapse, and the layout is remembered", async ({
  page,
  request,
}) => {
  const hero = await heroId(request);
  const clips = (
    await apiGet<{ id: string; kind: string }[]>(
      request,
      `/content/${hero}/clips`,
    )
  ).filter((c) => c.kind === "short");
  await login(page);
  await page.goto(`/editor/${clips[0].id}`);
  await expect(page.getByTestId("timeline")).toBeVisible();

  const h0 = (await page.getByTestId("timeline").boundingBox())!.height;
  const bar = (await page.getByTestId("split-timeline").boundingBox())!;
  await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
  await page.mouse.down();
  await page.mouse.move(bar.x + bar.width / 2, bar.y + 40, { steps: 6 });
  await page.mouse.move(bar.x + bar.width / 2, bar.y + 80, { steps: 6 });
  await page.mouse.up();
  const h1 = (await page.getByTestId("timeline").boundingBox())!.height;
  expect(h1).toBeLessThan(h0 - 40);

  // keyboard: the splitters are focusable separators
  await page.getByTestId("split-right").focus();
  const w0 = (await page.getByTestId("inspector").boundingBox())!.width;
  await page.keyboard.press("ArrowLeft"); // grows the inspector
  await expect
    .poll(
      async () => (await page.getByTestId("inspector").boundingBox())!.width,
    )
    .toBeGreaterThan(w0);

  // collapsing hides the panel, and a reload remembers the sizes
  await page.getByTestId("toggle-right").click();
  await expect(page.getByTestId("inspector")).toHaveCount(0);
  await page.getByTestId("toggle-right").click();
  await expect(page.getByTestId("inspector")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("timeline")).toBeVisible();
  await expect
    .poll(async () =>
      Math.round((await page.getByTestId("timeline").boundingBox())!.height),
    )
    .toBeLessThan(h0 - 40);

  // the inspector never needs a horizontal scrollbar
  await page.getByTestId("inspector-tab-project").click();
  const overflow = await page
    .locator(".insp-body")
    .evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  await page.getByTestId("reset-layout").click();
  await expect
    .poll(async () =>
      Math.round((await page.getByTestId("timeline").boundingBox())!.height),
    )
    .toBeGreaterThan(h1);
});
