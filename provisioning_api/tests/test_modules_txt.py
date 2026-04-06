"""Guard Frappe ``modules.txt`` so the app module list stays correct."""

from pathlib import Path


def test_modules_txt_lists_api_only() -> None:
    root = Path(__file__).resolve().parent.parent / "provisioning_api" / "modules.txt"
    text = root.read_text(encoding="utf-8")
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    assert lines == ["api"], "modules.txt must list exactly one module: api (not provisioning_api)"
