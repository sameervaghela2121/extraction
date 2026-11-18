"""Offline sync: a device sends its whole outbox in one call.

Ported from backend/src/services/sync.service.ts:
- master items (lot, vendor, supplier_code) run first, then rolls and movements in the order
  the device queued them — remaining weight depends on movement order;
- every item has its own client_id, so a retry of a half-applied batch replays what was
  written and writes only the rest;
- each item runs in its own savepoint: a failure undoes that item only. Items that depend on
  a failed one are "skipped" with reason dependency_failed; everything else goes through;
- from the API each item also commits on its own, as on the old server: visible to other
  tablets at once, and a deadlock costs one item, which is retried once."""

import time
import uuid

import frappe

from royal_touche.errors import RTError, RTValidation
from royal_touche.lots import create_lot
from royal_touche.masters import add_papers, create_vendor
from royal_touche.movements import record_movement
from royal_touche.rolls import register_roll

MAX_BATCH = 50
MASTER_TYPES = ("lot", "vendor", "supplier_code")
ITEM_TYPES = MASTER_TYPES + ("roll", "movement")


class _Skip(Exception):
    pass


def run_batch(items: list[dict], ip: str | None = None, commit_each: bool = False) -> dict:
    _check_batch(items)
    started = time.monotonic()
    ids = {"lot": {}, "vendor": {}, "roll": {}}
    failed = {"lot": set(), "vendor": set(), "roll": set()}
    failed_rolls: set[str] = set()  # server names of rolls with a failed movement in this batch
    order = [i for i, it in enumerate(items) if it["type"] in MASTER_TYPES] + \
            [i for i, it in enumerate(items) if it["type"] not in MASTER_TYPES]
    results: dict[int, dict] = {}
    for index in order:
        item = items[index]
        base = {"index": index, "type": item["type"], "client_id": item["client_id"]}
        for attempt in (1, 2):
            savepoint = f"rt_sync_{index}"
            frappe.db.savepoint(savepoint)
            try:
                data = _run_item(item, ids, failed, failed_rolls)
                results[index] = {**base, "status": "ok", "data": data}
            except _Skip:
                _undo(savepoint, commit_each)
                results[index] = {**base, "status": "skipped", "reason": "dependency_failed"}
                _mark_failed(item, failed, failed_rolls, ids)
            except (frappe.QueryDeadlockError, frappe.QueryTimeoutError) as e:
                _undo(savepoint, commit_each)
                if attempt == 1:
                    continue
                results[index] = {**base, "status": "failed", **_error_of(e)}
                _mark_failed(item, failed, failed_rolls, ids)
            except Exception as e:
                _undo(savepoint, commit_each)
                results[index] = {**base, "status": "failed", **_error_of(e)}
                _mark_failed(item, failed, failed_rolls, ids)
            break
        if commit_each:
            frappe.db.commit()
    ordered = [results[i] for i in range(len(items))]
    _log(items, ordered, started, ip)
    return {"results": ordered}


def _undo(savepoint: str, commit_each: bool) -> None:
    frappe.local.message_log = []
    try:
        frappe.db.rollback(save_point=savepoint)
    except Exception:
        # A deadlock ended the whole transaction, savepoint included. With each item committed
        # that lost this item only; otherwise earlier items went too, and the caller must know.
        if not commit_each:
            raise
        frappe.db.rollback()


def _check_batch(items: list[dict]) -> None:
    if not items:
        raise RTValidation("Nothing to sync")
    if len(items) > MAX_BATCH:
        raise RTValidation(f"A batch cannot exceed {MAX_BATCH} items — send the rest in the next call")
    for item in items:
        if item.get("type") not in ITEM_TYPES:
            raise RTValidation(f"Unknown item type: {item.get('type')}")
        try:
            uuid.UUID(str(item.get("client_id")))
        except ValueError:
            raise RTValidation("client_id must be a UUID") from None
    if len({i["client_id"] for i in items}) != len(items):
        raise RTValidation("Every item needs its own client_id")


