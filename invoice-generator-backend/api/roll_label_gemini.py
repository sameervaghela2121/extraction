"""
Roll-label reading via Gemini — a second engine, on its own route.

Why a separate module and a separate route rather than a change to roll_label_ocr.py:
the two approaches fail in completely different ways, and the EasyOCR path is the one in
production use. It must not move while this is being proven.

The real difference is where the *parsing* happens. EasyOCR returns text boxes and the
Node service works out which value sits under which caption by pixel geometry — fitted
to the label layouts we happened to have, and wrong on the ones we didn't (width read as
the paper width, or as the neighbouring order number). Gemini is asked for the fields
directly, so a layout it has never seen is just another image rather than a new case to
hand-tune.

Cost: a network call and a fraction of a cent per read, against ~8-11s of local CPU.
"""

import json
import logging
import os
import time

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

log = logging.getLogger("uvicorn.error")

# Same model the invoice pipeline uses. Flash, not Pro: this is transcription off a
# photo, not reasoning, and the latency is the whole point of the route.
MODEL = "gemini-3.5-flash"

# One small image. If it has not answered by now something is wrong with the call, and
# the operator is better served by an error than by waiting.
TIMEOUT_MS = int(os.environ.get("ROLL_LABEL_AI_TIMEOUT_MS", "45000"))

# Phone photos are 2-4MB and the model gains nothing from the extra pixels; the bytes are
# pure upload latency. Same reasoning as OCR_INPUT_SIZE in the EasyOCR path.
MAX_EDGE_PX = 1600

PROMPT = """You are reading a printed label on a roll of decor paper.

Return ONLY this JSON object:
{
  "roll_number": string or null,
  "gsm": number or null,
  "width_mm": number or null,
  "weight_kg": number or null,
  "batch_no": string or null,
  "confidence": number between 0 and 1,
  "raw_text": string
}

Rules:
- Transcribe what is printed. Never infer, complete or correct a value.
- A field you cannot read clearly is null. A wrong number is far worse than a null,
  because the operator will accept it without checking.
- The label is wrapped around a cylinder, so lines curve and the edges are distorted.
- Captions and their values sit in columns: a value belongs to the caption ABOVE it,
  not to the caption beside it. Getting this wrong swaps the width with the order number.
- width_mm: labels print "Width Paper/Print" as "1270/1250", meaning paper width then
  print width. Return the SECOND number (the print width, 1250 here). Digits only.
- gsm: grams per square metre, usually 2-3 digits.
- weight_kg: the roll's weight in kilograms. Prefer net weight; if only a gross weight
  is printed, return that. Never return null just because the label says "gross".
- roll_number: the value under "Roll-no.", digits only, dropping any leading letters.
- batch_no: the value under "Decor-no.", "Batch-no." or "Lot-no.", exactly as printed.
- confidence: your own honest read quality. Low if the photo is blurred, angled, or the
  print is damaged or dirty.
- raw_text: every line of text you can see on the label, newline separated.
"""


def _as_text(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _as_number(value) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return float(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def _resize(image_bytes: bytes) -> bytes:
    """Shrink to MAX_EDGE_PX. Falls back to the original bytes on any failure — a failed
    resize must not fail the read, it only costs upload time."""
    try:
        import cv2
        import numpy as np

        array = np.frombuffer(image_bytes, dtype=np.uint8)
        image = cv2.imdecode(array, cv2.IMREAD_COLOR)
        if image is None:
            raise HTTPException(status_code=400, detail="that file could not be read as an image")
        height, width = image.shape[:2]
        scale = MAX_EDGE_PX / max(height, width)
        if scale < 1:
            image = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
        ok, buf = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 90])
        if ok:
            return buf.tobytes()
    except HTTPException:
        raise
    except Exception:
        log.exception("[ocr-ai] resize failed, sending the original bytes")
    return image_bytes


def _config(types):
    """Generation config, with thinking disabled where the SDK supports it.

    Guarded rather than assumed: ThinkingConfig is not present in every google-genai
    version, and a missing attribute must degrade to a slower read, never a broken route.
    """
    common = {
        "response_mime_type": "application/json",
        "temperature": 0,
        "max_output_tokens": 2048,
    }
    try:
        return types.GenerateContentConfig(
            **common,
            thinking_config=types.ThinkingConfig(thinking_budget=0),
        )
    except (AttributeError, TypeError):
        log.warning("[ocr-ai] ThinkingConfig unavailable in this SDK; reads will be slower")
        return types.GenerateContentConfig(**common)


def read_label_ai(image_bytes: bytes) -> dict:
    """Ask Gemini for the label's fields. Returns them plus a confidence and raw_text."""
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not set in environment/.env")

    from google import genai
    from google.genai import types

    data = _resize(image_bytes)

    client = genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=TIMEOUT_MS))
    started = time.perf_counter()
    try:
        response = client.models.generate_content(
            model=MODEL,
            contents=[types.Part.from_bytes(data=data, mime_type="image/jpeg"), PROMPT],
            # temperature=0: transcription, not generation. The same photo must give the
            # same answer twice, or an operator re-scanning a bad read gets a new guess.
            #
            # thinking_budget=0: measured 17.3s with thinking on, against 8s for local
            # EasyOCR — which defeats the only reason to call out to a model at all.
            # Reading printed text off a label needs no deliberation.
            config=_config(types),
        )
    except Exception as exc:
        log.exception("[ocr-ai] gemini call failed")
        raise HTTPException(status_code=502, detail=f"label read failed: {exc}") from exc
    elapsed = time.perf_counter() - started

    try:
        parsed = json.loads(response.text)
    except (json.JSONDecodeError, TypeError) as exc:
        log.warning("[ocr-ai] non-JSON output: %s", exc)
        raise HTTPException(status_code=502, detail="the label read returned malformed output")

    if not isinstance(parsed, dict):
        raise HTTPException(status_code=502, detail="the label read returned an unexpected shape")

    log.info("[ocr-ai] read in %.1fs", elapsed)

    # Normalised rather than trusted: the model is asked for the right types, but a
    # string "80" or a missing key must not reach Node as a surprise.
    return {
        "roll_number": _as_text(parsed.get("roll_number")),
        "gsm": _as_number(parsed.get("gsm")),
        "width_mm": _as_number(parsed.get("width_mm")),
        "weight_kg": _as_number(parsed.get("weight_kg")),
        "batch_no": _as_text(parsed.get("batch_no")),
        "confidence": _as_number(parsed.get("confidence")) or 0.0,
        "raw_text": _as_text(parsed.get("raw_text")) or "",
        "elapsed_ms": round(elapsed * 1000),
    }


def build_router(require_token) -> APIRouter:
    """Router factory so the auth dependency stays owned by main.py."""
    router = APIRouter(prefix="/ocr", tags=["ocr"])

    # `def`, not `async def`: the SDK call blocks, and on the event loop it would stall
    # the whole service for its duration. FastAPI runs sync handlers in a threadpool.
    @router.post("/roll-label-ai", dependencies=[Depends(require_token)])
    def roll_label_ai(photo: UploadFile = File(...)) -> dict:
        content = photo.file.read()
        if not content:
            raise HTTPException(status_code=400, detail="empty upload")
        return read_label_ai(content)

    return router
