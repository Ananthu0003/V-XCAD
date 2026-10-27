"""Application package."""

def __getattr__(name: str):
    if name == "app":
        from app.main import app
        return app
    raise AttributeError(f"module '{__name__}' has no attribute '{name}'")
