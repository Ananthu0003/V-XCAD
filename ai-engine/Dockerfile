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
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies first (layer-cached until requirements change)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the source
COPY . .

# Create outputs directory (mounted as a volume at runtime)
RUN mkdir -p /app/outputs

EXPOSE 8000

# Use the production server — no --reload in prod
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
