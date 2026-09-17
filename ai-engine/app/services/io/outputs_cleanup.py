import asyncio
import logging
import os
import shutil
from pathlib import Path
from typing import Optional

logger = logging.getLogger("vexcad.outputs_cleanup")

def perform_cleanup(
    outputs_dir: Path,
    logs_dir: Optional[Path] = None,
    max_age_seconds: int = 86400,  # 24 hours
    max_size_bytes: int = 2 * 1024 * 1024 * 1024,  # 2 GB
) -> None:
    """
    Cleans up the outputs and logs directories:
    1. Removes any files or subdirectories older than `max_age_seconds`.
    2. Prunes validation failure log dumps in logs_dir older than `max_age_seconds`.
    3. If the total directory size exceeds `max_size_bytes`, prunes files starting from
       the oldest (FIFO/LRU using last-modified time) until the size is under the threshold.
    """
    import time
    current_time = time.time()

    # Clean up logs directory if provided
    if logs_dir and logs_dir.exists():
        for item in list(logs_dir.iterdir()):
            try:
                if item.is_file() and (item.name.startswith("validation_fail_") or item.name.endswith(".log")):
                    age = current_time - item.stat().st_mtime
                    if age > max_age_seconds:
                        item.unlink()
                        logger.info(f"Removed expired diagnostic log: {item.name}")
            except Exception as exc:
                logger.warning(f"Error checking/deleting log {item.name}: {exc}")

    if not outputs_dir.exists():
        return

    logger.info(f"Starting outputs directory cleanup for {outputs_dir}")

    for item in list(outputs_dir.iterdir()):
        try:
            # We check the last modified time
            mtime = item.stat().st_mtime
            age = current_time - mtime
            if age > max_age_seconds:
                if item.is_file():
                    item.unlink()
                    logger.info(f"Removed expired file due to age: {item.name} ({age:.1f}s old)")
                elif item.is_dir():
                    shutil.rmtree(item)
                    logger.info(f"Removed expired directory due to age: {item.name} ({age:.1f}s old)")
        except Exception as exc:
            logger.warning(f"Error checking/deleting expired item {item.name}: {exc}")

    # 2. Enforce total storage limit (LRU / FIFO pruning)
    try:
        all_files = []
        total_size = 0
        
        # Traverse recursively to find all files and calculate size
        for root, _, files in os.walk(outputs_dir):
            for file in files:
                file_path = Path(root) / file
                try:
                    stat_info = file_path.stat()
                    all_files.append((file_path, stat_info.st_size, stat_info.st_mtime))
                    total_size += stat_info.st_size
                except Exception:
                    pass

        logger.info(f"Current outputs total size: {total_size / (1024 * 1024):.2f} MB / {max_size_bytes / (1024 * 1024):.2f} MB")

        if total_size > max_size_bytes:
            # Sort files by modification time (oldest first)
            all_files.sort(key=lambda x: x[2])
            
            for file_path, size, _ in all_files:
                if total_size <= max_size_bytes:
                    break
                try:
                    file_path.unlink()
                    total_size -= size
                    logger.info(f"Pruned oldest file to free space: {file_path.name} ({size / 1024:.1f} KB)")
                except Exception as exc:
                    logger.warning(f"Failed to prune file {file_path.name}: {exc}")
                    
            # Clean up any empty folders left behind
            for root, dirs, _ in os.walk(outputs_dir, topdown=False):
                for d in dirs:
                    dir_path = Path(root) / d
                    try:
                        if not any(dir_path.iterdir()):
                            dir_path.rmdir()
                            logger.info(f"Removed empty directory: {dir_path.name}")
                    except Exception:
                        pass
    except Exception as exc:
        logger.error(f"Error during capacity-based cleanup: {exc}")


async def start_cleanup_task(
    outputs_dir: Path,
    logs_dir: Optional[Path] = None,
    interval_seconds: int = 3600,
    max_age_seconds: int = 86400,
    max_size_bytes: int = 2 * 1024 * 1024 * 1024,
) -> None:
    """
    Asynchronous periodic task to clean up the outputs and logs directories.
    """
    logger.info(f"Starting background cleanup loop with interval {interval_seconds}s")
    while True:
        try:
            # Run the cleanup in a thread pool to avoid blocking the main async loop
            await asyncio.to_thread(
                perform_cleanup,
                outputs_dir=outputs_dir,
                logs_dir=logs_dir,
                max_age_seconds=max_age_seconds,
                max_size_bytes=max_size_bytes,
            )
        except Exception as exc:
            logger.error(f"Background cleanup task exception: {exc}")
        await asyncio.sleep(interval_seconds)
