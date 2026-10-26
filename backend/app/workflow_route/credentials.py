"""In-memory Maximo position-account sessions and login attempt limits.

Only the base64 maxauth string is kept, never the password, and never on disk, in the
database, in logs, audit rows or responses.
"""

import time
from collections import deque
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

USER_LIMIT, USER_WINDOW = 3, 300
ACCOUNT_LIMIT, ACCOUNT_WINDOW = 10, 3600


class SecretString:
    __slots__ = ("_value",)

    def __init__(self, value: str):
        self._value = value

    def reveal(self) -> str:
        return self._value

    def __repr__(self) -> str:
        return "SecretString(***)"

    __str__ = __repr__

    def __reduce__(self):
        raise TypeError("Secrets cannot be serialized")


@dataclass(frozen=True)
class RouteCredential:
    maxauth: SecretString
    personid: str
    user_id: UUID
    expires_at: datetime


class CredentialStore:
    """One credential per login session; keyed by (session, connection, discipline)."""

    def __init__(self, clock=lambda: datetime.now(UTC)):
        self._clock = clock
        self._items: dict[tuple[str, UUID, str], RouteCredential] = {}

    def put(self, session: str, connection_id: UUID, discipline: str, credential: RouteCredential):
        # A different connection or discipline replaces the previous credential.
        self.drop_session(session)
        self._items[(session, connection_id, discipline)] = credential

    def get(self, session: str, connection_id: UUID, discipline: str) -> RouteCredential | None:
        self.purge()
        return self._items.get((session, connection_id, discipline))

    def drop(self, session: str, connection_id: UUID, discipline: str) -> None:
        self._items.pop((session, connection_id, discipline), None)

    def drop_session(self, session: str) -> None:
        for key in [key for key in self._items if key[0] == session]:
            del self._items[key]

    def purge(self) -> None:
        now = self._clock()
        for key in [key for key, item in self._items.items() if item.expires_at <= now]:
            del self._items[key]

    def __len__(self) -> int:
        return len(self._items)


class LoginLimiter:
    """Failed-login budget: 3 per 5 minutes per user, 10 per hour per shared position account.

    An attempt is reserved before the Maximo call and released on success, so concurrent
    bursts cannot exceed the budget.
    """

    def __init__(self, clock=time.monotonic):
        self._clock = clock
        self._users: dict[UUID, deque[float]] = {}
        self._accounts: dict[tuple[UUID, str], deque[float]] = {}

    @staticmethod
    def _prune(entries: deque[float], now: float, window: int) -> None:
        while entries and now - entries[0] >= window:
            entries.popleft()

    def reserve(self, user_id: UUID, account: tuple[UUID, str]) -> int | None:
        """Return None when reserved, else the seconds until another attempt is allowed."""
        now = self._clock()
        users = self._users.setdefault(user_id, deque())
        accounts = self._accounts.setdefault(account, deque())
        self._prune(users, now, USER_WINDOW)
        self._prune(accounts, now, ACCOUNT_WINDOW)
        if len(users) >= USER_LIMIT:
            return max(1, int(USER_WINDOW - (now - users[0])) + 1)
        if len(accounts) >= ACCOUNT_LIMIT:
            return max(1, int(ACCOUNT_WINDOW - (now - accounts[0])) + 1)
        users.append(now)
        accounts.append(now)
        return None

    def release(self, user_id: UUID, account: tuple[UUID, str]) -> None:
        for entries in (self._users.get(user_id), self._accounts.get(account)):
            if entries:
                entries.pop()

    def remaining(self, user_id: UUID) -> int:
        entries = self._users.get(user_id, deque())
        self._prune(entries, self._clock(), USER_WINDOW)
        return max(0, USER_LIMIT - len(entries))
