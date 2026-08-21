"""
Roll-label OCR.

Kept out of main.py because it shares nothing with the Gemini invoice pipeline: no LLM,
no API key, no network. EasyOCR runs locally on CPU and reads the text off a photo of a
material roll's label; the Node backend does the field parsing.

Why EasyOCR and not tesseract (which the Node service already has): a roll label is
wrapped around a cylinder, so every line of text is an arc. Tesseract needs straight
page-level baselines and scores ~0.3 on these photos with the digits transposed. EasyOCR
detects each text region separately and rectifies it before recognition, which is exactly
the shape of this problem. Measured on a real roll photo: 6/6 fields vs 0/6.
"""

import io
import logging
import time
from threading import Lock

import cv2
import numpy as np
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

log = logging.getLogger("uvicorn.error")

# 1600px square is the measured knee of the curve on a 2992px phone photo:
#   1200px -> 5.4s, 5/6 fields
#   1600px -> 10.8s, 6/6 fields      <- here
#   2992px -> 30.8s, 6/6 fields
# Anything larger costs seconds and reads nothing extra.
OCR_INPUT_SIZE = 1600

# Two text boxes belong to the same line when their vertical centres are within this
# fraction of the image height. The label's rows are far enough apart that this is a
# comfortable margin rather than a tuned constant.
LINE_TOLERANCE = 0.015

_reader = None
_reader_lock = Lock()


def warm_up() -> bool:
    """Load the model at server startup instead of inside the first request.

    Deserializing 94MB of weights takes ~30s on a cold CPU instance. Paid here, it lands
    in Cloud Run's startup window — which is CPU-boosted and which the platform waits on
    before routing traffic. Paid lazily, it lands on whichever operator happens to scan
    the first label, turning an 11s read into a 50s one.

    Never fatal: this service's main job is Gemini invoice extraction, which does not
    touch OCR at all. Broken weights must not stop it from starting — the lazy path in
    _get_reader() still runs, and only roll-label reads are slow or fail.
    """
    try:
        _get_reader()
        return True
    except Exception:
        log.exception("[ocr] model warm-up failed; falling back to loading on first use")
        return False


def _get_reader():
    """Load the model once, on first use.

    Not at import time: the model is ~94MB of weights and most requests to this service
    are invoice extractions that never touch OCR. Locked because uvicorn can start two
    requests before the first finishes loading, and EasyOCR's init is not reentrant.
    """
    global _reader
    if _reader is None:
        with _reader_lock:
            if _reader is None:
                import easyocr  # imported here so the process starts without torch loaded

                started = time.time()
                _reader = easyocr.Reader(["en"], gpu=False, verbose=False)
                log.info("[ocr] easyocr model loaded in %.1fs", time.time() - started)
    return _reader


def _to_lines(results, image_height: int) -> list[str]:
    """Group the detected boxes back into reading order.

    EasyOCR returns each text region independently, so "gsm" and the "80" printed under
    it arrive as unrelated boxes. The Node parser reads captions and the values beneath
    them, which only works if the lines are reassembled top-to-bottom, left-to-right.
    """
    boxes = []
    for box, text, conf in results:
        ys = [point[1] for point in box]
        xs = [point[0] for point in box]
        boxes.append({"y": sum(ys) / len(ys), "x": min(xs), "text": text, "conf": conf})

    boxes.sort(key=lambda b: (b["y"], b["x"]))

    lines: list[list[dict]] = []
    tolerance = image_height * LINE_TOLERANCE
    for box in boxes:
        if lines and abs(box["y"] - lines[-1][0]["y"]) <= tolerance:
            lines[-1].append(box)
        else:
            lines.append([box])

    return [" ".join(b["text"] for b in sorted(line, key=lambda b: b["x"])) for line in lines]


def read_label(image_bytes: bytes) -> dict:
    """OCR one label photo. Returns the text lines plus the mean word confidence."""
    array = np.frombuffer(image_bytes, dtype=np.uint8)
    image = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=400, detail="that file could not be read as an image")

    height, width = image.shape[:2]
    scale = OCR_INPUT_SIZE / max(height, width)
    if scale < 1:
        image = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)

    started = time.time()
    results = _get_reader().readtext(image, detail=1, paragraph=False)
    log.info("[ocr] %d blocks in %.1fs", len(results), time.time() - started)

    confidences = [conf for _box, _text, conf in results]
    mean_confidence = round(sum(confidences) / len(confidences), 3) if confidences else 0.0

    # Words carry their box because text alone cannot resolve this label: several
    # caption/value pairs share a row ("Order-no." and "Width" side by side, their values
    # side by side underneath), so the parser has to ask which value sits *below* which
    # caption. Lines are sent too, for engines and labels where that is enough.
    words = [
        {
            "text": text,
            "x": round(min(p[0] for p in box)),
            "y": round(min(p[1] for p in box)),
            "w": round(max(p[0] for p in box) - min(p[0] for p in box)),
            "h": round(max(p[1] for p in box) - min(p[1] for p in box)),
            "conf": round(float(conf), 3),
        }
        for box, text, conf in results
    ]

    return {
        "lines": _to_lines(results, image.shape[0]),
        "words": words,
        "confidence": mean_confidence,
    }


def build_router(require_token) -> APIRouter:
    """Router factory so the auth dependency stays owned by main.py."""
    router = APIRouter(prefix="/ocr", tags=["ocr"])

    # Deliberately `def`, not `async def`. read_label() is ~11s of blocking CPU work, and
    # on the event loop it would freeze the whole service — health checks and in-flight
    # invoice extractions included — for the duration of every scan. Declared sync,
    # FastAPI runs it in a threadpool instead. The read is .file.read() for the same
    # reason: no await available in a sync endpoint.
    @router.post("/roll-label", dependencies=[Depends(require_token)])
    def roll_label(photo: UploadFile = File(...)) -> dict:
        content = photo.file.read()
        if not content:
            raise HTTPException(status_code=400, detail="empty upload")
        return read_label(content)

    return router
