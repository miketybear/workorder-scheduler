"""Offline activation uses the immutable upload and its persisted LABOR snapshot."""

from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import delete, select

from app.rota.models import PersonDayCapacity, ResourcePerson, RotaActivation
from app.rota.parser import CRAFT, OFF, POLICY_VERSION, POSITIONS, WORK
from app.rota.preview import eligible_candidates, preview


def receipt(revision):
    if revision is None:
        return None
    return (
        {key: str(getattr(revision, key)) for key in ("id", "pool_id", "import_id")}
        | {
            key: getattr(revision, key)
            for key in ("import_version", "pool_version", "person_count", "day_count")
        }
        | {
            "coverage_from": revision.coverage_from.isoformat(),
            "coverage_before": revision.coverage_before.isoformat(),
            "activated_at": revision.activated_at.isoformat(),
            "total_hours": float(revision.total_hours),
        }
    )


def proposed_days(stage, pool):
    errors = []
    view = preview(stage)
    if stage.status != "staged":
        errors.append("Import is cancelled or already activated")
    if stage.source.get("policy_version") != POLICY_VERSION:
        errors.append("Upload again using the current company and eligible-position parser policy")
    if not stage.labor_snapshot_at or stage.labor_error:
        errors.append("A successful LABOR snapshot is required; refresh when Maximo is available")
    errors.extend(item["message"] for item in view["source_errors"])
    errors.extend(
        f"Row {row['source_row']} ({row['name']}): {item['message']}"
        for row in view["rows"]
        for item in row["issues"]
    )
    try:
        start = date.fromisoformat(stage.source["coverage_from"])
        before = date.fromisoformat(stage.source["coverage_before"])
        if not 1 <= (before - start).days <= 366:
            raise ValueError
    except (TypeError, ValueError):
        return {}, list(dict.fromkeys(errors + ["Invalid source date coverage"]))
    expected = {(start + timedelta(days=i)).isoformat() for i in range((before - start).days)}
    result, people = {}, set()
    for row in view["rows"]:
        labor = row["mapping"]
        if not labor:
            continue
        if len(eligible_candidates(row, stage.labor)) != 1:
            errors.append(f"Row {row['source_row']}: ambiguous LABOR identity")
        key = labor["personid"]
        if (
            not key
            or len(key) > 100
            or key in people
            or row.get("company") != "BDPOC"
            or labor["connection_id"] != str(pool.connection_id)
            or labor["orgid"] != pool.orgid
            or row["craft"] not in set(CRAFT.values())
            or row["role"] not in set(POSITIONS.values())
            or len(row["name"]) > 200
            or len(labor["laborcode"]) > 100
        ):
            errors.append(f"Row {row['source_row']}: invalid company, identity, craft or role")
            continue
        people.add(key)
        dates = [day["date"] for day in row["days"]]
        if set(dates) != expected or len(dates) != len(expected):
            errors.append(f"Row {row['source_row']}: incomplete or duplicate daily coverage")
            continue
        for day in row["days"]:
            code = day["code"].upper()
            hours = 10.5 if code in WORK else 0 if code in OFF else None
            if hours is None or hours != day["capacity_hours"] or len(day["code"]) > 20:
                errors.append(f"Row {row['source_row']}: inconsistent day code/hours {day['date']}")
                continue
            result[key, day["date"]] = {
                **day,
                "person_key": key,
                "name": row["name"],
                "craft": row["craft"],
                "role": row["role"],
                "laborcode": labor["laborcode"],
            }
    if not result:
        errors.append("No eligible company personnel to activate")
    return result, list(dict.fromkeys(errors))


def day_view(value):
    return (
        None
        if value is None
        else {k: value[k] for k in ("code", "capacity_hours", "craft", "role")}
    )


