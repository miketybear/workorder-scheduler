from collections import Counter

from app.rota.parser import (
    eligible_rows,
    excluded_position,
    excluded_positions,
    issue,
    normalized_name,
    normalized_position,
)


def candidates(row, labor):
    name = normalized_name(row["name"])
    return [item for item in labor if normalized_name(item["displayname"]) == name]


def proposals(source, labor):
    result = {}
    for row in eligible_rows(source):
        matches = eligible_candidates(row, labor)
        if len(matches) == 1 and matches[0]["default_crafts"] == [row["craft"]]:
            result[str(row["source_row"])] = matches[0]["labor_key"]
    return result


def eligible_candidates(row, labor):
    if excluded_position(row["position"]):
        return []
    matches = candidates(row, labor)
    if len(matches) > 1:
        # Craft or generic TECH/SUP roles cannot prove which same-name PERSON is intended.
        matches = [
            item
            for item in matches
            if item.get("title")
            and normalized_position(item["title"]) == normalized_position(row["position"])
        ]
        if len(matches) != 1:
            return []
    return [item for item in matches if not excluded_position(item.get("title") or "")]


def labor_details(item):
    crafts = ", ".join(item["default_crafts"]) or "thiếu default craft"
    return (
        f"LABOR {item['laborcode']} / PERSON {item['personid']} / "
        f"ORG {item['orgid']} / title {item.get('title') or 'thiếu title'} / craft {crafts}"
    )


def unmapped_message(source, matches):
    expected = f"Craft rota: {source['craft']}. "
    if not matches:
        return expected + "Không có LABOR ACTIVE trùng tên trong organization của pool."
    details = "; ".join(labor_details(item) for item in matches)
    if len(matches) > 1:
        return expected + "Trùng tên ở nhiều LABOR: " + details + "."
    if not matches[0]["default_crafts"]:
        return expected + "LABOR thiếu default craft: " + details + "."
    if len(matches[0]["default_crafts"]) > 1:
        return expected + "LABOR có nhiều default craft: " + details + "."
    if matches[0]["default_crafts"] != [source["craft"]]:
        return expected + "Craft LABOR không khớp: " + details + "."
    return expected + "LABOR chưa được đối chiếu tự động: " + details + "."


def summary(stage):
    return {
        "id": str(stage.id),
        "pool_id": str(stage.pool_id),
        "version": stage.version,
        "status": stage.status,
        "file_name": stage.file_name,
        "sheet": stage.sheet,
        "created_at": stage.created_at.isoformat(),
        "coverage_from": stage.source["coverage_from"],
        "coverage_before": stage.source["coverage_before"],
    }


def preview(stage):
    items = {item["labor_key"]: item for item in stage.labor}
    source_rows = eligible_rows(stage.source)
    valid_mapping = {
        str(row["source_row"]): item
        for row in source_rows
        if (item := items.get(stage.mapping.get(str(row["source_row"]))))
        and item in eligible_candidates(row, stage.labor)
    }
    bound = list(valid_mapping.values())
    person_counts = Counter((item["connection_id"], item["personid"]) for item in bound)
    rows, matched_keys = [], set()
    for source in source_rows:
        matches = candidates(source, stage.labor)
        matched_keys.update(item["labor_key"] for item in matches)
        mapping = valid_mapping.get(str(source["source_row"]))
        problems = list(source["issues"])
        if mapping is None:
            problems.append(
                issue("mapping", unmapped_message(source, matches), source["source_row"])
            )
        else:
            if mapping not in matches or mapping["default_crafts"] != [source["craft"]]:
                problems.append(
                    issue(
                        "craft",
                        f"Craft rota: {source['craft']}. LABOR identity/craft không khớp: "
                        + labor_details(mapping)
                        + ".",
                        source["source_row"],
                    )
                )
            if person_counts[mapping["connection_id"], mapping["personid"]] > 1:
                problems.append(
                    issue(
                        "duplicate",
                        "Một PERSON được liên kết với nhiều dòng rota: "
                        + labor_details(mapping)
                        + ".",
                        source["source_row"],
                    )
                )
        rows.append({**source, "mapping": mapping, "candidates": matches, "issues": problems})
    blockers = len(stage.source["source_errors"]) + sum(len(row["issues"]) for row in rows)
    if stage.labor_error:
        blockers += 1
    return {
        **summary(stage),
        "policy_version": stage.source["policy_version"],
        "labor_snapshot_at": stage.labor_snapshot_at.isoformat()
        if stage.labor_snapshot_at
        else None,
        "labor_error": stage.labor_error,
        "source_errors": stage.source["source_errors"],
        "excluded_company_count": stage.source.get("excluded_company_count", 0),
        "excluded_position_count": len(excluded_positions(stage.source)),
        "excluded_positions": excluded_positions(stage.source),
        "rows": rows,
        "excluded_labor_count": len(stage.labor) - len(matched_keys),
        "summary": {
            "rota_people": len(rows),
            "mapped_people": sum(row["mapping"] is not None for row in rows),
            "blocking_count": blockers,
            "capacity_hours": sum(
                day["capacity_hours"] or 0 for row in rows for day in row["days"]
            ),
        },
    }
