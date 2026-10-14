"""Response assertions shared by shutdown recovery tests; no infrastructure access."""

from decimal import Decimal, InvalidOperation


def normalized_changes(changes):
    result = dict(changes)
    if "estdur" in result:
        try:
            result["estdur"] = Decimal(str(result["estdur"]))
        except (InvalidOperation, ValueError) as error:
            raise ValueError("Invalid duration in restored changes") from error
        if not result["estdur"].is_finite():
            raise ValueError("Non-finite duration in restored changes")
    return result


def validate_restored(body, receipt, actor, restored):
    """Verify every submitted identity/change and the committed receipt version."""
    if (
        restored["draft_id"] != receipt["draft_id"]
        or type(restored["version"]) is not int
        or restored["version"] != receipt["version"]
        or restored["version"] != 1
        or restored["connection_id"] != body["connection_id"]
        or restored["connection_id"] != actor["connection_id"]
        or body["discipline"] != actor["discipline"]
    ):
        raise ValueError("Restored draft identity, scope or version mismatch")
    submitted = {
        (item["site_id"], item["workorder_id"]): normalized_changes(item["changes"])
        for item in body["items"]
    }
    received = {(item["site_id"], item["workorder_id"]): item for item in restored["items"]}
    if len(submitted) != 200 or len(received) != 200 or len(restored["items"]) != 200:
        raise ValueError("Expected exactly200 unique restored work orders")
    if submitted.keys() != received.keys():
        raise ValueError("Restored work order identities mismatch")
    for key, item in received.items():
        if item["discipline"] != actor["discipline"]:
            raise ValueError("Restored work order discipline mismatch")
        if normalized_changes(item["changes"]) != submitted[key]:
            raise ValueError("Restored work order changes mismatch")
    return dict(exact_identities=True, exact_scope=True, exact_changes=True, version_matches=True)
