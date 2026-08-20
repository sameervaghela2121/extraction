FROM python:3.14-slim
WORKDIR /app

# opencv-python-headless still needs libglib2.0 even without the GL/X11 deps it skips
RUN apt-get update && apt-get install -y --no-install-recommends libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY api/requirements.txt ./requirements.txt
# CPU-only torch first: easyocr's dependency is then already satisfied, so pip never
# reaches for the CUDA build from PyPI.
RUN pip install --no-cache-dir torch torchvision \
        --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt

# Bake the OCR weights (~94MB) into the image. Otherwise every fresh container downloads
# them on the first roll-label request — a slow first call, and a hard failure wherever
# egress is locked down.
RUN python -c "import easyocr; easyocr.Reader(['en'], gpu=False, verbose=False)"

COPY api ./api

EXPOSE 8080
CMD ["python", "api/main.py"]
