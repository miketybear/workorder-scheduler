import io
import zipfile
from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.rota.parser import RotaParseError, normalized_name, parse_rota
from app.rota.preview import candidates, preview, proposals, unmapped_message


def fixture_ods(
    code="1",
    position="Control RM Engineer",
    formula=False,
    company="BD POC",
    company_formula=False,
    mechanic_position="Mechanical Technician",
):
    rows = ["<table:table-row/>" for _ in range(3)]
    rows.append(
        '<table:table-row><table:table-cell table:number-columns-repeated="7"/>'
        '<table:table-cell office:date-value="2026-01-01"/>'
        '<table:table-cell office:date-value="2026-01-02" table:formula="of:=H4+1"/>'
        "</table:table-row>"
    )

    rows.append("<table:table-row/>")

    def text(value):
        return f"<table:table-cell><text:p>{value}</text:p></table:table-cell>"

    for craft, role in [
        ("P&amp;P", position),
        ("E&amp;I", "E&amp;I Technician"),
        ("RES", "RES"),
        ("MECHANIC", mechanic_position),
        ("DECK CREW", "Deck Crew"),
    ]:
        rows.append("<table:table-row>" + text("1") + text(craft) + "</table:table-row>")
        formula_attribute = ' table:formula="of:=1"' if formula else ""
        company_attribute = ' table:formula="of:=C1"' if company_formula else ""
        rows.append(
            "<table:table-row>"
            + text("Nguyen Van A")
            + text(role)
            + f"<table:table-cell{company_attribute}><text:p>{company}</text:p></table:table-cell>"
            + '<table:table-cell table:number-columns-repeated="4"/>'
            + f"<table:table-cell{formula_attribute}><text:p>{code}</text:p>"
            + "</table:table-cell><table:table-cell/></table:table-row>"
        )
    source = (
        '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
        'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" '
        'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">'
        '<table:table table:name="ROTA_2026">'
        + "".join(rows)
        + "</table:table></office:document-content>"
    )
    result = io.BytesIO()
    with zipfile.ZipFile(result, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("content.xml", source)
    return result.getvalue()


def test_native_ods_preserves_blank_and_included_roles():
    source = parse_rota(fixture_ods(), "rota.ods", "ROTA_2026")
    assert len(source["rows"]) == 5
    assert source["source_errors"] == []
    assert source["rows"][0]["role"] == "CONTROL_RM_ENGINEER"
    assert source["rows"][3]["role"] == "TECH"
    assert [d["capacity_hours"] for d in source["rows"][0]["days"]] == [10.5, 0]
    assert source["coverage_before"] == "2026-01-03"


@pytest.mark.parametrize(
    "kwargs",
    [{"code": "BAD"}, {"formula": True}, {"position": "Unknown technician"}, {"position": ""}],
)
def test_source_errors_are_blockers(kwargs):
    source = parse_rota(fixture_ods(**kwargs), "rota.ods", "ROTA_2026")
    assert source["rows"][0]["issues"]


def test_normalization_is_candidate_only():
    assert normalized_name(" Đặng  Văn A (9A)") == normalized_name("Dang Van A")
    assert normalized_name("A (10A)") != normalized_name("A")


@pytest.mark.parametrize(
    "crafts, reason",
    [
        ([], "thiếu default craft"),
        (["MECH", "P&P"], "nhiều default craft"),
        (["CRANE"], "không khớp"),
    ],
)
def test_admin_error_contains_labor_identity_and_both_crafts(crafts, reason):
    source = {"craft": "DECK"}
    labor = {"laborcode": "LAB1", "personid": "P1", "orgid": "BDPOC", "default_crafts": crafts}
    message = unmapped_message(source, [labor])
    assert reason in message
    assert all(value in message for value in ("DECK", "LAB1", "P1", "BDPOC", *crafts))
    assert "ACTIVE" in unmapped_message(source, [])


@pytest.mark.parametrize("number", range(1, 10))
@pytest.mark.parametrize("crew", ["A", "B"])
def test_all_verified_terminal_crew_annotations(number, crew):
    assert normalized_name(f" Đặng  Văn A ({number}{crew}) ") == "dang van a"


@pytest.mark.parametrize("annotation", ["10A", "1C", "crew A", "AB", "0A"])
def test_other_suffixes_and_nonterminal_annotations_are_preserved(annotation):
    assert normalized_name(f"Nguyen Van A ({annotation})") != "nguyen van a"
    assert normalized_name("Nguyen (1A) Van A") != "nguyen van a"


def test_annotation_candidates_do_not_create_identity_or_hide_duplicate_binding():
    source = parse_rota(fixture_ods(), "rota.ods", "ROTA_2026")
    source["rows"][0]["name"] = "Nguyen Van A (1A)"
    source["rows"][1]["name"] = "Nguyen Van A (9B)"
    labor = {
        "labor_key": "one",
        "connection_id": str(uuid4()),
        "orgid": "BDPOC",
        "laborcode": "TEST",
        "personid": "PERSON",
        "displayname": "Nguyen Van A",
        "default_crafts": ["P&P"],
    }
    assert candidates(source["rows"][0], [labor]) == [labor]
    assert candidates(source["rows"][1], [labor]) == [labor]
    other = {**labor, "labor_key": "two", "personid": "OTHER"}
    assert proposals(source, [labor, other]) == {}
    row_ids = [str(row["source_row"]) for row in source["rows"][:2]]
    stage = SimpleNamespace(
        id=uuid4(),
        pool_id=uuid4(),
        version=1,
        status="staged",
        file_name="rota.ods",
        sheet="ROTA_2026",
        created_at=datetime.now(UTC),
        source=source,
        labor=[labor],
        mapping=dict.fromkeys(row_ids, "one"),
        labor_error=None,
        labor_snapshot_at=None,
    )
    result = preview(stage)
    assert all(
        any(issue["kind"] == "duplicate" for issue in row["issues"]) for row in result["rows"][:2]
    )
    assert source["rows"][0]["name"] == "Nguyen Van A (1A)"


@pytest.mark.parametrize(
    "xml",
    [
        b'<!DOCTYPE x [<!ENTITY a "x">]><x/>',
        b"<broken",
        '<?xml version="1.0" encoding="UTF-16"?><!DOCTYPE x [<!ENTITY a "x">]><x>&a;</x>'.encode(
            "utf-16"
        ),
    ],
)
def test_invalid_xml_denied(xml):
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as archive:
        archive.writestr("content.xml", xml)
    with pytest.raises(RotaParseError):
        parse_rota(out.getvalue(), "rota.ods", "ROTA_2026")


def test_zip_traversal_denied():
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as archive:
        archive.writestr("../content.xml", "x")
    with pytest.raises(RotaParseError):
        parse_rota(out.getvalue(), "rota.ods", "ROTA_2026")


def test_ods_date_gap_does_not_silently_truncate():
    content = fixture_ods()
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        document = archive.read("content.xml").replace(
            b'<table:table-cell office:date-value="2026-01-02"',
            b'<table:table-cell/><table:table-cell office:date-value="2026-01-03"',
        )
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as archive:
        archive.writestr("content.xml", document)
    source = parse_rota(out.getvalue(), "rota.ods", "ROTA_2026")
    assert any(
        error["kind"] == "date" and error["cell"] == "I4" for error in source["source_errors"]
    )


def fixture_xlsx(gap=False, company="BD POC", company_formula=False):
    result = io.BytesIO()
    ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"

    def cell(ref, text):
        return f'<c r="{ref}" t="inlineStr"><is><t>{text}</t></is></c>'

    rows = ['<row r="4"><c r="H4"><v>46023</v></c><c r="I4"><f>H4+1</f><v>46024</v></c></row>']
    for row, craft, role in [
        (6, "P&amp;P", "Control RM Engineer"),
        (8, "E&amp;I", "E&amp;I Technician"),
        (10, "RES", "RES"),
        (12, "MECHANIC", "Mechanical Technician"),
        (14, "DECK CREW", "Painter"),
    ]:
        rows.append(f'<row r="{row}">' + cell(f"B{row}", craft) + "</row>")
        rows.append(
            f'<row r="{row + 1}">'
            + cell(f"A{row + 1}", "Synthetic Person")
            + cell(f"B{row + 1}", role)
            + (
                f'<c r="C{row + 1}" t="str"><f>C1</f><v>{company}</v></c>'
                if company_formula
                else cell(f"C{row + 1}", company)
            )
            + cell(f"H{row + 1}", "AM")
            + "</row>"
        )
    if gap:
        rows[0] = rows[0].replace("I4", "J4")
    with zipfile.ZipFile(result, "w") as archive:
        archive.writestr(
            "xl/workbook.xml",
            f'<workbook xmlns="{ns}" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            '<sheets><sheet name="ROTA_2026" r:id="r1"/></sheets></workbook>',
        )
        archive.writestr(
            "xl/_rels/workbook.xml.rels",
            '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>',
        )
        archive.writestr(
            "xl/worksheets/sheet1.xml",
            f'<worksheet xmlns="{ns}"><sheetData>' + "".join(rows) + "</sheetData></worksheet>",
        )
    return result.getvalue()


def test_native_xlsx_serial_calendar_and_roles():
    source = parse_rota(fixture_xlsx(), "rota.xlsx", "ROTA_2026")
    assert len(source["rows"]) == 5
    assert source["coverage_from"] == "2026-01-01"
    assert not source["source_errors"]
    assert source["rows"][3]["role"] == "TECH"


def test_xlsx_date_gap_blocks_import():
    source = parse_rota(fixture_xlsx(gap=True), "rota.xlsx", "ROTA_2026")
    assert any(
        error["kind"] == "date" and error["cell"] == "I4" for error in source["source_errors"]
    )


@pytest.mark.parametrize("company", ["BD POC", "BDPOC", "  bd   poc  "])
@pytest.mark.parametrize("kind", ["ods", "xlsx"])
def test_only_explicit_company_labels_are_accepted(company, kind):
    content = fixture_ods(company=company) if kind == "ods" else fixture_xlsx(company=company)
    source = parse_rota(content, f"rota.{kind}", "ROTA_2026")
    assert len(source["rows"]) == 5
    assert not source["source_errors"]
    assert all(row["company"] == "BDPOC" for row in source["rows"])
    assert source["excluded_company_count"] == 0


@pytest.mark.parametrize("kind", ["ods", "xlsx"])
@pytest.mark.parametrize("kwargs", [{"company": ""}, {"company_formula": True}])
def test_missing_or_formula_company_is_not_enrolled(kwargs, kind):
    content = fixture_ods(**kwargs) if kind == "ods" else fixture_xlsx(**kwargs)
    source = parse_rota(content, f"rota.{kind}", "ROTA_2026")
    assert source["rows"] == []
    company_errors = [error for error in source["source_errors"] if error["kind"] == "company"]
    assert len(company_errors) == 5
    assert company_errors[0]["cell"] == "C7"
    assert source["excluded_company_count"] == 0


def test_contractor_is_excluded_before_day_role_mapping_and_capacity():
    with zipfile.ZipFile(io.BytesIO(fixture_ods(position="Unknown contractor"))) as archive:
        document = (
            archive.read("content.xml")
            .replace(b"BD POC", b"Contractor", 1)
            .replace(b"Nguyen Van A", b"Contractor Person", 1)
            .replace(
                b"<text:p>1</text:p></table:table-cell><table:table-cell/></table:table-row>",
                b"<text:p>BAD</text:p></table:table-cell><table:table-cell/></table:table-row>",
                1,
            )
        )
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as archive:
        archive.writestr("content.xml", document)
    source = parse_rota(out.getvalue(), "rota.ods", "ROTA_2026")
    assert source["source_errors"] == []  # All craft sections remain recognized.
    assert source["excluded_company_count"] == 1
    assert [row["source_row"] for row in source["rows"]] == [9, 11, 13, 15]
    labor = {
        "labor_key": "active-contractor",
        "connection_id": str(uuid4()),
        "orgid": "BDPOC",
        "laborcode": "TEST",
        "personid": "PERSON",
        "displayname": "Contractor Person",
        "default_crafts": ["P&P"],
    }
    assert proposals(source, [labor]) == {}
    stage = SimpleNamespace(
        id=uuid4(),
        pool_id=uuid4(),
        version=1,
        status="staged",
        file_name="rota.ods",
        sheet="ROTA_2026",
        created_at=datetime.now(UTC),
        source=source,
        labor=[labor],
        mapping={},
        labor_error=None,
        labor_snapshot_at=None,
    )
    result = preview(stage)
    assert result["excluded_company_count"] == 1
    assert result["summary"]["rota_people"] == 4
    assert result["summary"]["mapped_people"] == 0
    assert result["summary"]["capacity_hours"] == 42
    assert all(row["candidates"] == [] for row in result["rows"])
    assert result["excluded_labor_count"] == 1
    assert all(not row["issues"] for row in source["rows"])


@pytest.mark.parametrize("kind", ["ods", "xlsx"])
def test_matching_active_labor_does_not_enroll_contractor_only_roster(kind):
    content = (
        fixture_ods(company="Contractor") if kind == "ods" else fixture_xlsx(company="Contractor")
    )
    source = parse_rota(content, f"rota.{kind}", "ROTA_2026")
    assert source["rows"] == []
    assert source["excluded_company_count"] == 5
    assert proposals(source, [{"displayname": "Nguyen Van A", "default_crafts": ["P&P"]}]) == {}


def test_material_controller_excluded_before_day_errors_and_capacity():
    source = parse_rota(
        fixture_ods(mechanic_position="  MATERIAL   Controller  "), "rota.ods", "ROTA_2026"
    )
    assert len(source["rows"]) == 4
    assert source["source_errors"] == []
    assert source["excluded_position_count"] == 1
    assert source["excluded_positions"] == [
        {"source_row": 13, "name": "Nguyen Van A", "position": "MATERIAL   Controller"}
    ]
    assert sum(day["capacity_hours"] for row in source["rows"] for day in row["days"]) == 42


@pytest.mark.parametrize(
    "titles,selected",
    [
        (["Production Technician", "Material Controller"], "one"),
        ([" PRODUCTION   technician ", "E&I Technician"], "one"),
        (["Production Technician", "Production Technician"], None),
        ([None, "Material Controller"], None),
        (["", "Material Controller"], None),
        (["Production Supervisor", "Material Controller"], None),
        (["TECH", "Material Controller"], None),
    ],
)
def test_duplicate_names_require_one_exact_position_title(titles, selected):
    row = {
        "source_row": 7,
        "name": "Nguyen Manh Hung (3A)",
        "position": "Production Technician",
        "craft": "P&P",
    }
    labor = [
        {
            "labor_key": key,
            "displayname": "Nguyen Manh Hung",
            "title": title,
            "default_crafts": ["P&P"],
        }
        for key, title in zip(["one", "two"], titles, strict=True)
    ]
    assert len(candidates(row, labor)) == 2
    assert proposals({"rows": [row]}, labor) == ({"7": selected} if selected else {})


@pytest.mark.parametrize(
    "title,allowed",
    [(None, True), ("", True), ("Different job", True), ("Material Controller", False)],
)
def test_singleton_compatibility_and_known_excluded_title(title, allowed):
    row = {"source_row": 7, "name": "Name", "position": "Production Technician", "craft": "P&P"}
    labor = [{"labor_key": "one", "displayname": "Name", "title": title, "default_crafts": ["P&P"]}]
    assert bool(proposals({"rows": [row]}, labor)) == allowed


def test_legacy_preview_filters_position_and_stale_binding_without_source_mutation():
    source = parse_rota(fixture_ods(), "rota.ods", "ROTA_2026")
    source["policy_version"] = "rota-2026-10-11-v4"
    source["rows"][3]["position"] = "Material Controller"
    source["rows"][3]["role"] = "MATERIAL_CONTROLLER"
    source["rows"][3]["issues"] = [{"kind": "code", "message": "BAD"}]
    labor = [
        {
            "labor_key": "old",
            "displayname": "Nguyen Van A",
            "default_crafts": ["MECH"],
            "connection_id": str(uuid4()),
            "personid": "OLD",
            "laborcode": "L",
            "orgid": "BDPOC",
        }
    ]
    stage = SimpleNamespace(
        id=uuid4(),
        pool_id=uuid4(),
        version=1,
        status="staged",
        file_name="x.ods",
        sheet="ROTA_2026",
        created_at=datetime.now(UTC),
        source=source,
        labor=labor,
        mapping={"13": "old"},
        labor_error=None,
        labor_snapshot_at=None,
    )
    result = preview(stage)
    assert result["excluded_position_count"] == 1
    assert result["summary"]["rota_people"] == 4
    assert result["summary"]["capacity_hours"] == 42
    assert result["policy_version"] == "rota-2026-10-11-v4"
    assert len(source["rows"]) == 5
    assert stage.mapping == {"13": "old"}
