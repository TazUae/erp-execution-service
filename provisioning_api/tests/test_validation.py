"""Pure validation tests (no Frappe runtime required)."""

import pytest

from provisioning_api.utils.validation import parse_api_username, parse_domain, parse_site_name


def test_parse_site_name_ok_slug() -> None:
    assert parse_site_name("valid-site") == "valid-site"


def test_parse_site_name_ok_fqdn() -> None:
    assert parse_site_name("erp.zaidan-group.com") == "erp.zaidan-group.com"


def test_parse_site_name_normalizes_case() -> None:
    assert parse_site_name("ERP.Zaidan-Group.COM") == "erp.zaidan-group.com"


@pytest.mark.parametrize(
    "raw",
    ["ab", "", "Bad_Site", "foo..bar", None, "foo/bar", "..", "x" * 254],
)
def test_parse_site_name_rejects(raw: str | None) -> None:
    with pytest.raises(ValueError):
        parse_site_name(raw)


def test_parse_domain_ok() -> None:
    assert parse_domain("app.example.com") == "app.example.com"


def test_parse_api_username_ok() -> None:
    assert parse_api_username("api_user") == "api_user"
