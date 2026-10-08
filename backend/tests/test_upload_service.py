import asyncio
from dataclasses import replace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.scheduling.batches import BatchKey
from app.scheduling.changes import WorkOrderBaseline
from app.scheduling.drafts import CurrentWorkOrder, WorkOrderKey
from app.scheduling.upload_routes import UploadSelection, UploadSubmit
from app.scheduling.upload_service import PreparedItem, PreparedUpload, validate_current


def current():
    return CurrentWorkOrder(
        WorkOrderKey(uuid4(), "TEST", "100"),
        "WO100",
        "MECH",
        "v1",
        WorkOrderBaseline(worktype="CM", estdur=8),
        frozenset({"TECH"}),
    )


def prepared(snapshot, proposal=None):
    return PreparedItem(
        uuid4(),
        snapshot.key,
        snapshot.wonum,
        snapshot.discipline,
        snapshot.revision,
        snapshot.baseline.model_dump(mode="json"),
        proposal or {"estdur": "9"},
        {"estdur": "9"},
        "ready",
    )


@pytest.mark.parametrize(
    "field,value",
    [
        ("estdur", "-1"),
        ("status", "COMP"),
        ("assignedtechname", "BAD"),
        ("estdur", None),
    ],
)
def test_saved_changes_are_validated_again(field, value):
    snapshot = current()
    assert validate_current(prepared(snapshot, {field: value}), snapshot) == ("invalid_changes", {})


@pytest.mark.parametrize("worktype", ["PM", "CFT"])
def test_targets_remain_restricted(worktype):
    snapshot = replace(current(), baseline=WorkOrderBaseline(worktype=worktype, estdur=8))
    proposal = {
        "change_target": True,
        "targstartdate": "2026-10-08T00:00:00+07:00",
        "targcompdate": "2026-10-09T00:00:00+07:00",
    }
    assert validate_current(prepared(snapshot, proposal), snapshot)[0] == "invalid_changes"


def test_baseline_revision_and_scope_fail_closed():
    snapshot = current()
    item = prepared(snapshot)
    assert validate_current(item, snapshot) == ("ready", {"estdur": "9"})
    assert validate_current(item, replace(snapshot, revision="v2"))[0] == "conflict"
    assert (
        validate_current(
            item, replace(snapshot, baseline=WorkOrderBaseline(worktype="CM", estdur=10))
        )[0]
        == "conflict"
    )
    with pytest.raises(HTTPException) as error:
        validate_current(item, replace(snapshot, discipline="ELEC"))
    assert error.value.status_code == 404


def test_selection_and_request_forbid_client_changes_and_duplicates():
    values = {"version": 1, "items": [{"site_id": "TEST", "workorder_id": "100"}]}
    assert UploadSelection(**values).version == 1
    for invalid in [
        {**values, "version": True},
        {**values, "items": values["items"] * 2},
        {**values, "changes": {"status": "COMP"}},
        {**values, "items": []},
    ]:
        with pytest.raises(ValidationError):
            UploadSelection(**invalid)
    assert UploadSubmit(**values, request_id=uuid4(), preview_hash="a" * 64)


def test_preview_hash_binds_source_and_selection():
    item = prepared(current())
    original = PreparedUpload(uuid4(), 1, (item,))
    for changed in [
        replace(original, version=2),
        replace(original, items=(replace(item, member_id=uuid4()),)),
        replace(original, items=(replace(item, proposal={"estdur": "10"}),)),
        replace(original, items=(replace(item, code="invalid_changes"),)),
    ]:
        assert changed.preview_hash != original.preview_hash
    assert original.preview_hash == original.preview_hash


def run(coroutine):
    asyncio.run(coroutine, loop_factory=asyncio.SelectorEventLoop)


def key(snapshot):
    return BatchKey(site_id=snapshot.key.site_id, workorder_id=snapshot.key.workorder_id)
