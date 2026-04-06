"""Provisioning token auth (mocked Frappe)."""

from unittest.mock import MagicMock

import pytest

import provisioning_api.auth as auth


@pytest.fixture
def mock_frappe(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    m = MagicMock()
    m.AuthenticationError = type("AuthenticationError", (Exception,), {})

    def _throw(msg, exc=None, *a, **k):
        if exc is not None:
            raise exc(msg)
        raise RuntimeError(msg)

    m.throw = MagicMock(side_effect=_throw)
    monkeypatch.setattr(auth, "frappe", m)
    return m


def test_verify_accepts_matching_token(mock_frappe: MagicMock) -> None:
    mock_frappe.conf.get.return_value = "secret-token-value"
    mock_frappe.get_request_header.return_value = "secret-token-value"

    auth.verify_provisioning_token()

    mock_frappe.throw.assert_not_called()


def test_verify_accepts_token_for_guest_session(mock_frappe: MagicMock) -> None:
    """Provisioning RPCs use ``allow_guest=True``; token must succeed without a logged-in user."""
    mock_frappe.session = MagicMock()
    mock_frappe.session.user = "Guest"
    mock_frappe.conf.get.return_value = "secret-token-value"
    mock_frappe.get_request_header.return_value = "secret-token-value"

    auth.verify_provisioning_token()

    mock_frappe.throw.assert_not_called()


def test_verify_rejects_missing_token(mock_frappe: MagicMock) -> None:
    mock_frappe.conf.get.return_value = "secret-token-value"
    mock_frappe.get_request_header.return_value = None

    with pytest.raises(mock_frappe.AuthenticationError):
        auth.verify_provisioning_token()

    mock_frappe.throw.assert_called_once()
    assert mock_frappe.AuthenticationError in mock_frappe.throw.call_args[0]


def test_verify_rejects_wrong_token(mock_frappe: MagicMock) -> None:
    mock_frappe.conf.get.return_value = "expected"
    mock_frappe.get_request_header.return_value = "wrong-one"

    with pytest.raises(mock_frappe.AuthenticationError):
        auth.verify_provisioning_token()

    mock_frappe.throw.assert_called_once()


def test_verify_rejects_unconfigured_token(mock_frappe: MagicMock) -> None:
    mock_frappe.conf.get.return_value = None

    with pytest.raises(mock_frappe.AuthenticationError):
        auth.verify_provisioning_token()

    mock_frappe.throw.assert_called_once()


def test_verify_rejects_length_mismatch_constant_time_path(mock_frappe: MagicMock) -> None:
    mock_frappe.conf.get.return_value = "short"
    mock_frappe.get_request_header.return_value = "much-longer-token-value"

    with pytest.raises(mock_frappe.AuthenticationError):
        auth.verify_provisioning_token()

    mock_frappe.throw.assert_called_once()
