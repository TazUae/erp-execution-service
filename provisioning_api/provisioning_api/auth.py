"""
Authentication helpers for the provisioning API.

Frappe already authenticates ``Authorization: token <api_key>:<api_secret>`` on API routes.
This module rejects unauthenticated **Guest** sessions and optionally enforces an extra
shared secret when configured (defense in depth — does not replace token auth).
"""

from __future__ import annotations

import frappe
from frappe import _


def require_api_auth() -> None:
    """
    Ensure the request is not an unauthenticated Guest session.

    After successful Frappe API key / session auth, ``frappe.session.user`` is not ``Guest``.
    """
    if frappe.session.user == "Guest":
        frappe.throw(_("Authentication required"), frappe.AuthenticationError)


def require_optional_internal_secret() -> None:
    """
    If ``provisioning_api_internal_secret`` is set in site config, require matching header.

    Header: ``X-Provisioning-Internal-Secret: <secret>``

    When the secret is **not** configured, this is a no-op so standard token auth is unchanged.
    """
    secret = frappe.conf.get("provisioning_api_internal_secret")
    if not secret:
        return
    header = frappe.get_request_header("X-Provisioning-Internal-Secret")
    if not header or header != secret:
        frappe.throw(_("Invalid or missing internal provisioning secret"), frappe.AuthenticationError)


def require_provisioning_access() -> None:
    """Apply Guest check, optional internal secret, then allow the handler to proceed."""
    require_api_auth()
    require_optional_internal_secret()
