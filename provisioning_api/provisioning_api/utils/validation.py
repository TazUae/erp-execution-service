"""Pure input validation (no I/O, no secrets). Raises ``ValueError`` with safe messages."""

from __future__ import annotations

import re

# Practical FQDN / hostname: labels 1–63 chars, alnum + hyphen, dots between labels.
# Total length <= 253. Lowercase normalized by caller.
_MAX_HOST_LEN = 253


def _labels_valid(s: str) -> bool:
    if not s or len(s) > _MAX_HOST_LEN:
        return False
    if s.startswith(".") or s.endswith(".") or ".." in s:
        return False
    labels = s.split(".")
    for label in labels:
        if not label or len(label) > 63:
            return False
        if label[0] == "-" or label[-1] == "-":
            return False
        if not re.match(r"^[a-z0-9-]+$", label):
            return False
    return True


def parse_site_name(site_name: str | None) -> str:
    """
    Validate a site name as a hostname or FQDN (e.g. ``erp.zaidan-group.com``).

    Rejects path separators, Unicode homoglyphs, and other unsafe values.
    """
    if site_name is None or not isinstance(site_name, str):
        raise ValueError("site_name is required")
    s = site_name.strip().lower()
    if len(s) < 3:
        raise ValueError("site_name must be at least 3 characters")
    if len(s) > _MAX_HOST_LEN:
        raise ValueError("site_name is too long")
    if not _labels_valid(s):
        raise ValueError("site_name has invalid format (use a hostname or FQDN)")
    return s


def parse_domain(domain: str | None) -> str:
    if domain is None or not isinstance(domain, str):
        raise ValueError("domain is required")
    d = domain.strip().lower()
    # Reuse hostname rules; domains are hostnames without extra path characters.
    if len(d) < 3 or len(d) > _MAX_HOST_LEN:
        raise ValueError("domain has invalid length")
    if not _labels_valid(d):
        raise ValueError("domain has invalid format")
    return d


_USER = re.compile(r"^[a-z][a-z0-9_.-]{2,63}$")


def parse_api_username(api_username: str | None) -> str:
    if api_username is None or not isinstance(api_username, str):
        raise ValueError("api_username is required")
    u = api_username.strip().lower()
    if not _USER.match(u):
        raise ValueError("api_username has invalid format")
    return u
