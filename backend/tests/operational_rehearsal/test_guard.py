from pathlib import Path
from uuid import uuid4

import pytest
from runner import validate_data


def fixture_data():
    run_id = uuid4().hex
    return dict(
        run_id=run_id,
        database_url=f"postgresql+psycopg://rehearsal:synthetic@pg:5432/rehearsal_{run_id}",
        tenant_id=str(uuid4()),
        connections=[
            dict(id=str(uuid4()), system=s, host=f"{s}.invalid") for s in ("onshore", "offshore")
        ],
    )


def test_owned_synthetic_contract_accepted():
    data = fixture_data()
    validate_data(data, Path(f"private-{data['run_id']}.json"))


@pytest.mark.parametrize("mutation", ["host", "database", "filename", "upstream", "connection"])
def test_non_owned_contract_rejected_before_database_use(mutation):
    data = fixture_data()
    path = Path(f"private-{data['run_id']}.json")
    if mutation == "host":
        data["database_url"] = data["database_url"].replace("@pg:", "@localhost:")
    elif mutation == "database":
        data["database_url"] = data["database_url"].replace(
            f"rehearsal_{data['run_id']}", "scheduler_test"
        )
    elif mutation == "filename":
        path = Path("private-unowned.json")
    elif mutation == "upstream":
        data["connections"][0]["host"] = "real.example.com"
    else:
        data["connections"][1]["id"] = data["connections"][0]["id"]
    with pytest.raises(ValueError):
        validate_data(data, path)


@pytest.mark.parametrize("value", [True, 0, 6, 321, "320"])
def test_invalid_shutdown_grace_rejected(value):
    data = fixture_data()
    data["shutdown_grace_seconds"] = value
    with pytest.raises(ValueError):
        validate_data(data, Path(f"private-{data['run_id']}.json"))


@pytest.mark.parametrize("value", [True, 0, 301, "300"])
def test_invalid_reader_budget_rejected(value):
    data = fixture_data()
    data["retrieval_timeout_seconds"] = value
    with pytest.raises(ValueError):
        validate_data(data, Path(f"private-{data['run_id']}.json"))


def test_staging_timeouts_accepted():
    data = fixture_data()
    data.update(shutdown_grace_seconds=320, retrieval_timeout_seconds=300)
    validate_data(data, Path(f"private-{data['run_id']}.json"))


def test_shutdown_contract_matches_staging_without_launching_docker():
    from shutdown import require_contract

    contract = require_contract()
    assert len(contract["compose_sha256"]) == 64
    assert len(contract["nginx_sha256"]) == 64
