"""Stored Maximo position-account credentials and login attempt limits.

maxauth is base64 of user:password, so it is encrypted before it reaches the database and
never appears in logs, audit rows or responses. The key is configured outside the database.
"""

import time
from collections import deque
from dataclasses import dataclass
from uuid import UUID

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import delete

from app.db.models import AuthorizationEvent, WorkflowRouteCredential

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


class CredentialStore:
    """One encrypted credential per Entra user, connection and discipline; audited, never logged.

    It stays until Maximo rejects it, the user forgets it or the user loses write access.
    """

    def __init__(self, sessions, key: str):
        # A callable: the session factory only exists once the application has started.
        self._sessions = sessions
        self._fernet = Fernet(key)

    async def get(
        self, user_id: UUID, connection_id: UUID, discipline: str, personid: str
    ) -> RouteCredential | None:
        async with self._sessions()() as db:
            row = await db.get(WorkflowRouteCredential, (user_id, connection_id, discipline))
        if row is None or row.personid != personid:
            return None
        try:
            maxauth = self._fernet.decrypt(row.ciphertext).decode()
        except InvalidToken:  # The key was rotated; the user simply signs in again.
            return None
        return RouteCredential(SecretString(maxauth), personid, user_id)

    async def put(
        self, user_id: UUID, connection_id: UUID, discipline: str, personid: str, maxauth: str
    ) -> None:
        ciphertext = self._fernet.encrypt(maxauth.encode())
        async with self._sessions().begin() as db:
            await db.merge(
                WorkflowRouteCredential(
                    user_id=user_id,
                    connection_id=connection_id,
                    discipline=discipline,
                    personid=personid,
                    ciphertext=ciphertext,
                )
            )
            db.add(
                AuthorizationEvent(
                    actor_id=user_id,
                    connection_id=connection_id,
                    event="route_credential_saved",
                    details={"discipline": discipline, "personid": personid},
                )
            )

    async def drop(self, user_id: UUID, connection_id: UUID, discipline: str, reason: str) -> None:
        async with self._sessions().begin() as db:
            await drop_credentials(
                db,
                user_id,
                reason,
                WorkflowRouteCredential.connection_id == connection_id,
                WorkflowRouteCredential.discipline == discipline,
            )

    async def drop_all(self, user_id: UUID, reason: str) -> None:
        async with self._sessions().begin() as db:
            await drop_credentials(db, user_id, reason)


async def drop_credentials(db, user_id: UUID, reason: str, *criteria) -> None:
    """Delete and audit in the caller's transaction, so a revoke and its cleanup land together."""
    rows = await db.execute(
        delete(WorkflowRouteCredential)
        .where(WorkflowRouteCredential.user_id == user_id, *criteria)
        .returning(
            WorkflowRouteCredential.connection_id,
            WorkflowRouteCredential.discipline,
            WorkflowRouteCredential.personid,
        )
    )
    for connection_id, discipline, personid in rows.all():
        db.add(
            AuthorizationEvent(
                actor_id=user_id,
                connection_id=connection_id,
                event="route_credential_dropped",
                details={"discipline": discipline, "personid": personid, "reason": reason},
            )
        )


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
