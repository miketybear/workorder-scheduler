from dataclasses import dataclass
from typing import Literal

Capability = Literal["read", "write"]


@dataclass(frozen=True)
class Grant:
    connection_id: str
    discipline: str
    capability: Capability


def permits(
    grants: tuple[Grant, ...], connection_id: str, discipline: str, capability: Capability
) -> bool:
    """Evaluate server-loaded grants only; callers must not construct these from request data."""
    return any(
        grant.connection_id == connection_id
        and grant.discipline == discipline
        and (grant.capability == capability or grant.capability == "write")
        for grant in grants
    )
