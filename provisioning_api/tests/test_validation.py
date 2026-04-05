"""Pure validation tests (no Frappe runtime required)."""

import pytest

from provisioning_api.utils.validation import parse_api_username, parse_domain, parse_site_name


def test_parse_site_name_ok() -> None:
    assert parse_site_name("valid-site") == "valid-site"


@pytest.mark.parametrize(
    "raw",
    ["ab", "", "Bad_Site", "UPPER", None],
)
def test_parse_site_name_rejects(raw: str | None) -> None:
    with pytest.raises(ValueError):
        parse_site_name(raw)


def test_parse_domain_ok() -> None:
    assert parse_domain("app.example.com") == "app.example.com"


def test_parse_api_username_ok() -> None:
    assert parse_api_username("api_user") == "api_user"

