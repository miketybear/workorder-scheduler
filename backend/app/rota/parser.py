"""Bounded ODS/XLSX parsing of company personnel, positions and rota day cells."""

import io
import posixpath
import re
import unicodedata
import zipfile
from datetime import date, timedelta
from xml.etree import ElementTree as ET

POLICY_VERSION = "rota-2026-10-12-v5"
MAX_UPLOAD = 8 * 1024 * 1024
WORK = {"1", "OT", "M", "OM", "A", "AM"}
OFF = {"", "AF", "D", "DM", "DF", "F", "AL", "SL", "PL", "CL", "O", "O4", "O5", "O6", "AB"}
CRAFT = {
    "P&P": "P&P",
    "E&I": "E&I",
    "RES": "RES",
    "MECHANIC": "MECH",
    "DECK CREW": "DECK",
    "MECH": "MECH",
    "DECK": "DECK",
}
POSITIONS = {
    "production technician": "TECH",
    "production supervisor": "SUP",
    "field supervisor": "SUP",
    "control rm engineer": "CONTROL_RM_ENGINEER",
    "e&i technician": "TECH",
    "e&i supervisor": "SUP",
    "asst. e&i supervisor": "ASST_SUP",
    "res": "TECH",
    "rotating engineer": "TECH",
    "mechanical technician": "TECH",
    "mechanical supervisor": "SUP",
    "asst. mech supervisor": "ASST_SUP",
    "deck foreman": "SUP",
    "crane operator": "TECH",
    "deck crew": "TECH",
    "painter": "TECH",
}


class RotaParseError(ValueError):
    pass


def normalized_position(value):
    return " ".join(value.casefold().split())


def excluded_position(value):
    return normalized_position(value) == "material controller"


def eligible_rows(source):
    # Older immutable uploads remain unchanged; current views omit excluded positions.
    return [row for row in source["rows"] if not excluded_position(row["position"])]


def excluded_positions(source):
    return list(source.get("excluded_positions", [])) + [
        {key: row[key] for key in ("source_row", "name", "position")}
        for row in source["rows"]
        if excluded_position(row["position"])
    ]


def normalized_name(value):
    value = re.sub(r"\s*\([1-9][AB]\)\s*$", "", value, flags=re.I)
    value = value.replace("Đ", "D").replace("đ", "d")
    return " ".join(
        "".join(c for c in unicodedata.normalize("NFD", value) if unicodedata.category(c) != "Mn")
        .casefold()
        .split()
    )


def issue(kind, message, row=None, day=None, cell=None):
    return {"kind": kind, "message": message, "source_row": row, "date": day, "cell": cell}


def column_name(number):
    result = ""
    while number:
        number, remainder = divmod(number - 1, 26)
        result = chr(65 + remainder) + result
    return result


def xml(archive, path):
    data = archive.read(path)
    try:
        document = data.decode("utf-8-sig")
    except UnicodeError:
        raise RotaParseError("Spreadsheet XML must use UTF-8") from None
    declaration = re.search(r'<\?xml[^>]*encoding\s*=\s*["\']([^"\']+)', document, re.I)
    if "\x00" in document or (declaration and declaration[1].casefold() not in ("utf-8", "utf8")):
        raise RotaParseError("Spreadsheet XML must use UTF-8")
    if "<!DOCTYPE" in document.upper() or "<!ENTITY" in document.upper():
        raise RotaParseError("XML entities are not allowed")
    try:
        return ET.fromstring(data)
    except ET.ParseError:
        raise RotaParseError("Invalid spreadsheet XML") from None


def bounded_archive(content):
    if not content or len(content) > MAX_UPLOAD:
        raise RotaParseError("Upload must be at most 8 MB")
    try:
        archive = zipfile.ZipFile(io.BytesIO(content))
        entries = archive.infolist()
        names = [entry.filename for entry in entries]
        if len(entries) > 2000 or len(names) != len(set(names)):
            raise RotaParseError("Invalid spreadsheet archive")
        if sum(entry.file_size for entry in entries) > 64 * 1024 * 1024:
            raise RotaParseError("Expanded spreadsheet exceeds limit")
        for entry in entries:
            if (
                entry.file_size > 32 * 1024 * 1024
                or entry.flag_bits & 1
                or entry.filename.startswith("/")
                or ".." in entry.filename.split("/")
                or "\\" in entry.filename
                or entry.file_size > max(1, entry.compress_size) * 1000
            ):
                raise RotaParseError("Unsafe spreadsheet archive")
        return archive
    except zipfile.BadZipFile:
        raise RotaParseError("Invalid spreadsheet archive") from None


