"""Resolve site database name from ``site_config.json`` (no secrets returned)."""

from __future__ import annotations

import json
import os
from typing import Any

from provisioning_api.exceptions import ErrorCode


class SiteDbResolutionError(Exception):
    """Expected failure resolving ``db_name`` for a site (maps to HTTP + JSON envelope)."""

    def __init__(self, code: str, message: str, http_status: int) -> None:
        super().__init__(message)
        self.code = code
        self.http_status = http_status


def _safe_site_dir(sites_path: str, site_name: str) -> str:
    base = os.path.realpath(sites_path)
    candidate = os.path.realpath(os.path.join(base, site_name))
    try:
        common = os.path.commonpath([base, candidate])
    except ValueError:
        raise SiteDbResolutionError(
            ErrorCode.SITE_NOT_FOUND,
            "site path is not under sites directory",
            404,
        ) from None
    if common != base:
        raise SiteDbResolutionError(
            ErrorCode.SITE_NOT_FOUND,
            "site path is not under sites directory",
            404,
        )
    return candidate


def read_db_name_from_site_config(sites_path: str, site_name: str) -> str:
    """
    Load ``db_name`` from ``<sites_path>/<site_name>/site_config.json``.

    ``site_name`` must already be validated (hostname/FQDN). No shell, no bench.
    """
    site_dir = _safe_site_dir(sites_path, site_name)
    if not os.path.isdir(site_dir):
        raise SiteDbResolutionError(
            ErrorCode.SITE_NOT_FOUND,
            "site directory does not exist",
            404,
        )

    config_path = os.path.join(site_dir, "site_config.json")
    if not os.path.isfile(config_path):
        raise SiteDbResolutionError(
            ErrorCode.SITE_CONFIG_MISSING,
            "site_config.json not found",
            404,
        )

    try:
        with open(config_path, encoding="utf-8") as f:
            data: Any = json.load(f)
    except json.JSONDecodeError as exc:
        raise SiteDbResolutionError(
            ErrorCode.SITE_CONFIG_INVALID,
            f"site_config.json is not valid JSON ({exc})",
            400,
        ) from exc
    except OSError as exc:
        raise SiteDbResolutionError(
            ErrorCode.SITE_CONFIG_INVALID,
            f"cannot read site_config.json ({exc})",
            400,
        ) from exc

    if not isinstance(data, dict):
        raise SiteDbResolutionError(
            ErrorCode.SITE_CONFIG_INVALID,
            "site_config.json must contain a JSON object",
            400,
        )

    raw = data.get("db_name")
    if raw is None:
        raise SiteDbResolutionError(
            ErrorCode.SITE_CONFIG_INVALID,
            "db_name is not set in site_config.json",
            400,
        )
    if not isinstance(raw, str) or not raw.strip():
        raise SiteDbResolutionError(
            ErrorCode.SITE_CONFIG_INVALID,
            "db_name must be a non-empty string",
            400,
        )

    return raw.strip()


def read_site_db_name_for_current_bench(site_name: str) -> str:
    """Resolve ``db_name`` using ``frappe.local.sites_path`` for the active request."""
    import frappe

    sites_path = getattr(frappe.local, "sites_path", None)
    if not sites_path or not isinstance(sites_path, str):
        raise SiteDbResolutionError(
            ErrorCode.INTERNAL_ERROR,
            "sites_path is not available",
            500,
        )
    return read_db_name_from_site_config(sites_path, site_name)
