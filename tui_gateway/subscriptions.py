"""Persistent subscription dashboard state for the TUI gateway.

This module keeps the dashboard API self-contained so the gateway can serve
normalized subscription data without depending on the front-end store.
"""

from __future__ import annotations

import json
import os
import threading
import time
import uuid
from copy import deepcopy
from pathlib import Path
from typing import Any

from hermes_constants import get_hermes_home

_PROVIDER_NAMES = {
    "chatgpt_plus": "ChatGPT Plus",
    "cursor": "Cursor",
    "google_ai": "Google AI",
    "xiaomi_mimo": "Xiaomi MiMo",
}

_PROVIDER_ORDER = tuple(_PROVIDER_NAMES.keys())
_DEFAULT_STALE_AFTER_MS = 24 * 60 * 60 * 1000
_DEFAULT_CONNECTION_KIND = "manual"
_DEFAULT_CONFIDENCE = "medium"
_DEFAULT_METRIC_KIND = "allowance"
_DEFAULT_UNIT = "allowance"
_STORE_FILENAME = "subscription_dashboard.json"
_STORE_LOCK = threading.Lock()


def _now_ms() -> int:
    return int(time.time() * 1000)


def _store_path() -> Path:
    return get_hermes_home() / _STORE_FILENAME


def _default_connection(provider_id: str, now: int) -> dict[str, Any]:
    return {
        "connected": False,
        "connectorKind": _DEFAULT_CONNECTION_KIND,
        "lastCheckedAt": now,
        "label": f"{_PROVIDER_NAMES.get(provider_id, provider_id)} manual tracking",
    }


def _default_value(now: int) -> dict[str, Any]:
    return {
        "confidence": _DEFAULT_CONFIDENCE,
        "displayUnit": _DEFAULT_UNIT,
        "metricKind": _DEFAULT_METRIC_KIND,
        "notes": [],
        "remaining": 0,
        "sourceType": _DEFAULT_CONNECTION_KIND,
        "sourceUpdatedAt": now,
    }


def _default_record(provider_id: str, now: int) -> dict[str, Any]:
    provider_name = _PROVIDER_NAMES.get(provider_id, provider_id.replace("_", " ").title())
    return {
        "activeSource": "manual",
        "confidence": _DEFAULT_CONFIDENCE,
        "connection": _default_connection(provider_id, now),
        "displayUnit": _DEFAULT_UNIT,
        "lastError": None,
        "manualValue": None,
        "metricKind": _DEFAULT_METRIC_KIND,
        "notes": [f"{provider_name} dashboard entry"],
        "providerId": provider_id,
        "providerName": provider_name,
        "renewalAt": None,
        "resetAt": None,
        "sourceUpdatedAt": now,
        "staleAfterMs": _DEFAULT_STALE_AFTER_MS,
        "status": "disconnected",
        "syncedValue": None,
    }


def _load_raw() -> dict[str, Any]:
    path = _store_path()
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_raw(data: dict[str, Any]) -> None:
    path = _store_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(".tmp")
    tmp_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(str(tmp_path), str(path))


def _coerce_notes(notes: Any) -> list[str]:
    if not isinstance(notes, list):
        return []
    return [str(note) for note in notes if str(note).strip()]


def _coerce_value(raw: Any, now: int | None = None) -> dict[str, Any] | None:
    if raw is None:
        return None
    if not isinstance(raw, dict):
        return None
    ts = _now_ms() if now is None else now
    value = _default_value(ts)
    value.update(
        {
            "confidence": str(raw.get("confidence") or value["confidence"]),
            "displayUnit": str(raw.get("displayUnit") or raw.get("display_unit") or value["displayUnit"]),
            "lastError": raw.get("lastError"),
            "metricKind": str(raw.get("metricKind") or value["metricKind"]),
            "notes": _coerce_notes(raw.get("notes")),
            "remaining": int(raw.get("remaining") or 0),
            "sourceType": str(raw.get("sourceType") or _DEFAULT_CONNECTION_KIND),
            "sourceUpdatedAt": int(raw.get("sourceUpdatedAt") or ts),
        }
    )
    if "limit" in raw:
        value["limit"] = raw.get("limit")
    if "used" in raw:
        value["used"] = raw.get("used")
    return value


