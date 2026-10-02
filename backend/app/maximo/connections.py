from urllib.parse import urlsplit

from fastapi import HTTPException


def configured_connection(app_settings, connection):
    settings = app_settings.maximo.get(connection.id)
    if settings is None:
        raise HTTPException(503, "Maximo connection is not configured")
    if settings.collection_url != connection.base_url.rstrip("/") + "/oslc/os/oslcmxwodetail":
        raise HTTPException(503, "Maximo connection configuration mismatch")
    if urlsplit(settings.collection_url).scheme == "http" and (
        not settings.allow_http_for_test
        or connection.environment != "test"
        or app_settings.environment == "production"
    ):
        raise HTTPException(
            503, "HTTP Maximo is allowed only for explicitly configured test connections"
        )
    return settings
