"""
Whitelisted provisioning RPCs for ``erp-execution-service``.

HTTP: ``POST /api/method/provisioning_api.api.provisioning.<method_name>``

These handlers are **intentionally stubbed** (no bench, no shell, no real provisioning).
"""

from __future__ import annotations

import frappe

from provisioning_api.auth import require_provisioning_access
from provisioning_api.utils.logging import log_provisioning_event
from provisioning_api.utils.responses import not_implemented_payload, validation_error
from provisioning_api.utils.validation import parse_api_username, parse_domain, parse_site_name


def _log_validation_failure(method: str, message: str) -> None:
    log_provisioning_event(method=method, outcome="validation_error", extra={"error": message})


@frappe.whitelist(methods=["POST"], allow_guest=False)
def create_site(site_name: str | None = None, **kwargs) -> dict:
    """Contract stub: create a site (not implemented)."""
    del kwargs  # absorb unknown JSON keys without using them
    require_provisioning_access()
    try:
        site = parse_site_name(site_name)
    except ValueError as exc:
        _log_validation_failure("create_site", str(exc))
        return validation_error(str(exc))
    log_provisioning_event(method="create_site", site_name=site, outcome="not_implemented")
    return not_implemented_payload("create_site")


@frappe.whitelist(methods=["POST"], allow_guest=False)
def read_site_db_name(site_name: str | None = None, **kwargs) -> dict:
    """Contract stub: resolve DB name for a site (not implemented)."""
    del kwargs
    require_provisioning_access()
    try:
        site = parse_site_name(site_name)
    except ValueError as exc:
        _log_validation_failure("read_site_db_name", str(exc))
        return validation_error(str(exc))
    log_provisioning_event(method="read_site_db_name", site_name=site, outcome="not_implemented")
    return not_implemented_payload("read_site_db_name")


@frappe.whitelist(methods=["POST"], allow_guest=False)
def install_erp(site_name: str | None = None, **kwargs) -> dict:
    """Contract stub: install ERP apps on a site (not implemented)."""
    del kwargs
    require_provisioning_access()
    try:
        site = parse_site_name(site_name)
    except ValueError as exc:
        _log_validation_failure("install_erp", str(exc))
        return validation_error(str(exc))
    log_provisioning_event(method="install_erp", site_name=site, outcome="not_implemented")
    return not_implemented_payload("install_erp")


@frappe.whitelist(methods=["POST"], allow_guest=False)
def enable_scheduler(site_name: str | None = None, **kwargs) -> dict:
    """Contract stub: enable scheduler for a site (not implemented)."""
    del kwargs
    require_provisioning_access()
    try:
        site = parse_site_name(site_name)
    except ValueError as exc:
        _log_validation_failure("enable_scheduler", str(exc))
        return validation_error(str(exc))
    log_provisioning_event(method="enable_scheduler", site_name=site, outcome="not_implemented")
    return not_implemented_payload("enable_scheduler")


@frappe.whitelist(methods=["POST"], allow_guest=False)
def add_domain(site_name: str | None = None, domain: str | None = None, **kwargs) -> dict:
    """Contract stub: bind a domain to a site (not implemented)."""
    del kwargs
    require_provisioning_access()
    try:
        site = parse_site_name(site_name)
        dom = parse_domain(domain)
    except ValueError as exc:
        _log_validation_failure("add_domain", str(exc))
        return validation_error(str(exc))
    log_provisioning_event(
        method="add_domain",
        site_name=site,
        outcome="not_implemented",
        extra={"domain": dom},
    )
    return not_implemented_payload("add_domain")


@frappe.whitelist(methods=["POST"], allow_guest=False)
def create_api_user(
    site_name: str | None = None,
    api_username: str | None = None,
    **kwargs,
) -> dict:
    """Contract stub: create an API user on a site (not implemented)."""
    del kwargs
    require_provisioning_access()
    try:
        site = parse_site_name(site_name)
        user = parse_api_username(api_username)
    except ValueError as exc:
        _log_validation_failure("create_api_user", str(exc))
        return validation_error(str(exc))
    log_provisioning_event(
        method="create_api_user",
        site_name=site,
        outcome="not_implemented",
        extra={"api_username": user},
    )
    return not_implemented_payload("create_api_user")
