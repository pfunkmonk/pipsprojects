from pathlib import Path

from pypdf import PdfReader, PdfWriter


ROOT = Path(__file__).resolve().parents[1]
PDF_PATHS = (
    ROOT / "output/pdf/thunder-bowl-2026-emergency-auction-sheet.pdf",
    ROOT / "output/pdf/thunder-bowl-2026-emergency-auction-sheet-alphabetical.pdf",
)
EXPECTED_FIELDS = 400


def widgets(reader: PdfReader):
    return [
        annotation.get_object()
        for page in reader.pages
        for annotation in (page.get("/Annots") or [])
        if annotation.get_object().get("/Subtype") == "/Widget"
    ]


for path in PDF_PATHS:
    reader = PdfReader(path)
    fields = reader.get_fields() or {}
    page_widgets = widgets(reader)
    assert len(reader.pages) == 8, (path, len(reader.pages))
    assert len(fields) == EXPECTED_FIELDS, (path, len(fields))
    assert len(page_widgets) == EXPECTED_FIELDS, (path, len(page_widgets))
    assert len(set(fields)) == EXPECTED_FIELDS, path
    assert all(widget.get("/AP") and widget["/AP"].get("/N") for widget in page_widgets), path
    for widget in page_widgets:
        name = str(widget.get("/T"))
        widget_value = widget.get("/V") if widget.get("/V") is not None else ""
        field_value = fields[name].get("/V") if fields[name].get("/V") is not None else ""
        assert widget_value == field_value, (path, name, widget_value, field_value)
    print(f"FORM_OK {path.name} pages={len(reader.pages)} fields={len(fields)} widgets={len(page_widgets)}")


reader = PdfReader(PDF_PATHS[0])
writer = PdfWriter()
writer.clone_document_from_reader(reader)
names = list((writer.get_fields() or {}).keys())
team_field = next(name for name in names if name.startswith("drafted_by_"))
price_field = next(name for name in names if name.startswith("actual_price_"))
writer.update_page_form_field_values(
    None,
    {team_field: "Dogs of War", price_field: "37"},
    auto_regenerate=False,
)
test_path = ROOT / "tmp/pdfs/emergency-fill-save-test.pdf"
test_path.parent.mkdir(parents=True, exist_ok=True)
with test_path.open("wb") as stream:
    writer.write(stream)

reopened = PdfReader(test_path)
saved_fields = reopened.get_fields() or {}
assert str(saved_fields[team_field].get("/V")) == "Dogs of War"
assert str(saved_fields[price_field].get("/V")) == "37"
assert all(widget.get("/AP") and widget["/AP"].get("/N") for widget in widgets(reopened))
print(f"FILL_SAVE_OK fields={len(saved_fields)} team={saved_fields[team_field].get('/V')} price={saved_fields[price_field].get('/V')}")
