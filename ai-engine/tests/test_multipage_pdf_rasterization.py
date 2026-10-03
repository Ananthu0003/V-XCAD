import io
import fitz
import pytest
from PIL import Image
from app.api.v1.router import rasterize_pdf_to_image


def _create_sample_pdf(page_count: int, page_size=(300, 200)) -> bytes:
    doc = fitz.open()
    for i in range(page_count):
        page = doc.new_page(width=page_size[0], height=page_size[1])
        # Draw some text/rect on each page
        rect = fitz.Rect(20, 20, page_size[0] - 20, page_size[1] - 20)
        page.draw_rect(rect, color=(0, 0, 1), fill=(0.9, 0.9, i * 0.3 % 1.0))
        page.insert_text((50, 50), f"Blueprint Page {i + 1}", fontsize=18)
    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes


def test_rasterize_single_page_pdf():
    pdf_bytes = _create_sample_pdf(1, (400, 300))
    png_bytes = rasterize_pdf_to_image(pdf_bytes, dpi=72)
    assert png_bytes is not None
    assert len(png_bytes) > 0

    img = Image.open(io.BytesIO(png_bytes))
    assert img.format == "PNG"
    assert img.width == 400
    assert img.height == 300


def test_rasterize_multipage_pdf_stitches_pages():
    page_count = 3
    pdf_bytes = _create_sample_pdf(page_count, (400, 300))
    png_bytes = rasterize_pdf_to_image(pdf_bytes, dpi=72)
    assert png_bytes is not None
    assert len(png_bytes) > 0

    img = Image.open(io.BytesIO(png_bytes))
    assert img.format == "PNG"
    assert img.width == 400
    # Expected height: 3 * 300 + 2 * 24 (gap) = 948
    expected_height = (3 * 300) + (2 * 24)
    assert img.height == expected_height


def test_rasterize_empty_or_invalid_pdf():
    empty_bytes = b""
    assert rasterize_pdf_to_image(empty_bytes, dpi=72) == empty_bytes

    corrupt_bytes = b"not a valid pdf content"
    assert rasterize_pdf_to_image(corrupt_bytes, dpi=72) == corrupt_bytes


def test_max_upload_size_constant():
    from app.api.v1.router import MAX_UPLOAD_SIZE_BYTES
    assert MAX_UPLOAD_SIZE_BYTES == 10 * 1024 * 1024