def _resolve(kind: str, client_id: str | None, ids: dict, failed: dict) -> str | None:
    """The server name of something created earlier in this batch, by its client_id."""
    if not client_id:
        return None
    if client_id in failed[kind]:
        raise _Skip()
    if client_id in ids[kind]:
        return ids[kind][client_id]
    from royal_touche import replay

    field = {"lot": ("Roll Lot", "client_id"), "vendor": ("Supplier", "rt_client_id"), "roll": ("Batch", "rt_client_id")}[kind]
    return replay.find(*field, client_id)


def _run_item(item: dict, ids: dict, failed: dict, failed_rolls: set) -> dict:
    kind, cid, body = item["type"], item["client_id"], dict(item.get("body") or {})
    if kind == "lot":
        data = create_lot({**body, "client_id": cid})
        ids["lot"][cid] = data["name"]
        return data
    if kind == "vendor":
        data = create_vendor({**body, "client_id": cid})
        ids["vendor"][cid] = data["name"]
        return data
    if kind == "supplier_code":
        vendor = body.get("vendor") or _resolve("vendor", body.get("vendor_client_id"), ids, failed)
        if not vendor:
            raise RTValidation("vendor or vendor_client_id is required")
        return add_papers(vendor, body.get("papers") or [])
    if kind == "roll":
        lot = body.pop("lot_client_id", None)
        vendor = body.pop("vendor_client_id", None) or item.get("vendor_client_id")
        if lot:
            body["lot"] = _resolve("lot", lot, ids, failed)
        if vendor:
            body["vendor"] = _resolve("vendor", vendor, ids, failed)
        data = register_roll({**body, "client_id": cid})
        ids["roll"][cid] = data["name"]
        return data
    # movement
    roll = body.get("roll") or _resolve("roll", item.get("roll_client_id"), ids, failed)
    if roll in failed_rolls:
        raise _Skip()
    body["roll"] = roll
    return record_movement({**body, "client_id": cid})


def _mark_failed(item: dict, failed: dict, failed_rolls: set, ids: dict) -> None:
    kind = item["type"]
    if kind in failed:
        failed[kind].add(item["client_id"])
    elif kind == "movement":
        body = item.get("body") or {}
        roll = body.get("roll") or ids["roll"].get(item.get("roll_client_id"))
        if roll:
            failed_rolls.add(roll)
        elif item.get("roll_client_id"):
            failed["roll"].add(item["roll_client_id"])


def _error_of(e: Exception) -> dict:
    message = str(e) or e.__class__.__name__
    if isinstance(e, RTError):
        return {"error": message, "code": e.http_status_code, "reason": e.reason}
    if isinstance(e, (frappe.UniqueValidationError, frappe.DuplicateEntryError)):
        return {"error": message, "code": 409, "reason": "duplicate"}
    if isinstance(e, frappe.PermissionError):
        return {"error": message, "code": 403, "reason": "forbidden"}
    if isinstance(e, frappe.DoesNotExistError):
        return {"error": message, "code": 404, "reason": "not_found"}
    if isinstance(e, frappe.ValidationError):
        return {"error": message, "code": 400, "reason": "validation"}
    frappe.log_error(title="RT sync item failed")
    return {"error": "Something went wrong on the server — try again later", "code": 500, "reason": "server_error"}


def _log(items: list[dict], results: list[dict], started: float, ip: str | None) -> None:
    count = lambda status: sum(1 for r in results if r["status"] == status)  # noqa: E731
    frappe.get_doc({
        "doctype": "Sync Log",
        "user": frappe.session.user,
        "ip": ip,
        "item_count": len(items),
        "applied": count("ok"),
        "failed": count("failed"),
        "skipped": count("skipped"),
        "duration_ms": int((time.monotonic() - started) * 1000),
        "request_body": frappe.as_json(items),
        "results": frappe.as_json(results),
    }).insert(ignore_permissions=True)