def _merge_notes(existing: list[str], new_notes: list[str]) -> list[str]:
    merged: list[str] = []
    for note in [*existing, *new_notes]:
        if note and note not in merged:
            merged.append(note)
    return merged


def _normalize_connection(provider_id: str, raw: Any, now: int) -> dict[str, Any]:
    connection = _default_connection(provider_id, now)
    if isinstance(raw, dict):
        connection.update(
            {
                "connected": bool(raw.get("connected")),
                "connectorKind": str(raw.get("connectorKind") or connection["connectorKind"]),
                "lastCheckedAt": int(raw.get("lastCheckedAt") or now),
                "lastError": raw.get("lastError"),
                "label": raw.get("label") or connection["label"],
            }
        )
        if raw.get("connectedAt") is not None:
            connection["connectedAt"] = int(raw.get("connectedAt"))
    return connection


def _derive_status(record: dict[str, Any]) -> str:
    connection = record.get("connection") or {}
    manual_value = record.get("manualValue")
    synced_value = record.get("syncedValue")
    active_source = record.get("activeSource") or "manual"

    if record.get("status") in {"disconnected", "error", "manual", "stale", "synced"}:
        return str(record["status"])
    if not connection.get("connected") and not synced_value and manual_value:
        return "manual"
    if not connection.get("connected") and not synced_value and not manual_value:
        return "disconnected"
    if synced_value and not manual_value and connection.get("connected"):
        return "synced"
    if active_source == "manual":
        return "manual"
    if synced_value or manual_value:
        return "stale"
    return "disconnected"


def _normalize_record(provider_id: str, raw: Any, now: int) -> dict[str, Any]:
    record = _default_record(provider_id, now)
    if isinstance(raw, dict):
        record.update({k: deepcopy(v) for k, v in raw.items() if k not in {"connection", "manualValue", "syncedValue", "notes"}})
        record["connection"] = _normalize_connection(provider_id, raw.get("connection"), now)
        record["manualValue"] = _coerce_value(raw.get("manualValue"), now)
        record["syncedValue"] = _coerce_value(raw.get("syncedValue"), now)
        record["notes"] = _merge_notes(record["notes"], _coerce_notes(raw.get("notes")))
    record["confidence"] = str(record.get("confidence") or _DEFAULT_CONFIDENCE)
    record["displayUnit"] = str(record.get("displayUnit") or _DEFAULT_UNIT)
    record["metricKind"] = str(record.get("metricKind") or _DEFAULT_METRIC_KIND)
    record["notes"] = _merge_notes(record.get("notes") or [], [])
    record["sourceUpdatedAt"] = int(record.get("sourceUpdatedAt") or now)
    record["staleAfterMs"] = int(record.get("staleAfterMs") or _DEFAULT_STALE_AFTER_MS)
    record["status"] = _derive_status(record)
    return record


def _ensure_store() -> dict[str, Any]:
    data = _load_raw()
    subscriptions = data.get("subscriptions") if isinstance(data.get("subscriptions"), dict) else {}
    history = data.get("history") if isinstance(data.get("history"), dict) else {}
    return {"history": history, "subscriptions": subscriptions}


def _save_store(store: dict[str, Any]) -> None:
    _save_raw(store)


def _history_entry(
    provider_id: str,
    event_type: str,
    before_value: Any,
    after_value: Any,
    summary: str,
    source_type: str = _DEFAULT_CONNECTION_KIND,
    details: str | None = None,
    now: int | None = None,
) -> dict[str, Any]:
    ts = _now_ms() if now is None else now
    entry = {
        "afterValue": _coerce_value(after_value, ts),
        "beforeValue": _coerce_value(before_value, ts),
        "createdAt": ts,
        "eventType": event_type,
        "id": f"subevt-{uuid.uuid4().hex[:12]}",
        "providerId": provider_id,
        "sourceType": source_type,
        "summary": summary,
    }
    if details:
        entry["details"] = details
    return entry


def _record_history(store: dict[str, Any], entry: dict[str, Any]) -> None:
    history = store.setdefault("history", {})
    current = history.get(entry["providerId"], [])
    history[entry["providerId"]] = [entry, *current][:25]


def list_subscriptions() -> list[dict[str, Any]]:
    now = _now_ms()
    with _STORE_LOCK:
        store = _ensure_store()
        subscriptions = store.get("subscriptions", {})
        records = [
            _normalize_record(provider_id, subscriptions.get(provider_id), now)
            for provider_id in _PROVIDER_ORDER
        ]
        for provider_id, raw in subscriptions.items():
            if provider_id not in _PROVIDER_NAMES:
                records.append(_normalize_record(provider_id, raw, now))
        return records


