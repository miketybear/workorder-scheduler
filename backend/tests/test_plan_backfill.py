from datetime import date, timedelta

import pytest

from app.assignments.plan_backfill import Follower, compact

D0 = date(2026, 10, 1)


def d(n):
    return D0 + timedelta(days=n - 1)


def f(name, task, *rows):
    return Follower(name, task, tuple((d(day), m) for day, m in rows))


def capacity(days=12, minutes=630):
    return {d(n): minutes for n in range(1, days + 1)}


def zero(days=12):
    return {d(n): 0 for n in range(1, days + 1)}


def chain():
    return [
        f("T20", 20, (1, 30), (2, 630), (3, 630), (4, 630), (5, 480)),
        f("T30", 30, (5, 150), (6, 450)),
        f("T40", 40, (6, 180), (7, 420)),
        f("T50", 50, (7, 210), (8, 390)),
    ]


def test_chain_moves_up_when_the_first_task_leaves():
    # T10 (600 on day 1) is gone, so only the followers load the source person.
    changes, skipped = compact(chain(), d(1), capacity(), zero())
    assert not skipped
    assert changes["T20"] == [(d(1), 630), (d(2), 630), (d(3), 630), (d(4), 510)]
    assert changes["T30"] == [(d(4), 120), (d(5), 480)]
    assert changes["T40"] == [(d(5), 150), (d(6), 450)]
    assert changes["T50"] == [(d(6), 180), (d(7), 420)]
    for name, rows in changes.items():
        original = next(x for x in chain() if x.plan_id == name)
        assert sum(m for _, m in rows) == sum(m for _, m in original.rows)
        assert rows[-1][0] <= original.rows[-1][0]


def test_no_day_exceeds_capacity_after_compaction():
    changes, _ = compact(chain(), d(1), capacity(), zero())
    totals = {}
    for rows in changes.values():
        for day, m in rows:
            totals[day] = totals.get(day, 0) + m
    assert max(totals.values()) <= 630


def test_nothing_changes_when_nothing_was_freed():
    # The chain already fills every day it can: nothing earlier is free.
    tight = [
        f("A", 10, (1, 630), (2, 630)),
        f("B", 20, (3, 630), (4, 100)),
    ]
    assert compact(tight, d(1), capacity(), zero()) == ({}, {})


def test_follower_is_never_made_later_or_longer():
    # Day 1 is full of other load; day 2 is the only room and it is the old finish.
    one = [f("A", 10, (2, 300))]
    changes, _ = compact(one, d(1), capacity(), {**zero(), d(1): 630})
    assert changes == {}
    # Capacity shrank so the plan no longer fits before its old finish: left untouched.
    shrunk = [f("A", 10, (3, 600))]
    cap = {**capacity(), d(1): 100, d(2): 100, d(3): 100}
    assert compact(shrunk, d(1), cap, zero()) == ({}, {})


def test_other_work_order_load_is_respected():
    external = {**zero(), d(1): 600, d(2): 600}
    changes, _ = compact([f("A", 10, (4, 300))], d(1), capacity(), external)
    assert changes["A"] == [(d(1), 30), (d(2), 30), (d(3), 240)]


def test_days_without_rota_capacity_are_never_used():
    cap = capacity()
    del cap[d(2)]
    cap[d(3)] = 0
    changes, _ = compact([f("A", 10, (5, 630), (6, 370))], d(1), cap, zero())
    assert changes["A"] == [(d(1), 630), (d(4), 370)]


def test_unverified_day_skips_the_follower_and_keeps_its_rows_in_the_picture():
    external = {**zero(), d(1): None}
    followers = [f("A", 10, (2, 600)), f("B", 20, (3, 600))]
    changes, skipped = compact(followers, d(1), capacity(), external)
    assert skipped == {"A": "load_unverified", "B": "load_unverified"}
    assert changes == {}
    # Only day 2 unverified: A needs day 1 only and moves; B must cross day 2 and is skipped.
    changes, skipped = compact(followers, d(1), capacity(), {**zero(), d(2): None})
    assert changes["A"] == [(d(1), 600)]
    assert skipped == {"B": "load_unverified"}


def test_missing_external_load_for_a_working_day_is_unverified():
    changes, skipped = compact([f("A", 10, (3, 100))], d(1), capacity(), {})
    assert changes == {} and skipped == {"A": "load_unverified"}


def test_rows_before_the_freed_start_stay_where_they_are():
    changes, _ = compact([f("A", 10, (1, 100), (4, 200))], d(2), capacity(), zero())
    assert changes["A"] == [(d(1), 100), (d(2), 200)]


def test_order_is_by_first_date_then_task_id_regardless_of_input_order():
    a = f("A", 20, (3, 630))
    b = f("B", 10, (3, 630))
    forward, _ = compact([a, b], d(1), capacity(), zero())
    backward, _ = compact([b, a], d(1), capacity(), zero())
    assert forward == backward
    # Same first date: the lower task id is processed first and gets the earliest day.
    assert forward["B"] == [(d(1), 630)]
    assert forward["A"] == [(d(2), 630)]


def test_compaction_is_idempotent():
    changes, _ = compact(chain(), d(1), capacity(), zero())
    again = [Follower(n, int(n[1:]), tuple(rows)) for n, rows in changes.items()]
    assert compact(again, d(1), capacity(), zero()) == ({}, {})


@pytest.mark.parametrize("limit", [300, 630, 800])
def test_daily_limit_is_capped_at_630(limit):
    changes, _ = compact([f("A", 10, (3, 630), (4, 630))], d(1), capacity(minutes=limit), zero())
    for rows in changes.values():
        assert all(m <= min(630, limit) for _, m in rows)
