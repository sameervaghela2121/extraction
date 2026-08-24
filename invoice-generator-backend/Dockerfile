FROM python:3.14-slim
WORKDIR /app

# opencv-python-headless still needs libglib2.0 even without the GL/X11 deps it skips
RUN apt-get update && apt-get install -y --no-install-recommends libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY api/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY api ./api

EXPOSE 8080
CMD ["python", "api/main.py"]