def get_subscription(provider_id: str) -> dict[str, Any]:
    now = _now_ms()
    with _STORE_LOCK:
        store = _ensure_store()
        subscriptions = store.get("subscriptions", {})
        return _normalize_record(provider_id, subscriptions.get(provider_id), now)


def list_history(provider_id: str) -> list[dict[str, Any]]:
    with _STORE_LOCK:
        store = _ensure_store()
        history = store.get("history", {})
        entries = history.get(provider_id, [])
        return [deepcopy(entry) for entry in entries if isinstance(entry, dict)]


def upsert_subscription(provider_id: str, updates: dict[str, Any], event_type: str, summary: str) -> dict[str, Any]:
    now = _now_ms()
    with _STORE_LOCK:
        store = _ensure_store()
        subscriptions = store.setdefault("subscriptions", {})
        current = _normalize_record(provider_id, subscriptions.get(provider_id), now)
        next_record = deepcopy(current)

        if "providerName" in updates:
            next_record["providerName"] = str(updates["providerName"])
        if "activeSource" in updates and updates["activeSource"] in {"manual", "synced"}:
            next_record["activeSource"] = updates["activeSource"]
        if "manualValue" in updates:
            next_record["manualValue"] = _coerce_value(updates.get("manualValue"), now)
        if "syncedValue" in updates:
            next_record["syncedValue"] = _coerce_value(updates.get("syncedValue"), now)
        if "connection" in updates:
            next_record["connection"] = _normalize_connection(provider_id, updates.get("connection"), now)
        if "displayUnit" in updates:
            next_record["displayUnit"] = str(updates["displayUnit"])
        if "metricKind" in updates:
            next_record["metricKind"] = str(updates["metricKind"])
        if "confidence" in updates:
            next_record["confidence"] = str(updates["confidence"])
        if "lastError" in updates:
            next_record["lastError"] = updates["lastError"]
            next_record.setdefault("connection", _default_connection(provider_id, now))["lastError"] = updates["lastError"]
        if "notes" in updates:
            next_record["notes"] = _merge_notes(next_record.get("notes", []), _coerce_notes(updates.get("notes")))
        if "renewalAt" in updates:
            next_record["renewalAt"] = updates.get("renewalAt")
        if "resetAt" in updates:
            next_record["resetAt"] = updates.get("resetAt")
        if "sourceUpdatedAt" in updates:
            next_record["sourceUpdatedAt"] = int(updates.get("sourceUpdatedAt") or now)
        else:
            next_record["sourceUpdatedAt"] = now
        if "staleAfterMs" in updates:
            next_record["staleAfterMs"] = int(updates.get("staleAfterMs") or _DEFAULT_STALE_AFTER_MS)
        if "status" in updates:
            next_record["status"] = str(updates["status"])

        next_record["status"] = _derive_status(next_record)
        subscriptions[provider_id] = next_record
        entry = _history_entry(
            provider_id,
            event_type,
            before_value=current.get("manualValue") if event_type == "manual_update" else current.get("syncedValue") or current.get("manualValue"),
            after_value=next_record.get("manualValue") if event_type == "manual_update" else next_record.get("syncedValue") or next_record.get("manualValue"),
            summary=summary,
            source_type=str((next_record.get("connection") or {}).get("connectorKind") or _DEFAULT_CONNECTION_KIND),
            details=str(updates.get("details")) if updates.get("details") else None,
            now=now,
        )
        _record_history(store, entry)
        _save_store(store)
        return deepcopy(next_record)