def difference(before, after):
    changes = []
    for person in sorted({key[0] for key in before} | {key[0] for key in after}):
        old = {k: v for k, v in before.items() if k[0] == person}
        new = {k: v for k, v in after.items() if k[0] == person}
        keys = sorted(set(old) | set(new))
        changed = [k for k in keys if old.get(k) != new.get(k)]
        if not changed:
            continue
        changes.append(
            {
                "person_key": person,
                "name": (next(iter(new.values())) if new else next(iter(old.values())))["name"],
                "change_type": "added" if not old else "removed" if not new else "changed",
                "before_crafts": sorted({v["craft"] for v in old.values()}),
                "after_crafts": sorted({v["craft"] for v in new.values()}),
                "before_roles": sorted({v["role"] for v in old.values()}),
                "after_roles": sorted({v["role"] for v in new.values()}),
                "before_hours": sum(v["capacity_hours"] for v in old.values()),
                "after_hours": sum(v["capacity_hours"] for v in new.values()),
                "changed_days": len(changed),
                "day_changes_truncated": len(changed) > 20,
                "day_changes": [
                    {"date": k[1], "before": day_view(old.get(k)), "after": day_view(new.get(k))}
                    for k in changed[:20]
                ],
            }
        )
    return {
        "added_people": sum(v["change_type"] == "added" for v in changes),
        "removed_people": sum(v["change_type"] == "removed" for v in changes),
        "changed_people": sum(v["change_type"] == "changed" for v in changes),
        "changed_days": sum(v["changed_days"] for v in changes),
        "before_hours": sum(v["capacity_hours"] for v in before.values()),
        "after_hours": sum(v["capacity_hours"] for v in after.values()),
    }, changes


async def capacity(db, pool_id, start, before):
    return (
        await db.scalars(
            select(PersonDayCapacity).where(
                PersonDayCapacity.pool_id == pool_id,
                PersonDayCapacity.date >= start,
                PersonDayCapacity.date < before,
            )
        )
    ).all()


def capacity_dict(rows):
    return {
        (r.person_key, r.date.isoformat()): {
            "date": r.date.isoformat(),
            "person_key": r.person_key,
            "name": r.name,
            "craft": r.craft,
            "role": r.role,
            "laborcode": r.laborcode,
            "code": r.code,
            "capacity_hours": float(r.capacity_hours),
        }
        for r in rows
    }


async def materialize(db, stage, pool, state, identity, proposed):
    start, before = (
        date.fromisoformat(stage.source["coverage_from"]),
        date.fromisoformat(stage.source["coverage_before"]),
    )
    revision = RotaActivation(
        pool_id=pool.id,
        import_id=stage.id,
        actor_id=identity.user_id,
        import_version=stage.version,
        expected_pool_version=state.version,
        pool_version=state.version + 1,
        coverage_from=start,
        coverage_before=before,
        snapshot={
            "source": stage.source,
            "labor": stage.labor,
            "mapping": stage.mapping,
            "labor_snapshot_at": stage.labor_snapshot_at.isoformat(),
        },
        person_count=len({key[0] for key in proposed}),
        day_count=len(proposed),
        total_hours=Decimal(str(sum(v["capacity_hours"] for v in proposed.values()))),
    )
    db.add(revision)
    await db.flush()
    people = {
        p.person_key: p
        for p in (
            await db.scalars(select(ResourcePerson).where(ResourcePerson.pool_id == pool.id))
        ).all()
    }
    for key in {k[0] for k in proposed} - people.keys():
        person = ResourcePerson(pool_id=pool.id, person_key=key)
        db.add(person)
        people[key] = person
    await db.flush()
    await db.execute(
        delete(PersonDayCapacity).where(
            PersonDayCapacity.pool_id == pool.id,
            PersonDayCapacity.date >= start,
            PersonDayCapacity.date < before,
        )
    )
    for (key, day), value in proposed.items():
        db.add(
            PersonDayCapacity(
                pool_id=pool.id,
                person_id=people[key].id,
                activation_id=revision.id,
                **{
                    **value,
                    "date": date.fromisoformat(day),
                    "capacity_hours": Decimal(str(value["capacity_hours"])),
                },
            )
        )
    state.version += 1
    stage.status = "activated"
    stage.version += 1
    await db.flush()
    return revision
