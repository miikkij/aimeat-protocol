"""
Smoke tests that don't require a running AIMEAT node or LLM. These verify
that the package structure is sound and the public surface is importable.
"""
from __future__ import annotations


def test_top_level_imports() -> None:
    """Every name in __all__ must be importable from the top-level package."""
    import aimeat_crewai

    expected = {
        "__version__",
        "create_liaison_agent",
        "liaison_tools",
        "AimeatLiaisonError",
        "AimeatServeError",
        "stdio_params",
        "http_params",
        "sse_params",
        "serve_params",
        "ensure_serve",
    }
    assert expected <= set(dir(aimeat_crewai)), (
        f"Missing from package surface: {expected - set(dir(aimeat_crewai))}"
    )


def test_version_is_string() -> None:
    from aimeat_crewai import __version__

    assert isinstance(__version__, str)
    assert __version__.count(".") >= 2, f"Expected semver-ish version, got {__version__!r}"


def test_stdio_params_builds_with_defaults() -> None:
    """stdio_params should be callable with no args (uses primary agent).

    On Windows hosts where `aimeat` is installed as an npm .cmd/.bat shim,
    `_resolve_windows_command` wraps it as `cmd.exe /c aimeat` (the stdio MCP
    client cannot CreateProcess a shim directly) -- accept both forms.
    """
    from aimeat_crewai import stdio_params

    p = stdio_params()
    if p.command == "cmd.exe":
        assert p.args[:2] == ["/c", "aimeat"]
    else:
        assert p.command == "aimeat"
    assert "connect" in p.args and "serve" in p.args
    # No --agent flag when none given
    assert "--agent" not in p.args


def test_stdio_params_with_agent() -> None:
    from aimeat_crewai import stdio_params

    p = stdio_params(agent_name="company-crew")
    assert "--agent" in p.args
    idx = p.args.index("--agent")
    assert p.args[idx + 1] == "company-crew"


def test_http_params_shape() -> None:
    from aimeat_crewai import http_params

    p = http_params(node_url="https://aimeat.io/", agent_token="tok-123")
    assert p["url"] == "https://aimeat.io/v1/mcp"
    assert p["transport"] == "streamable-http"
    assert p["headers"]["Authorization"] == "Bearer tok-123"


def test_sse_params_shape() -> None:
    from aimeat_crewai import sse_params

    p = sse_params(node_url="http://localhost:40050", agent_token="tok-x")
    assert p["url"].startswith("http://localhost:40050/")
    assert p["transport"] == "sse"
    assert p["headers"]["Authorization"] == "Bearer tok-x"


def test_create_liaison_agent_requires_mcp_params() -> None:
    """Passing None should raise a clear error rather than failing inside the adapter."""
    from aimeat_crewai import create_liaison_agent, AimeatLiaisonError
    import pytest

    with pytest.raises(AimeatLiaisonError, match="mcp_server_params"):
        with create_liaison_agent(mcp_server_params=None):
            pass


def test_extract_agent_name_from_stdio_params() -> None:
    """Internal helper: stdio_params(agent_name=X) should be readable back."""
    from aimeat_crewai import stdio_params
    from aimeat_crewai.liaison import _extract_agent_name_from_params

    p = stdio_params(agent_name="company-crew")
    assert _extract_agent_name_from_params(p) == "company-crew"

    p_no_agent = stdio_params()
    assert _extract_agent_name_from_params(p_no_agent) is None


def test_default_backstory_template_has_placeholder() -> None:
    """Template must contain {agent_name} so the factory can inject the name."""
    from aimeat_crewai.liaison import DEFAULT_BACKSTORY_TEMPLATE

    assert "{agent_name}" in DEFAULT_BACKSTORY_TEMPLATE
    # And the rendered legacy constant should NOT still contain the brace form
    from aimeat_crewai.liaison import DEFAULT_BACKSTORY
    assert "{agent_name}" not in DEFAULT_BACKSTORY


def test_windows_stdio_no_op_on_unix() -> None:
    """The Windows shim resolver must be a no-op on non-Windows hosts."""
    import sys
    from aimeat_crewai.mcp_client import _resolve_windows_command

    if sys.platform == "win32":
        # On Windows we can't usefully assert behaviour without a controlled PATH;
        # the integration test (running aimeat for real) covers this.
        return
    cmd, prefix = _resolve_windows_command("aimeat")
    assert cmd == "aimeat"
    assert prefix == []


def test_resolve_skill_path_none_for_missing_agent(tmp_path, monkeypatch) -> None:
    """Auto-detect returns None if the bundle dir doesn't exist."""
    from aimeat_crewai.liaison import _resolve_skill_path

    monkeypatch.setenv("AIMEAT_HOME", str(tmp_path))
    assert _resolve_skill_path("nonexistent-agent") is None
    assert _resolve_skill_path(None) is None
    assert _resolve_skill_path("") is None


def test_resolve_skill_path_finds_bundle(tmp_path, monkeypatch) -> None:
    """Auto-detect returns the agent dir when SKILL.md exists under AIMEAT_HOME."""
    from aimeat_crewai.liaison import _resolve_skill_path

    monkeypatch.setenv("AIMEAT_HOME", str(tmp_path))
    agent_dir = tmp_path / "demo-crew"
    agent_dir.mkdir()
    (agent_dir / "SKILL.md").write_text("---\nname: demo-crew\ndescription: x\n---\nbody")
    result = _resolve_skill_path("demo-crew")
    assert result == agent_dir


