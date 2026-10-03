"""Timeline JSON -> ffmpeg ``filter_complex`` (Plan.md section 8.9, "Render graph").

Pure string building: no I/O, no ffmpeg calls, so every rule is unit-testable. Only non-rejected
items render. The caller runs ffmpeg with ``cwd`` = a temp dir holding the files named in the plan
(``captions.ass``, ``fonts/``, the card PNGs); nothing in the graph needs path escaping.

Per video item ``i`` (sorted by ``tl_start``)::

    [n:v] trim, setpts, (9:16 only: crop to ih*9/16 around crop_x), scale increase, crop, setsar,
          fps=30, format=yuv420p                                                        -> [v_i]
    [n:a] atrim, asetpts, aresample=48000, stereo fltp (or anullsrc when there is no audio) -> [a_i]
    sponsor placeholder: color #111111 + overlay of a Pillow card, anullsrc audio

Join: ``concat`` when every transition is a cut, otherwise a left fold where a fade/dissolve step
is ``xfade`` + ``acrossfade`` with ``offset = running - d`` (``running += dur - d``) and a cut step
is a two-input ``concat``. Overlays are ``overlay=enable='between(t,s,e)'`` on card PNGs, captions
are the ``subtitles`` filter (libass) or, without libass, Pillow PNG states overlaid from a
concat-demuxer input (``captions_png``), music/sfx/voiceover are mixed with ``amix``.

Transitions overlap neighbouring clips, so everything after one plays earlier than its timeline
time. :attr:`RenderPlan.time_map` converts timeline seconds to output seconds and is applied to
captions, overlays and audio items; :attr:`RenderPlan.duration` is the output length
(``timeline.duration`` minus the total overlap).

``amix`` before FFmpeg 7 has no ``normalize`` option and always divides each input by the input
count. Without the option the graph appends ``volume=<inputs>`` after the mix (all streams are
``apad``-ed so no input ends early and changes the scaling), which equals ``normalize=0``.
"""

from __future__ import annotations

import bisect
import functools
import subprocess
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field

from app.config import get_settings
from app.media.caption_support import resolve_caption_renderer
from app.media.captions_png import CaptionTrack, build_track
from app.schemas.timeline import AudioItem, OverlayItem, Timeline, VideoItem

FPS = 30
SEEK_PAD = 1.0  # input is seeked to src_in - 1 s, then trimmed exactly (keyframe safety)
PLACEHOLDER_BG = "#111111"
XFADE = {"fade": "fade", "dissolve": "dissolve"}


@dataclass(frozen=True)
class AssetSource:
    """What the graph needs to know about an input file."""

    path: str
    has_audio: bool = True
    width: int | None = None
    height: int | None = None


@dataclass(frozen=True)
class CardSpec:
    """A PNG the caller must create (``cards.render_card``) in the working directory."""

    filename: str
    kind: str  # sponsor_card | lower_third | text
    text: str


@dataclass
class RenderPlan:
    input_args: list[str]
    filter_complex: str
    output_args: list[str]
    duration: float  # expected output length in seconds
    cards: list[CardSpec] = field(default_factory=list)
    uses_captions: bool = False
    caption_renderer: str = "libass"  # libass | pillow (see media/caption_support.py)
    caption_track: CaptionTrack | None = None  # pillow: PNG states + lanes the caller must write
    time_map: Callable[[float], float] = lambda t: t
    amix_normalize: bool = True

    def ffmpeg_args(self) -> list[str]:
        """Arguments after the ffmpeg binary (``-y``/``-progress`` are added by the runner)."""
        return [*self.input_args, "-filter_complex", self.filter_complex, *self.output_args]


