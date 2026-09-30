def pytest_addoption(parser):
    parser.addoption("--run-db-tests", action="store_true", help="Use isolated PostgreSQL test DB")


def pytest_collection_modifyitems(config, items):
    if not config.getoption("--run-db-tests"):
        import pytest

        for item in items:
            if "integration" in item.keywords:
                item.add_marker(pytest.mark.skip(reason="Pass --run-db-tests for PostgreSQL tests"))
