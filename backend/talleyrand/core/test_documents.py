import base64
import io

import pytest
from pypdf import PdfWriter

from talleyrand.core import documents
from talleyrand.core.documents import UnreadablePdfError, pdf_text


def _data_uri(pdf: bytes) -> str:
    return "data:application/pdf;base64," + base64.b64encode(pdf).decode()


def _text_pdf(text: str) -> bytes:
    """A one-page PDF whose text layer is `text`."""
    stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream),
    ]
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(out.tell())
        out.write(b"%d 0 obj\n%s\nendobj\n" % (number, body))
    xref = out.tell()
    out.write(b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1))
    out.writelines(b"%010d 00000 n \n" % offset for offset in offsets)
    out.write(
        b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref)
    )
    return out.getvalue()


def _blank_pdf(password: str | None = None) -> bytes:
    writer = PdfWriter()
    writer.add_blank_page(612, 792)
    if password:
        writer.encrypt(password, algorithm="RC4-128")
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def test_the_text_layer_is_extracted():
    assert pdf_text(_data_uri(_text_pdf("Treaty of Vienna"))) == "Treaty of Vienna"


def test_long_text_is_cut_and_says_so(monkeypatch):
    monkeypatch.setattr(documents, "MAX_CHARS", 6)
    assert pdf_text(_data_uri(_text_pdf("Treaty of Vienna"))) == (
        "Treaty" + documents.TRUNCATED_NOTICE
    )


def test_a_scan_with_no_text_is_refused():
    with pytest.raises(UnreadablePdfError, match="no text layer"):
        pdf_text(_data_uri(_blank_pdf()))


def test_a_password_protected_pdf_is_refused():
    with pytest.raises(UnreadablePdfError, match="password"):
        pdf_text(_data_uri(_blank_pdf(password="secret")))


@pytest.mark.parametrize("payload", [b"not a pdf at all", b"%PDF-1.4\n1 0 obj\n<<"])
def test_a_damaged_file_is_refused(payload):
    with pytest.raises(UnreadablePdfError, match="damaged"):
        pdf_text(_data_uri(payload))


def test_bad_base64_is_refused():
    with pytest.raises(UnreadablePdfError, match="damaged"):
        pdf_text("data:application/pdf;base64,***")
