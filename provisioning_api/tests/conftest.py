"""
Minimal ``frappe`` stub so unit tests can import app modules without a bench.

Real Frappe replaces this at runtime; do not use for integration tests.
"""

from __future__ import annotations

import sys
from types import ModuleType, SimpleNamespace


def _install_stub() -> None:
    if "frappe" in sys.modules:
        return
    m = ModuleType("frappe")

    def _throw(msg, exc=None, *a, **k):
        if exc:
            raise exc(msg)
        raise RuntimeError(msg)

    m._ = lambda x: x
    m.throw = _throw
    m.AuthenticationError = type("AuthenticationError", (Exception,), {})
    m.get_request_header = lambda *a, **k: None
    m.conf = SimpleNamespace(get=lambda k, d=None: None)
    m.local = SimpleNamespace(sites_path=None)
    m.response = {}

    def whitelist(**kwargs):
        def _decorator(f):
            return f

        return _decorator

    m.whitelist = whitelist
    sys.modules["frappe"] = m


_install_stub()
