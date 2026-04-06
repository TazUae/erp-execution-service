"""site_config.json db_name resolution (filesystem; no Frappe bench)."""

import json
from pathlib import Path

import frappe
import pytest

from provisioning_api.exceptions import ErrorCode
from provisioning_api.utils import site_db


def test_read_db_name_success(tmp_path: Path) -> None:
    site = "erp.example.com"
    site_dir = tmp_path / site
    site_dir.mkdir(parents=True)
    (site_dir / "site_config.json").write_text(
        json.dumps({"db_name": "my_db", "db_password": "SECRET"}),
        encoding="utf-8",
    )

    assert site_db.read_db_name_from_site_config(str(tmp_path), site) == "my_db"


def test_read_db_name_missing_site_dir(tmp_path: Path) -> None:
    with pytest.raises(site_db.SiteDbResolutionError) as exc:
        site_db.read_db_name_from_site_config(str(tmp_path), "missing.example.com")
    assert exc.value.code == ErrorCode.SITE_NOT_FOUND


def test_read_db_name_missing_site_config(tmp_path: Path) -> None:
    site = "erp.example.com"
    site_dir = tmp_path / site
    site_dir.mkdir(parents=True)

    with pytest.raises(site_db.SiteDbResolutionError) as exc:
        site_db.read_db_name_from_site_config(str(tmp_path), site)
    assert exc.value.code == ErrorCode.SITE_CONFIG_MISSING


def test_read_db_name_invalid_json(tmp_path: Path) -> None:
    site = "erp.example.com"
    site_dir = tmp_path / site
    site_dir.mkdir(parents=True)
    (site_dir / "site_config.json").write_text("{not json", encoding="utf-8")

    with pytest.raises(site_db.SiteDbResolutionError) as exc:
        site_db.read_db_name_from_site_config(str(tmp_path), site)
    assert exc.value.code == ErrorCode.SITE_CONFIG_INVALID


def test_read_db_name_missing_db_name_key(tmp_path: Path) -> None:
    site = "erp.example.com"
    site_dir = tmp_path / site
    site_dir.mkdir(parents=True)
    (site_dir / "site_config.json").write_text(json.dumps({"other": "x"}), encoding="utf-8")

    with pytest.raises(site_db.SiteDbResolutionError) as exc:
        site_db.read_db_name_from_site_config(str(tmp_path), site)
    assert exc.value.code == ErrorCode.SITE_CONFIG_INVALID


def test_read_db_name_non_string_db_name(tmp_path: Path) -> None:
    site = "erp.example.com"
    site_dir = tmp_path / site
    site_dir.mkdir(parents=True)
    (site_dir / "site_config.json").write_text(json.dumps({"db_name": 123}), encoding="utf-8")

    with pytest.raises(site_db.SiteDbResolutionError) as exc:
        site_db.read_db_name_from_site_config(str(tmp_path), site)
    assert exc.value.code == ErrorCode.SITE_CONFIG_INVALID


def test_path_traversal_rejected(tmp_path: Path) -> None:
    (tmp_path / "victim").mkdir()
    with pytest.raises(site_db.SiteDbResolutionError) as exc:
        site_db.read_db_name_from_site_config(str(tmp_path), "../victim")
    assert exc.value.code == ErrorCode.SITE_NOT_FOUND


def test_read_site_db_name_for_current_bench(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    site = "erp.example.com"
    site_dir = tmp_path / site
    site_dir.mkdir(parents=True)
    (site_dir / "site_config.json").write_text(
        json.dumps({"db_name": "bench_db"}),
        encoding="utf-8",
    )

    monkeypatch.setattr(frappe.local, "sites_path", str(tmp_path))

    assert site_db.read_site_db_name_for_current_bench(site) == "bench_db"
