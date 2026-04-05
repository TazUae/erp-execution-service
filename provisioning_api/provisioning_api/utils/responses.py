"""Structured JSON helpers for whitelisted API methods."""

from __future__ import annotations

from typing import Any

import frappe

from provisioning_api.exceptions import ErrorCode


def success_response(data: dict[str, Any] | None = None, message: str | None = None) -> dict[str, Any]:
    """Return a successful contract envelope: ``{ ok: true, data: {...} }``."""
    body: dict[str, Any] = {"ok": True, "data": data if data is not None else {}}
    if message is not None:
        body["message"] = message
    return body


def error_response(
    code: str,
    message: str,
    *,
    http_status: int | None = None,
) -> dict[str, Any]:
    """Return an error contract envelope and optionally set the HTTP status on the Frappe response."""
    if http_status is not None:
        frappe.response["http_status_code"] = http_status
    return {"ok": False, "error": {"code": code, "message": message}}


def not_implemented_payload(operation: str) -> dict[str, Any]:
    """
    Stub outcome for scaffold phase: explicit NOT_IMPLEMENTED without claiming success.

    Sets HTTP 501 on the Frappe response object.
    """
    frappe.response["http_status_code"] = 501
    return {
        "ok": False,
        "error": {
            "code": ErrorCode.NOT_IMPLEMENTED,
            "message": (
                f"{operation} is not implemented yet; provisioning_api is contract scaffold only."
            ),
        },
    }


def validation_error(message: str) -> dict[str, Any]:
    """Validation failure with HTTP 400."""
    return error_response(ErrorCode.VALIDATION_ERROR, message, http_status=400)
