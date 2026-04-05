"""Structured logging for provisioning API calls (no secrets)."""

from __future__ import annotations

import logging
from typing import Any

import frappe

_LOG = logging.getLogger("provisioning_api")


def log_provisioning_event(
    *,
    method: str,
    site_name: str | None = None,
    outcome: str,
    extra: dict[str, Any] | None = None,
) -> None:
    """
    Log a provisioning API invocation.

    Includes optional ``site_name`` and request correlation id from headers when present.
    Never log tokens, API secrets, or Authorization headers.
    """
    request_id = (
        frappe.get_request_header("X-Request-Id")
        or frappe.get_request_header("X-Request-ID")
        or frappe.get_request_header("X-Frappe-Request-Id")
    )
    payload: dict[str, Any] = {
        "method": method,
        "outcome": outcome,
    }
    if site_name is not None:
        payload["site_name"] = site_name
    if request_id:
        payload["request_id"] = request_id
    if extra:
        for key, value in extra.items():
            if key.lower() in {"authorization", "token", "secret", "password"}:
                continue
            payload[key] = value
    _LOG.info("provisioning_api %s", payload)
