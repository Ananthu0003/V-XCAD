# ─────────────────────────────────────────────────────────────────────────────
# VexCAD AI Engine — Dockerfile
# Python 3.12 + FastAPI + build123d (cadquery-ocp)
# ─────────────────────────────────────────────────────────────────────────────

FROM python:3.12-slim

# System dependencies needed by build123d / OCP (OpenCASCADE via cadquery-ocp)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgl1 \
    libglib2.0-0 \
    libxrender1 \
    libxext6 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Create a non-root user for running the application and CAD subprocesses.
# Generated code will execute under this user, not root, reducing the blast
# radius of any code-execution vulnerability.
RUN groupadd -r caduser && useradd -r -g caduser -d /app -s /bin/bash caduser

WORKDIR /app

# Install Python dependencies first (layer-cached until requirements change)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the source
COPY . .

# Move entrypoint to root and make executable
RUN mv /app/docker-entrypoint.sh /docker-entrypoint.sh && chmod +x /docker-entrypoint.sh

# Create outputs and logs directories and set ownership for the non-root user.
RUN mkdir -p /app/outputs /app/logs && chown -R caduser:caduser /app

EXPOSE 8000
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]