@functools.lru_cache(maxsize=1)
def amix_supports_normalize() -> bool:
    """True when the installed ffmpeg's ``amix`` has the ``normalize`` option (FFmpeg 7+)."""
    try:
        out = subprocess.run(
            [get_settings().ffmpeg_bin, "-hide_banner", "-h", "filter=amix"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return "normalize" in out.stdout


def _t(value: float) -> str:
    return f"{value:.3f}"


def _crop_expr(src: AssetSource | None, crop_x: float) -> str:
    """Face-centred 9:16 crop; empty when the source is already 9:16 or narrower."""
    if src and src.width and src.height and src.width / src.height <= 9 / 16 + 1e-6:
        return ""
    width = "ih*9/16" if src and src.width and src.height else "'min(iw,ih*9/16)'"
    x = f"'max(0,min(iw-out_w,{crop_x:.4f}*iw-out_w/2))'"
    return f"crop=w={width}:h=ih:x={x}:y=0,"


def build_plan(
    timeline: Timeline,
    assets: Mapping[str, AssetSource],
    *,
    x264_preset: str = "veryfast",
    output: str = "out.mp4",
    ass_name: str = "captions.ass",
    fonts_dir: str = "fonts",
    amix_normalize: bool | None = None,
    caption_renderer: str | None = None,
) -> RenderPlan:
    """Build the ffmpeg inputs, ``filter_complex`` and output options for ``timeline``.

    ``timeline`` must already be retargeted to the preset (aspect/size/caption style). Raises
    ``ValueError`` when there is nothing to render or an asset is missing from ``assets``.
    ``caption_renderer`` (``libass`` | ``pillow``) defaults to the ``CAPTION_RENDERER`` setting
    resolved against what this ffmpeg supports.
    """
    renderer = caption_renderer or resolve_caption_renderer()
    if amix_normalize is None:
        amix_normalize = amix_supports_normalize()
    width, height = timeline.width, timeline.height
    portrait = timeline.aspect == "9:16"
    active = (v for v in timeline.tracks.video if v.status != "rejected")
    items = sorted(active, key=lambda v: v.tl_start)
    if not items:
        raise ValueError("the timeline has no video to render")

    inputs: list[str] = []
    n_inputs = 0
    chains: list[str] = []
    cards: list[CardSpec] = []

    def add_input(*args: str) -> int:
        nonlocal n_inputs
        inputs.extend(args)
        n_inputs += 1
        return n_inputs - 1

    # ── per-item video and audio ─────────────────────────────────────────────────────────────
    for i, item in enumerate(items):
        dur = item.src_out - item.src_in
        if item.asset_id is None:  # sponsor placeholder: dark card + Pillow text card
            card = CardSpec(f"card_v{i}.png", "sponsor_card", item.text or "")
            cards.append(card)
            idx = add_input("-i", card.filename)
            chains.append(
                f"color=c={PLACEHOLDER_BG}:s={width}x{height}:r={FPS}:d={_t(dur)}[bg_{i}]"
            )
            chains.append(
                f"[bg_{i}][{idx}:v]overlay=0:0:format=auto,format=yuv420p,setsar=1[v_{i}]"
            )
            chains.append(_silence(dur, i))
            continue
        src = assets.get(item.asset_id)
        if src is None:
            raise ValueError(f"asset {item.asset_id} is not available for rendering")
        seek = max(0.0, item.src_in - SEEK_PAD)
        idx = add_input(*(["-ss", _t(seek)] if seek > 0 else []), "-i", src.path)
        start, end = item.src_in - seek, item.src_out - seek
        crop = _crop_expr(src, item.crop_x) if portrait else ""
        chains.append(
            f"[{idx}:v]trim=start={_t(start)}:end={_t(end)},setpts=PTS-STARTPTS,{crop}"
            f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},"
            f"setsar=1,fps={FPS},format=yuv420p[v_{i}]"
        )
        if src.has_audio:
            chains.append(
                f"[{idx}:a]atrim=start={_t(start)}:end={_t(end)},asetpts=PTS-STARTPTS,"
                f"aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a_{i}]"
            )
        else:
            chains.append(_silence(dur, i))

    # ── join ─────────────────────────────────────────────────────────────────────────────────
    durs = [v.src_out - v.src_in for v in items]
    overlaps = _overlaps(items, durs)
    if len(items) == 1:
        chains.append("[v_0]null[vj]")
        chains.append("[a_0]anull[aj]")
    elif not any(overlaps):
        refs = "".join(f"[v_{i}][a_{i}]" for i in range(len(items)))
        chains.append(f"{refs}concat=n={len(items)}:v=1:a=1[vj][aj]")
    else:
        cur_v, cur_a, running = "v_0", "a_0", durs[0]
        for k in range(1, len(items)):
            last = k == len(items) - 1
            out_v, out_a = ("vj", "aj") if last else (f"xv_{k}", f"xa_{k}")
            d = overlaps[k]
            if d > 0:
                kind = XFADE[(items[k].transition_in.type if items[k].transition_in else "fade")]
                chains.append(
                    f"[{cur_v}][v_{k}]xfade=transition={kind}:duration={_t(d)}:"
                    f"offset={_t(running - d)}[{out_v}]"
                )
                chains.append(f"[{cur_a}][a_{k}]acrossfade=d={_t(d)}[{out_a}]")
                running += durs[k] - d
            else:
                # concat outputs a 1/1000000 timebase; xfade wants the 1/30 of its other input
                chains.append(
                    f"[{cur_v}][{cur_a}][v_{k}][a_{k}]concat=n=2:v=1:a=1[cv_{k}][{out_a}]"
                )
                chains.append(f"[cv_{k}]fps={FPS}[{out_v}]")
                running += durs[k]
            cur_v, cur_a = out_v, out_a

    cum = [sum(overlaps[: k + 1]) for k in range(len(items))]
    bounds = [v.tl_start for v in items]
    out_duration = round(sum(durs) - cum[-1], 3)

    def time_map(t: float) -> float:
        """Timeline seconds -> output seconds (clips overlap during transitions)."""
        k = max(0, bisect.bisect_right(bounds, t + 1e-6) - 1)
        return max(0.0, t - cum[k])

    def end_map(t: float) -> float:
        return time_map(max(0.0, t - 1e-6)) + (1e-6 if t > 0 else 0.0)

    # ── overlays, captions ───────────────────────────────────────────────────────────────────
    cur = "vj"
    for j, ov in enumerate(o for o in timeline.tracks.overlays if o.status != "rejected"):
        s, e = time_map(ov.tl_start), min(end_map(ov.tl_end), out_duration)
        if e - s < 0.04:
            continue
        card = CardSpec(f"card_o{j}.png", _card_kind(ov), ov.text)
        cards.append(card)
        idx = add_input("-i", card.filename)
        chains.append(
            f"[{cur}][{idx}:v]overlay=0:0:format=auto:enable='between(t,{_t(s)},{_t(e)})'[ov{j}]"
        )
        cur = f"ov{j}"
    uses_captions = any(c.status != "rejected" for c in timeline.tracks.captions)
    track: CaptionTrack | None = None
    if uses_captions and renderer == "pillow":
        # One lane = captions that never overlap in time = ONE concat-demuxer input of PNG
        # states (blank frames in the gaps), overlaid once: no per-caption inputs or enables.
        track = build_track(timeline, time_map, out_duration)
        uses_captions = bool(track.lanes)
        for n in range(len(track.lanes)):
            idx = add_input("-f", "concat", "-safe", "0", "-i", track.lane_list_name(n))
            chains.append(f"[{cur}][{idx}:v]overlay=0:0:format=auto:eof_action=repeat[vcap{n}]")
            cur = f"vcap{n}"
    elif uses_captions:
        chains.append(f"[{cur}]subtitles=filename={ass_name}:fontsdir={fonts_dir}[vsub]")
        cur = "vsub"
    chains.append(f"[{cur}]format=yuv420p[vout]")

    # ── music / sfx / voiceover ──────────────────────────────────────────────────────────────
    mixes: list[str] = []
    for j, au in enumerate(a for a in timeline.tracks.audio if a.status != "rejected"):
        start = time_map(au.tl_start)
        if start >= out_duration - 0.05:
            continue
        src = assets.get(au.asset_id)
        if src is None:
            raise ValueError(f"asset {au.asset_id} is not available for rendering")
        idx = add_input("-i", src.path)
        end = min(au.src_out, au.src_in + (out_duration - start))
        chains.append(_audio_chain(idx, j, au, end, round(start * 1000)))
        mixes.append(f"[m_{j}]")
    if mixes:
        n = len(mixes) + 1
        norm = ":normalize=0" if amix_normalize else ""
        chains.append(f"[aj]{''.join(mixes)}amix=inputs={n}:duration=first{norm}[amixed]")
        if amix_normalize:
            chains.append("[amixed]anull[aout]")
        else:  # old amix divides by n: undo it (same result as normalize=0)
            chains.append(f"[amixed]volume={n}[aout]")
    else:
        chains.append("[aj]anull[aout]")

    output_args = [
        "-map", "[vout]", "-map", "[aout]",
        "-c:v", "libx264", "-preset", x264_preset, "-crf", "20", "-pix_fmt", "yuv420p",
        "-r", str(FPS), "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
        "-movflags", "+faststart", "-t", _t(out_duration), output,
    ]  # fmt: skip
    return RenderPlan(
        input_args=inputs,
        filter_complex=";".join(chains),
        output_args=output_args,
        duration=out_duration,
        cards=cards,
        uses_captions=uses_captions,
        caption_renderer=renderer,
        caption_track=track,
        time_map=time_map,
        amix_normalize=amix_normalize,
    )


def _overlaps(items: Sequence[VideoItem], durs: Sequence[float]) -> list[float]:
    """Transition length per item (0 for the first item, cuts and anything that cannot fit)."""
    out = [0.0]
    running = durs[0]
    for k in range(1, len(items)):
        tr = items[k].transition_in
        d = 0.0
        if tr and tr.type in XFADE and tr.dur > 0:
            d = max(0.0, min(tr.dur, durs[k] / 2, running / 2))
        out.append(d)
        running += durs[k] - d
    return out


def _silence(dur: float, i: int) -> str:
    return f"anullsrc=r=48000:cl=stereo:d={_t(dur)},aformat=sample_fmts=fltp[a_{i}]"


def _card_kind(ov: OverlayItem) -> str:
    return "sponsor_card" if ov.kind == "sponsor_card" else ov.kind


def _audio_chain(idx: int, j: int, au: AudioItem, end: float, delay_ms: int) -> str:
    return (
        f"[{idx}:a]atrim=start={_t(au.src_in)}:end={_t(max(end, au.src_in + 0.05))},"
        f"asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,"
        f"volume={au.gain_db:g}dB,adelay={delay_ms}|{delay_ms},apad[m_{j}]"
    )
