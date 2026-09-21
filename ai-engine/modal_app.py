import modal
from pathlib import Path

# Create Modal App
app = modal.App("vexcad-ai-engine")

# Define the container image with all OpenCASCADE C++ CAD dependencies and Python packages
image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install(
        "build-essential",
        "libgl1",
        "libglib2.0-0",
        "libxrender1",
        "libxext6",
        "libgomp1",
    )
    .pip_install_from_requirements("requirements.txt")
    .add_local_dir("app", remote_path="/root/app")
    .add_local_dir("data", remote_path="/root/data", ignore=["*.pyc", "__pycache__"])
)

# Persistent volume for generated CAD models, STEP files, and logs
volume = modal.Volume.from_name("vexcad-storage", create_if_missing=True)


@app.function(
    image=image,
    secrets=[
        modal.Secret.from_name("vexcad-secrets"),
    ],
    volumes={
        "/root/outputs": volume,
    },
    timeout=300,
    memory=4096,  # 4 GB RAM per container (easily handles heavy 3D CAD operations)
    cpu=2.0,
)
@modal.asgi_app()
def fastapi_app():
    import sys
    sys.path.insert(0, "/root")
    
    Path("/root/outputs").mkdir(parents=True, exist_ok=True)
    Path("/root/logs").mkdir(parents=True, exist_ok=True)
    
    from app.main import app as web_app
    return web_app
