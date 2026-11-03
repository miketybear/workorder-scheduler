from datetime import UTC, datetime
from types import SimpleNamespace

from app.maximo.page_routes import backlog_order, in_readiness, in_view


def order(wonum, priority, start=None):
    return SimpleNamespace(
        wonum=wonum, wopriority=priority, schedstart=start, siteid="S", workorderid=wonum
    )


def test_matches_work_orders_table_order():
    early = datetime(2026, 11, 1, tzinfo=UTC)
    late = datetime(2026, 11, 2, tzinfo=UTC)
    orders = [
        order("A", None, early),
        order("B", 1, early),
        order("C", 2),
        order("E", 2, late),
        order("F", 2, early),
        order("D", 2, early),
    ]
    assert [o.wonum for o in sorted(orders, key=backlog_order)] == ["D", "F", "E", "C", "B", "A"]


def test_readiness_and_view_membership():
    now = datetime(2026, 11, 1, tzinfo=UTC)

    def wo(wonum, finish, pic):
        return SimpleNamespace(
            wonum=wonum,
            siteid="S",
            workorderid=wonum,
            schedstart=now,
            schedfinish=finish,
            assignedto=pic,
        )

    ready, no_pic, no_finish = wo("A", now, "X"), wo("B", now, " "), wo("C", None, "X")
    assert in_readiness(ready, "ready") and not in_readiness(ready, "missing")
    assert in_readiness(no_pic, "missing") and in_readiness(no_finish, "missing")
    assert all(in_readiness(o, "all") for o in (ready, no_pic, no_finish))
    assert in_view(ready, "completed", {("S", "A")}) and in_view(no_pic, "backlog", {("S", "A")})
