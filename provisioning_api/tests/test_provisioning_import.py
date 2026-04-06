"""Ensure provisioning RPC module imports cleanly (Frappe stub only)."""


def test_provisioning_module_importable() -> None:
    import provisioning_api.api.provisioning as p

    assert callable(p.create_site)
    assert callable(p.read_site_db_name)
    assert callable(p.install_erp)
    assert callable(p.enable_scheduler)
    assert callable(p.add_domain)
    assert callable(p.create_api_user)
