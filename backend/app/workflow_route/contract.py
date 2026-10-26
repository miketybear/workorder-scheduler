"""Workflow contract check: the route is allowed only while BD_WO still looks as it did when
the route was accepted on test. Anything unrecognized locks the feature (fail closed).

The traversal below is deliberately tolerant about child collection names because the
MXAPIWFPROCESS JSON shape has to be confirmed by a read-only probe; it is never tolerant
about the verdict.
"""

import re

from app.config import WorkflowRouteSettings
from app.workflow_route.maximo import integer, text

SUPERVISED_ROLE = "WO ASS"
MAX_DEPTH = 6
MAX_ITEMS = 5000


def walk(value, depth=0):
    """Yield every dict below value (bounded)."""
    stack = [(value, depth)]
    seen = 0
    while stack:
        item, level = stack.pop()
        seen += 1
        if seen > MAX_ITEMS or level > MAX_DEPTH:
            continue
        if isinstance(item, dict):
            yield item
            stack.extend((child, level + 1) for child in item.values())
        elif isinstance(item, list):
            stack.extend((child, level + 1) for child in item)


def truthy(value) -> bool:
    return value is True or str(value).strip().lower() in {"1", "true", "y", "yes"}


def node_with_id(record: dict, node_id: int):
    nodes = record.get("wfnode")
    found = [
        node
        for node in (nodes if isinstance(nodes, list) else [])
        if isinstance(node, dict) and integer(node.get("nodeid")) == node_id
    ]
    return found[0] if len(found) == 1 else None


def assignment_lines(node: dict) -> list[dict]:
    """Dicts at or below a node that name a role; their condition-like fields are checked."""
    return [
        line
        for line in walk(node)
        if any(key.lower() in {"roleid", "role", "rolename"} for key in line)
    ]


def line_role(line: dict) -> str:
    for key, value in line.items():
        if key.lower() in {"roleid", "role", "rolename"} and text(value):
            return text(value)
    return ""


def line_condition(line: dict) -> str:
    return "".join(
        text(value) or ""
        for key, value in line.items()
        if "cond" in key.lower() and not isinstance(value, (dict, list))
    )


def contract_problem(records: list[dict], route: WorkflowRouteSettings) -> str | None:
    return resolve_contract(records, route)[0]


def resolve_contract(
    records: list[dict], route: WorkflowRouteSettings
) -> tuple[str | None, int | None]:
    """(problem, revision): a stable problem code (None if it matches) and the revision in force.

    A pinned revision must exist and be active; otherwise exactly one revision may be active.
    """
    named = [record for record in records if text(record.get("processname")) == route.process]
    if route.revision is not None:
        named = [r for r in named if integer(r.get("processrev")) == route.revision]
        if len(named) != 1:
            return "process_revision_not_found", None
        if not truthy(named[0].get("active")):
            return "process_revision_inactive", route.revision
        record = named[0]
    else:
        active = [r for r in named if truthy(r.get("active"))]
        if not active:
            return "process_revision_not_found", None
        if len(active) != 1:
            return "process_revision_ambiguous", None
        record = active[0]
    revision = integer(record.get("processrev"))
    if revision is None:
        return "process_revision_not_found", None
    return check_record(record, route), revision


def check_record(record: dict, route: WorkflowRouteSettings) -> str | None:
    # Maximo lists the options under the input node that owns them (wfnode[].wfaction).
    nodes = record.get("wfnode")
    actions = [
        item
        for node in (nodes if isinstance(nodes, list) else [])
        if isinstance(node, dict)
        for item in walk(node.get("wfaction"))
        if "actionid" in item
    ]
    for node_id, action_id in sorted(route.nodes.items()):
        if node_with_id(record, node_id) is None:
            return f"node_{node_id}_missing"
        offered = [
            item
            for item in actions
            if integer(item.get("actionid")) == action_id
            and text(item.get("instruction")) == route.option_text
        ]
        if len(offered) != 1:
            return f"node_{node_id}_option_changed"
    target = node_with_id(record, route.assignment_node)
    if target is None:
        return f"node_{route.assignment_node}_missing"
    lines = [line for line in assignment_lines(target) if line_role(line) == SUPERVISED_ROLE]
    if not lines:
        return f"node_{route.assignment_node}_role_changed"
    # An application-name condition made Maximo drop the assignment when routed over REST.
    if any(line_condition(line) for line in lines):
        return f"node_{route.assignment_node}_condition_present"
    return None


def offered_options(body) -> list[tuple[int, str]]:
    """(action id, instruction) pairs offered by the input node in a completeAssignment reply."""
    options = []
    for item in walk(body):
        action = integer(item.get("actionid"))
        label = next(
            (
                text(item.get(key))
                for key in ("instruction", "description", "label", "title")
                if text(item.get(key))
            ),
            None,
        )
        if action is not None and label:
            options.append((action, label))
    return options


def expected_option_offered(body, route: WorkflowRouteSettings, action_id: int) -> bool:
    """Exactly one offered option carries the required text, and it has the expected id."""
    named = [item for item in offered_options(body) if item[1] == route.option_text]
    return len(named) == 1 and named[0][0] == action_id


def memo_for(name: str) -> str:
    clean = re.sub(r"[^\w .,'-]", "", name, flags=re.UNICODE).strip()[:100] or "Planner"
    return f"Route by {clean} via Work Order Scheduler"