def connect_subscription(provider_id: str, connector_kind: str, label: str | None = None) -> dict[str, Any]:
    now = _now_ms()
    with _STORE_LOCK:
        store = _ensure_store()
        subscriptions = store.setdefault("subscriptions", {})
        current = _normalize_record(provider_id, subscriptions.get(provider_id), now)
        next_record = deepcopy(current)
        next_record["connection"] = {
            **current.get("connection", _default_connection(provider_id, now)),
            "connected": True,
            "connectedAt": current.get("connection", {}).get("connectedAt") or now,
            "connectorKind": connector_kind,
            "lastCheckedAt": now,
            "label": label or f"{current['providerName']} {connector_kind}",
        }
        if next_record.get("syncedValue") and next_record.get("activeSource") != "manual":
            next_record["activeSource"] = "synced"
        next_record["status"] = _derive_status(next_record)
        subscriptions[provider_id] = next_record
        entry = _history_entry(
            provider_id,
            "connect",
            before_value=current.get("manualValue") or current.get("syncedValue"),
            after_value=next_record.get("syncedValue") or next_record.get("manualValue"),
            summary=f"Connected {current['providerName']} via {connector_kind}",
            source_type=connector_kind,
            now=now,
        )
        _record_history(store, entry)
        _save_store(store)
        return deepcopy(next_record)


def disconnect_subscription(provider_id: str) -> dict[str, Any]:
    now = _now_ms()
    with _STORE_LOCK:
        store = _ensure_store()
        subscriptions = store.setdefault("subscriptions", {})
        current = _normalize_record(provider_id, subscriptions.get(provider_id), now)
        next_record = deepcopy(current)
        next_record["connection"] = {
            **current.get("connection", _default_connection(provider_id, now)),
            "connected": False,
            "lastCheckedAt": now,
        }
        next_record["status"] = "disconnected"
        subscriptions[provider_id] = next_record
        entry = _history_entry(
            provider_id,
            "disconnect",
            before_value=current.get("syncedValue") or current.get("manualValue"),
            after_value=None,
            summary=f"Disconnected {current['providerName']} connector",
            source_type=str((current.get("connection") or {}).get("connectorKind") or _DEFAULT_CONNECTION_KIND),
            now=now,
        )
        _record_history(store, entry)
        _save_store(store)
        return deepcopy(next_record)


def sync_subscription(provider_id: str, synced_value: dict[str, Any] | None = None, last_error: str | None = None) -> dict[str, Any]:
    now = _now_ms()
    with _STORE_LOCK:
        store = _ensure_store()
        subscriptions = store.setdefault("subscriptions", {})
        current = _normalize_record(provider_id, subscriptions.get(provider_id), now)
        next_record = deepcopy(current)
        next_record["connection"] = {
            **current.get("connection", _default_connection(provider_id, now)),
            "lastCheckedAt": now,
        }
        if synced_value is not None:
            next_record["syncedValue"] = _coerce_value(synced_value, now)
            next_record["lastError"] = None
            next_record["status"] = "synced" if next_record["connection"].get("connected") else "stale"
        elif last_error:
            next_record["lastError"] = last_error
            next_record["connection"]["lastError"] = last_error
            next_record["status"] = "error"
        else:
            next_record["status"] = _derive_status(next_record)
        subscriptions[provider_id] = next_record
        entry = _history_entry(
            provider_id,
            "sync",
            before_value=current.get("syncedValue") or current.get("manualValue"),
            after_value=next_record.get("syncedValue") or next_record.get("manualValue"),
            summary=f"Synced {current['providerName']} subscription",
            source_type=str((next_record.get("connection") or {}).get("connectorKind") or _DEFAULT_CONNECTION_KIND),
            details=last_error,
            now=now,
        )
        _record_history(store, entry)
        _save_store(store)
        return deepcopy(next_record)


def update_history(provider_id: str, entry: dict[str, Any]) -> dict[str, Any]:
    now = _now_ms()
    with _STORE_LOCK:
        store = _ensure_store()
        history = store.setdefault("history", {})
        current = history.get(provider_id, [])
        next_entry = {
            "afterValue": _coerce_value(entry.get("afterValue"), now),
            "beforeValue": _coerce_value(entry.get("beforeValue"), now),
            "createdAt": int(entry.get("createdAt") or now),
            "details": entry.get("details"),
            "eventType": str(entry.get("eventType") or "manual_update"),
            "id": str(entry.get("id") or f"subevt-{uuid.uuid4().hex[:12]}"),
            "providerId": provider_id,
            "sourceType": str(entry.get("sourceType") or _DEFAULT_CONNECTION_KIND),
            "summary": str(entry.get("summary") or ""),
        }
        history[provider_id] = [next_entry, *[e for e in current if isinstance(e, dict)]][:25]
        _save_store(store)
        return deepcopy(next_entry)


def clear_store() -> None:
    with _STORE_LOCK:
        path = _store_path()
        if path.exists():
            path.unlink()
