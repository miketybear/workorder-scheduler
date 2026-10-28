import asyncio
from dataclasses import replace
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.scheduling import upload_routes
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
        WorkOrderBaseline(
            worktype="CM",
            estdur=8,
            assignedto="BASELINE-PIC",
            schedstart="2026-10-08T00:00:00+07:00",
            schedfinish="2026-10-08T08:00:00+07:00",
        ),
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
        ("assignedto", "BAD"),
        ("estdur", None),
    ],
)
def test_saved_changes_are_validated_again(field, value):
    snapshot = current()
    assert validate_current(prepared(snapshot, {field: value}), snapshot) == ("invalid_changes", {})


@pytest.mark.parametrize("worktype", ["PM", "CFT"])
def test_targets_remain_restricted(worktype):
    snapshot = replace(
        current(), baseline=current().baseline.model_copy(update={"worktype": worktype})
    )
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


@pytest.mark.parametrize(
    "updates,proposal,missing",
    [
        ({"schedstart": None}, {"estdur": "9"}, ("schedule",)),
        ({"schedfinish": None}, {"estdur": "9"}, ("schedule",)),
        ({"assignedto": None}, {"estdur": "9"}, ("pic",)),
        ({"assignedto": "  "}, {"estdur": "9"}, ("pic",)),
        ({"schedstart": None, "assignedto": None}, {"estdur": "9"}, ("schedule", "pic")),
        ({}, {"schedstart": None}, ("schedule",)),
        ({}, {"schedfinish": None}, ("schedule",)),
        ({}, {"assignedto": None}, ("pic",)),
    ],
)
def test_upload_requires_merged_complete_schedule_and_pic(updates, proposal, missing):
    from app.scheduling.upload_service import missing_schedule

    original = current()
    snapshot = replace(original, baseline=original.baseline.model_copy(update=updates))
    item = prepared(snapshot, proposal)
    code, changes = validate_current(item, snapshot)
    assert code == "incomplete_schedule"
    # The draft's own valid changes are still reported for the preview, never sent.
    assert changes == ({"estdur": "9"} if proposal == {"estdur": "9"} else {})
    assert missing_schedule(item.before, item.proposal) == missing


def test_draft_can_complete_an_incomplete_current_work_order_for_upload():
    snapshot = replace(current(), baseline=WorkOrderBaseline(worktype="CM", estdur=8))
    proposal = {
        "schedstart": "2026-10-08T00:00:00+07:00",
        "schedfinish": "2026-10-08T08:00:00+07:00",
        "assignedto": "TECH",
    }
    assert validate_current(prepared(snapshot, proposal), snapshot) == ("ready", proposal)


@pytest.mark.parametrize("failure_phase", ["execute", "status", "existing_receipt"])
def test_submit_never_reports_409_after_a_batch_may_have_written(monkeypatch, failure_phase):
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(sessions=object())))
    draft_id, actor_id, batch_id = uuid4(), uuid4(), uuid4()
    payload = UploadSubmit(
        version=1,
        items=[BatchKey(site_id="TEST", workorder_id="100")],
        request_id=uuid4(),
        preview_hash="a" * 64,
    )
    calls = []

    async def existing(*args):
        return batch_id if failure_phase == "existing_receipt" else None

    async def preview(*args, **kwargs):
        return {"preview_hash": payload.preview_hash, "send_enabled": True}, object(), actor_id

    async def create(*args, **kwargs):
        return batch_id, True

    async def execute(*args):
        calls.append("write")
        if failure_phase == "execute":
            raise HTTPException(409, "Upload intent changed")

    async def status(*args):
        calls.append("status")
        raise HTTPException(409, "Upload intent changed")

    monkeypatch.setattr(upload_routes, "existing_receipt", existing)
    monkeypatch.setattr(upload_routes, "preview_data", preview)
    monkeypatch.setattr(upload_routes, "create_upload", create)
    monkeypatch.setattr(upload_routes, "execute_batch", execute)
    monkeypatch.setattr(upload_routes, "status", status)
    with pytest.raises(HTTPException) as caught:
        asyncio.run(upload_routes.submit(request, draft_id, payload))
    assert caught.value.status_code == 503
    assert (
        calls
        == {
            "execute": ["write"],
            "status": ["write", "status"],
            "existing_receipt": ["status"],
        }[failure_phase]
    )


def test_submit_preflight_409_remains_a_definite_rejection(monkeypatch):
    payload = UploadSubmit(
        version=1,
        items=[BatchKey(site_id="TEST", workorder_id="100")],
        request_id=uuid4(),
        preview_hash="a" * 64,
    )

    async def existing(*args):
        return None

    async def preview(*args, **kwargs):
        raise HTTPException(409, "Draft changed; reopen before uploading")

    async def unexpected(*args, **kwargs):
        pytest.fail("A rejected submission must not create or execute an upload")

    monkeypatch.setattr(upload_routes, "existing_receipt", existing)
    monkeypatch.setattr(upload_routes, "preview_data", preview)
    monkeypatch.setattr(upload_routes, "create_upload", unexpected)
    monkeypatch.setattr(upload_routes, "execute_batch", unexpected)
    with pytest.raises(HTTPException) as caught:
        asyncio.run(upload_routes.submit(object(), uuid4(), payload))
    assert (caught.value.status_code, caught.value.detail) == (
        409,
        "Draft changed; reopen before uploading",
    )