def ods_cells(archive, sheet):
    ns = {
        "t": "urn:oasis:names:tc:opendocument:xmlns:table:1.0",
        "o": "urn:oasis:names:tc:opendocument:xmlns:office:1.0",
        "text": "urn:oasis:names:tc:opendocument:xmlns:text:1.0",
    }
    tables = [
        t
        for t in xml(archive, "content.xml").findall(".//t:table", ns)
        if t.get(f"{{{ns['t']}}}name") == sheet
    ]
    if len(tables) != 1:
        raise RotaParseError("Requested rota sheet not found")
    cells, row_index = {}, 1
    for row in tables[0].findall("t:table-row", ns):
        repeat = int(row.get(f"{{{ns['t']}}}number-rows-repeated", "1"))
        col = 1
        current = {}
        for cell in row:
            count = int(cell.get(f"{{{ns['t']}}}number-columns-repeated", "1"))
            if count < 1 or repeat < 1:
                raise RotaParseError("Invalid repeated spreadsheet cells")
            text = " ".join("".join(p.itertext()) for p in cell.findall("text:p", ns)).strip()
            value = cell.get(f"{{{ns['o']}}}date-value") or text
            formula = cell.get(f"{{{ns['t']}}}formula") is not None
            if (value or formula) and col <= 400:
                for c in range(col, min(col + count, 401)):
                    current[c] = (value, formula)
            col += count
        if current and (repeat > 500 or row_index + repeat > 501):
            raise RotaParseError("Rota sheet exceeds row limit")
        if current:
            for r in range(row_index, row_index + repeat):
                for c, value in current.items():
                    cells[r, c] = value
        row_index += repeat
    return cells


def xlsx_cells(archive, sheet):
    ns = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    wb = xml(archive, "xl/workbook.xml")
    sheets = [s for s in wb.findall("s:sheets/s:sheet", ns) if s.get("name") == sheet]
    if len(sheets) != 1:
        raise RotaParseError("Requested rota sheet not found")
    relationship = sheets[0].get(
        "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
    )
    rels = xml(archive, "xl/_rels/workbook.xml.rels")
    matches = [r for r in rels if r.get("Id") == relationship]
    if len(matches) != 1 or matches[0].get("TargetMode") == "External":
        raise RotaParseError("Invalid sheet relationship")
    target = matches[0].get("Target", "")
    path = target.lstrip("/") if target.startswith("/") else posixpath.normpath("xl/" + target)
    if not path.startswith("xl/worksheets/"):
        raise RotaParseError("Unsafe sheet relationship")
    strings = []
    if "xl/sharedStrings.xml" in archive.namelist():
        strings = ["".join(s.itertext()) for s in xml(archive, "xl/sharedStrings.xml")]
    date1904 = wb.find("s:workbookPr", ns)
    epoch = (
        date(1904, 1, 1)
        if date1904 is not None and date1904.get("date1904") in ("1", "true")
        else date(1899, 12, 30)
    )
    cells = {}
    for cell in xml(archive, path).findall("s:sheetData/s:row/s:c", ns):
        ref = cell.get("r", "")
        match = re.fullmatch(r"([A-Z]{1,3})([0-9]{1,5})", ref)
        if not match:
            raise RotaParseError("Invalid spreadsheet cell reference")
        row, col = int(match[2]), 0
        for character in match[1]:
            col = col * 26 + ord(character) - 64
        if row > 500 or col > 400:
            continue
        raw = cell.findtext("s:v", "", ns)
        kind = cell.get("t")
        if kind == "s":
            try:
                raw = strings[int(raw)]
            except (IndexError, ValueError):
                raise RotaParseError("Invalid shared string") from None
        elif kind == "inlineStr":
            raw = "".join(cell.find("s:is", ns).itertext())
        elif row == 4 and col >= 8 and kind not in ("str", "d"):
            try:
                serial = float(raw)
                if not serial.is_integer() or not 36526 <= serial <= 73416:
                    raise ValueError
                raw = (epoch + timedelta(days=int(serial))).isoformat()
            except (ValueError, OverflowError):
                pass
        cells[row, col] = (raw.strip(), cell.find("s:f", ns) is not None)
    return cells