def test_read_token_uses_connector_keychain_layout(tmp_path, monkeypatch) -> None:
    """The daemon must read from the connector's keychain layout, not the
    skill-bundle directory. Regression test for the 0.3.0 bug where _read_token
    looked at ~/.aimeat/<agent>/.token (which is the skill-bundle dir)
    instead of ~/.aimeat/tokens/<agent>@<owner>.token (the actual keychain)."""
    from aimeat_crewai.daemon import _read_token

    # Set up the connector layout under a fake AIMEAT_HOME.
    monkeypatch.setenv("AIMEAT_HOME", str(tmp_path))
    tokens_dir = tmp_path / "tokens"
    tokens_dir.mkdir()
    (tokens_dir / "demo-crew@happyowner.token").write_text("test-bearer-token")
    agent_cfg_dir = tmp_path / "agents" / "demo-crew"
    agent_cfg_dir.mkdir(parents=True)
    (agent_cfg_dir / "config.yaml").write_text(
        "agent: demo-crew\nowner: happyowner\nnode_url: https://node.example\n"
    )

    token, node_url = _read_token("demo-crew", owner="happyowner")
    assert token == "test-bearer-token"
    assert node_url == "https://node.example"


def test_read_token_owner_auto_detect(tmp_path, monkeypatch) -> None:
    """When only one owner exists for the agent, _read_token can auto-detect it."""
    from aimeat_crewai.daemon import _read_token

    monkeypatch.setenv("AIMEAT_HOME", str(tmp_path))
    (tmp_path / "tokens").mkdir()
    (tmp_path / "tokens" / "demo-crew@happyowner.token").write_text("auto-detected")

    token, _ = _read_token("demo-crew")
    assert token == "auto-detected"


def test_read_token_ambiguous_owner_raises(tmp_path, monkeypatch) -> None:
    """Multiple owners for the same agent name -> caller must specify owner."""
    from aimeat_crewai.daemon import _read_token
    from aimeat_crewai import AimeatLiaisonError
    import pytest

    monkeypatch.setenv("AIMEAT_HOME", str(tmp_path))
    (tmp_path / "tokens").mkdir()
    (tmp_path / "tokens" / "demo-crew@alice.token").write_text("a")
    (tmp_path / "tokens" / "demo-crew@bob.token").write_text("b")

    with pytest.raises(AimeatLiaisonError, match="Multiple owners"):
        _read_token("demo-crew")


def test_read_token_missing_raises(tmp_path, monkeypatch) -> None:
    """No token file -> clear error pointing to the connect-add command."""
    from aimeat_crewai.daemon import _read_token
    from aimeat_crewai import AimeatLiaisonError
    import pytest

    monkeypatch.setenv("AIMEAT_HOME", str(tmp_path))

    with pytest.raises(AimeatLiaisonError, match="aimeat connect add"):
        _read_token("nonexistent-agent")


def test_daemon_default_tool_filter_exported_and_curated() -> None:
    """0.3.2 ships a curated default tool list for daemon liaisons so the LLM
    schema package stays small enough for litellm / smaller models."""
    from aimeat_crewai import DAEMON_DEFAULT_TOOL_FILTER

    # Should be a tuple-like, reasonable in size.
    names = tuple(DAEMON_DEFAULT_TOOL_FILTER)
    assert 10 <= len(names) <= 40, f"unexpected default tool count: {len(names)}"

    # Must include the canonical liaison-flow tools.
    must_have = {
        "aimeat_onboarding_status",
        "aimeat_task_list",
        "aimeat_task_complete",
        "aimeat_memory_write",
        "aimeat_handbook_get",
    }
    missing = must_have - set(names)
    assert not missing, f"default filter missing essential tools: {missing}"

    # Must NOT include known-risky / out-of-scope-for-liaison tools.
    must_not_have = {"aimeat_admin_mint", "aimeat_admin_config", "aimeat_wallet_balance"}
    overlap = must_not_have & set(names)
    assert not overlap, f"default filter includes tools that should be excluded: {overlap}"


def test_ensure_serve_no_daemon_no_autostart_raises(tmp_path, monkeypatch) -> None:
    """0.4.0: with no discovery file and auto_start=False, ensure_serve must
    fail fast with guidance instead of spawning anything."""
    from aimeat_crewai import ensure_serve, AimeatServeError
    import pytest

    monkeypatch.setenv("AIMEAT_HOME", str(tmp_path))
    with pytest.raises(AimeatServeError, match="aimeat connect serve --http"):
        ensure_serve(auto_start=False)


def test_serve_discovery_honors_aimeat_home(tmp_path, monkeypatch) -> None:
    from aimeat_crewai.mcp_client import serve_discovery_path

    monkeypatch.setenv("AIMEAT_HOME", str(tmp_path))
    assert serve_discovery_path() == tmp_path / "serve.json"


def test_slim_vs_full_backstory_templates_exist() -> None:
    """0.2.0 ships two templates; default selection is auto based on skill presence."""
    from aimeat_crewai.liaison import SLIM_BACKSTORY_TEMPLATE, FULL_BACKSTORY_TEMPLATE

    # SLIM template references "Skill" because it expects the skill bundle to
    # carry the manual; FULL template doesn't because it carries the manual itself.
    assert "Skill" in SLIM_BACKSTORY_TEMPLATE
    assert len(SLIM_BACKSTORY_TEMPLATE) < len(FULL_BACKSTORY_TEMPLATE)
    # Both must have {agent_name} placeholder so the factory can format them.
    assert "{agent_name}" in SLIM_BACKSTORY_TEMPLATE
    assert "{agent_name}" in FULL_BACKSTORY_TEMPLATE
