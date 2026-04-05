"""Pure input validation (no I/O, no secrets). Raises ``ValueError`` with safe messages."""

from __future__ import annotations

import re

_SITE = re.compile(r"^[a-z0-9-]+$")
# Practical hostname-style check (not full RFC 1035).
_DOMAIN = re.compile(
    r"^(?=.{3,253}$)(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$",
    re.IGNORECASE,
)
_USER = re.compile(r"^[a-z][a-z0-9_.-]{2,63}$")


def parse_site_name(site_name: str | None) -> str:
    if site_name is None or not isinstance(site_name, str):
        raise ValueError("site_name is required")
    s = site_name.strip()
    if len(s) < 3 or len(s) > 50:
        raise ValueError("site_name must be between 3 and 50 characters")
    if not _SITE.match(s):
        raise ValueError("site_name has invalid format (use lowercase letters, digits, hyphen)")
    return s


def parse_domain(domain: str | None) -> str:
    if domain is None or not isinstance(domain, str):
        raise ValueError("domain is required")
    d = domain.strip().lower()
    if not _DOMAIN.match(d):
        raise ValueError("domain has invalid format")
    return d


def parse_api_username(api_username: str | None) -> str:
    if api_username is None or not isinstance(api_username, str):
        raise ValueError("api_username is required")
    u = api_username.strip().lower()
    if not _USER.match(u):
        raise ValueError("api_username has invalid format")
    return u
