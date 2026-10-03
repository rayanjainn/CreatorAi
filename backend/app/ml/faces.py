"""Face-centred reframing (Plan.md section 8.8 step 8): ``crop_x`` from OpenCV Haar detection.

The proxy video is sampled once per second inside each range; every frame runs the bundled
``haarcascade_frontalface_default.xml`` (``scaleFactor=1.1``, ``minNeighbors=5``,
``minSize=proxy_height/10``), the largest face's centre x (0..1 of the frame width) is kept, and the
range's ``crop_x`` is the **median** of those, or ``0.5`` when no face was found anywhere. Any
failure (missing file, unreadable video) also yields 0.5: reframing must never break clips.
"""

from __future__ import annotations

import logging
import statistics
from collections.abc import Sequence
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

DEFAULT_CROP_X = 0.5
CASCADE_FILE = "haarcascade_frontalface_default.xml"
SAMPLE_STEP_SEC = 1.0


def largest_face_center(faces: Sequence[Sequence[int]], frame_width: int) -> float | None:
    """Centre x (0..1) of the largest ``(x, y, w, h)`` face, or None when there is none."""
    if not len(faces) or frame_width <= 0:
        return None
    x, _, w, _ = max(faces, key=lambda f: int(f[2]) * int(f[3]))
    return max(0.0, min(1.0, (float(x) + float(w) / 2.0) / frame_width))


def median_crop(centers: Sequence[float]) -> float:
    """Median of the per-frame centres; ``0.5`` when empty. Rounded to 3 decimals."""
    return round(statistics.median(centers), 3) if centers else DEFAULT_CROP_X


def sample_times(start: float, end: float, step: float = SAMPLE_STEP_SEC) -> list[float]:
    """Once per second inside ``[start, end)``, always at least one sample (the middle)."""
    times = []
    t = start
    while t < end - 1e-9:
        times.append(round(t, 3))
        t += step
    return times or [round((start + end) / 2, 3)]


def _cascade() -> Any:
    import cv2

    cascade = cv2.CascadeClassifier(str(Path(cv2.data.haarcascades) / CASCADE_FILE))
    if cascade.empty():
        raise RuntimeError("Haar cascade could not be loaded")
    return cascade


def crop_x_for_ranges(video_path: Path, ranges: Sequence[tuple[float, float]]) -> list[float]:
    """``crop_x`` for each ``(start, end)`` second range of ``video_path`` (module docstring)."""
    try:
        import cv2

        cascade = _cascade()
        capture = cv2.VideoCapture(str(video_path))
        if not capture.isOpened():
            raise RuntimeError("video could not be opened")
    except Exception as exc:
        log.warning("face detection unavailable (%s); using crop_x=0.5", exc)
        return [DEFAULT_CROP_X for _ in ranges]
    out: list[float] = []
    try:
        for start, end in ranges:
            centers: list[float] = []
            for t in sample_times(start, end):
                capture.set(cv2.CAP_PROP_POS_MSEC, t * 1000.0)
                ok, frame = capture.read()
                if not ok or frame is None:
                    continue
                height, width = frame.shape[:2]
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                size = max(8, height // 10)
                faces = cascade.detectMultiScale(
                    gray, scaleFactor=1.1, minNeighbors=5, minSize=(size, size)
                )
                center = largest_face_center(faces, width)
                if center is not None:
                    centers.append(center)
            out.append(median_crop(centers))
    except Exception as exc:
        log.warning("face detection failed (%s); using crop_x=0.5", exc)
        out += [DEFAULT_CROP_X] * (len(ranges) - len(out))
    finally:
        capture.release()
    return out
