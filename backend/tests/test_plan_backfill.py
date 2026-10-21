from datetime import date, timedelta

from app.assignments.plan_backfill import Candidate, compact

D0 = date(2026, 10, 1)


def d(n):
    return D0 + timedelta(days=n - 1)


def f(name, task, *rows):
    return Candidate(name, task, tuple((d(day), m) for day, m in rows))


def capacity(days=14, minutes=630):
    return {d(n): minutes for n in range(1, days + 1)}


def zero(days=14):
    return {d(n): 0 for n in range(1, days + 1)}


def rows(*pairs):
    return [(d(n), m) for n, m in pairs]


def run(followers, vacated, cap=None, external=None):
    return compact(
        followers,
        {d(n) for n in vacated},
        capacity() if cap is None else cap,
        zero() if external is None else external,
    )


def t20():
    return f("T20", 20, (1, 30), (2, 630), (3, 630), (4, 630), (5, 480))


def test_worked_example_cascades_by_cell():
    # T10 (600 on day 1) has left. T20 takes the 600 freed hours from its tail, which frees
    # day 5 for T30, which takes its day-6 hours.
    t30 = f("T30", 30, (5, 150), (6, 450))
    changes, skipped = run([t20(), t30], [1])
    assert not skipped
    assert changes["T20"] == rows((1, 630), (2, 630), (3, 630), (4, 510))
    assert changes["T30"] == rows((5, 600))


def test_totals_preserved_never_later_and_within_capacity():
    followers = [t20(), f("T30", 30, (5, 150), (6, 450)), f("T40", 40, (6, 180), (7, 420))]
    changes, _ = run(followers, [1])
    after = {x.plan_id: changes.get(x.plan_id, sorted(x.rows)) for x in followers}
    per_day = {}
    for x in followers:
        assert sum(m for _, m in after[x.plan_id]) == sum(m for _, m in x.rows)
        assert after[x.plan_id][-1][0] <= max(dd for dd, _ in x.rows)
        for day, m in after[x.plan_id]:
            per_day[day] = per_day.get(day, 0) + m
    assert max(per_day.values()) <= 630
    # T40 shares day 6 with nobody after T30 leaves, so it pulls its day-7 hours forward.
    assert changes["T40"] == rows((6, 600))


def test_two_multi_day_candidates_in_one_cell_earliest_start_first():
    first = f("F", 10, (1, 100), (5, 200))
    second = f("G", 90, (1, 100), (4, 500))
    changes, _ = run([second, first], [1], external={**zero(), d(1): 100})
    # Free on day 1 = 630 - 100 external - 200 = 330. F (lower task id) takes its 200 first,
    # G gets the remaining 130.
    assert changes["F"] == rows((1, 300))
    assert changes["G"] == rows((1, 230), (4, 370))


def test_single_day_task_in_the_cell_is_untouched():
    single = f("S", 5, (1, 100))
    multi = f("M", 6, (1, 30), (3, 300))
    changes, _ = run([single, multi], [1])
    assert "S" not in changes
    assert changes["M"] == rows((1, 330))


def test_task_of_another_work_order_is_used_like_any_other():
    # Candidates carry no work-order identity: any plan of the person in the cell qualifies.
    other = f("OTHER-WO", 10, (1, 30), (2, 300))
    changes, _ = run([other], [1])
    assert changes["OTHER-WO"] == rows((1, 330))


def test_nothing_changes_without_free_capacity():
    full = f("A", 10, (1, 630), (2, 100))
    assert run([full], [1]) == ({}, {})
    busy = f("B", 10, (1, 30), (2, 100))
    assert run([busy], [1], external={**zero(), d(1): 600}) == ({}, {})


def test_non_candidate_load_is_respected():
    # 500 of day 1 belong to a synced plan or Maximo: only 100 are free.
    changes, _ = run([f("A", 10, (1, 30), (3, 400))], [1], external={**zero(), d(1): 500})
    assert changes["A"] == rows((1, 130), (3, 300))


def test_days_without_rota_capacity_are_not_filled():
    cap = capacity()
    cap[d(1)] = 0
    assert run([f("A", 10, (1, 30), (3, 400))], [1], cap=cap) == ({}, {})


def test_unverified_load_skips_the_candidate_and_leaves_rows_alone():
    a = f("A", 10, (1, 30), (3, 400))
    assert run([a], [1], external={**zero(), d(1): None}) == ({}, {"A": "load_unverified"})
    # Unverified on the tail day it would touch.
    assert run([a], [1], external={**zero(), d(3): None}) == ({}, {"A": "load_unverified"})
    assert run([a], [1], external={}) == ({}, {"A": "load_unverified"})


def test_unverified_candidate_still_counts_as_load_for_others():
    skipped_one = f("A", 10, (1, 300), (2, 100))
    other = f("B", 20, (1, 100), (4, 500))
    changes, skipped = run([skipped_one, other], [1], external={**zero(), d(2): None})
    # A needs nothing from day 2 itself but would cut it: skipped. B takes the remaining 230.
    assert skipped == {"A": "load_unverified"}
    assert changes["B"] == rows((1, 330), (4, 270))


def test_cell_without_a_continuing_task_changes_nothing():
    assert run([f("A", 10, (1, 30))], [1]) == ({}, {})


def test_cascade_through_several_cells():
    chain = [
        f("A", 10, (2, 600), (3, 600)),
        f("B", 20, (3, 30), (4, 600)),
        f("C", 30, (4, 30), (5, 600)),
    ]
    changes, _ = run(chain, [1, 2])
    # Day 2 (vacated or emptied) lets A pull day 3 forward only if it can: A is on day 2.
    assert changes["A"] == rows((2, 630), (3, 570))
    assert changes["B"] == rows((3, 60), (4, 570))
    assert changes["C"] == rows((4, 60), (5, 570))


def test_idempotent_and_deterministic():
    followers = [t20(), f("T30", 30, (5, 150), (6, 450))]
    first, _ = run(followers, [1])
    again = [Candidate(n, int(n[1:]), tuple(r)) for n, r in first.items()]
    assert run(again, [1]) == ({}, {})
    assert run(followers, [1]) == run(list(reversed(followers)), [1])


def test_move_to_another_day_of_the_same_person_vacated_vs_reoccupied():
    # The moved plan left day 1 but now occupies 570 of day 3 (external there). A pulls hours
    # from day 5 and day 3; the day it vacates (3) is then offered to B, which sits there.
    a = f("A", 10, (1, 30), (3, 30), (5, 300))
    b = f("B", 20, (3, 30), (6, 300))
    changes, _ = run([a, b], [1], external={**zero(), d(3): 570})
    assert changes["A"] == rows((1, 360))
    assert changes["B"] == rows((3, 60), (6, 270))
