"""
Provisioning API authentication: ``X-Provisioning-Token`` only (Guest-safe).

Compared to ``provisioning_api_token`` from merged site / common site config (``frappe.conf``).
No Frappe session or API key requirement for these RPCs.
"""

from __future__ import annotations

import hmac

import frappe
from frappe import _

_PROVISIONING_TOKEN_HEADER = "X-Provisioning-Token"
_CONFIG_KEY = "provisioning_api_token"


def verify_provisioning_token() -> None:
    """
    Ensure the request carries the configured provisioning shared secret (constant-time).

    Raises ``frappe.AuthenticationError`` when the token is missing, wrong, or unset in config.
    """
    expected = frappe.conf.get(_CONFIG_KEY)
    if not expected:
        frappe.throw(
            _("provisioning_api_token is not configured"),
            frappe.AuthenticationError,
        )
    exp_bytes = str(expected).encode("utf-8")
    got_raw = frappe.get_request_header(_PROVISIONING_TOKEN_HEADER)
    got_bytes = got_raw.encode("utf-8") if got_raw else b""
    if len(got_bytes) != len(exp_bytes) or not hmac.compare_digest(got_bytes, exp_bytes):
        frappe.throw(
            _("Invalid or missing provisioning token"),
            frappe.AuthenticationError,
        )


def require_provisioning_access() -> None:
    """Enforce provisioning token auth (for use at the start of whitelisted handlers)."""
    verify_provisioning_token()