def parse_rota(content, filename, sheet):
    try:
        with bounded_archive(content) as archive:
            cells = (
                ods_cells(archive, sheet)
                if filename.lower().endswith(".ods")
                else xlsx_cells(archive, sheet)
            )
    except (KeyError, ValueError, OverflowError, zipfile.BadZipFile) as error:
        if isinstance(error, RotaParseError):
            raise
        raise RotaParseError("Invalid spreadsheet structure") from None
    errors, dates = [], []
    for col in range(8, 401):
        value, formula = cells.get((4, col), ("", False))
        if not value:
            later = [cells.get((4, c), ("", False))[0] for c in range(col + 1, 401)]
            if any(re.match(r"^\d{4}-\d{2}-\d{2}", label) for label in later):
                errors.append(
                    issue(
                        "date",
                        "Gap in date header; fix source file",
                        4,
                        cell=f"{column_name(col)}4",
                    )
                )
            break
        if dates and value == "Wo. Day":
            break
        try:
            day = date.fromisoformat(value[:10])
            if not 2000 <= day.year <= 2100 or (dates and day != dates[-1] + timedelta(days=1)):
                raise ValueError
            dates.append(day)
        except ValueError:
            errors.append(
                issue(
                    "date",
                    "Date header must be continuous calendar dates",
                    4,
                    cell=f"{column_name(col)}4",
                )
            )
            break
    if not dates or len(dates) > 366:
        errors.append(issue("date", "Expected 1 to 366 dates starting at H4", 4, cell="H4"))
    rows, craft, seen_crafts = [], None, set()
    excluded_company_count = 0
    excluded = []
    for row in range(6, 501):
        name, name_formula = cells.get((row, 1), ("", False))
        position, pos_formula = cells.get((row, 2), ("", False))
        if position.upper() in CRAFT and (not name or name.isdigit()):
            craft = CRAFT[position.upper()]
            seen_crafts.add(craft)
            continue
        if position.upper() in {"OFFICE", "MEDIC", "CATERING"}:
            craft = None
            continue
        if not craft or not name:
            continue
        company, company_formula = cells.get((row, 3), ("", False))
        if company_formula or not company.strip():
            errors.append(
                issue(
                    "company",
                    "Missing company or formula; fix source file",
                    row,
                    cell=f"C{row}",
                )
            )
            continue
        # Company comes from the roster, never from ACTIVE LABOR status or craft.
        if "".join(company.casefold().split()) != "bdpoc":
            excluded_company_count += 1
            continue
        if not pos_formula and excluded_position(position):
            excluded.append({"source_row": row, "name": name, "position": position})
            continue
        role = POSITIONS.get(position.casefold())
        problems = []
        if role is None or name_formula or pos_formula:
            problems.append(issue("position", "Unknown position or formula; fix source file", row))
        days = []
        for offset, day in enumerate(dates, 8):
            value, formula = cells.get((row, offset), ("", False))
            code = value.upper()
            hours = 10.5 if code in WORK else 0 if code in OFF else None
            if formula or hours is None:
                hours = None
                problems.append(
                    issue(
                        "code",
                        "Unknown rota code or formula; fix source file",
                        row,
                        day.isoformat(),
                        f"{column_name(offset)}{row}",
                    )
                )
            days.append({"date": day.isoformat(), "code": value, "capacity_hours": hours})
        rows.append(
            {
                "source_row": row,
                "name": name,
                "position": position,
                "company": "BDPOC",
                "craft": craft,
                "role": role,
                "days": days,
                "issues": problems,
            }
        )
    if seen_crafts != set(CRAFT.values()) or not rows:
        errors.append(issue("craft", "Expected all five craft sections and personnel"))
    return {
        "policy_version": POLICY_VERSION,
        "rows": rows,
        "source_errors": errors,
        "excluded_company_count": excluded_company_count,
        "excluded_position_count": len(excluded),
        "excluded_positions": excluded,
        "coverage_from": dates[0].isoformat() if dates else None,
        "coverage_before": (dates[-1] + timedelta(days=1)).isoformat() if dates else None,
    }
