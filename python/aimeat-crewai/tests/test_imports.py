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


def test_read_key_v2_agent_is_accepted(tmp_path, monkeypatch) -> None:
    """A v2 agent has a KEY, not a token, and the liaison must start for it.

    Every agent the basic-agents button creates is v2. Looking only in tokens/ made the liaison
    refuse all three of them -- "No token file matching .../tokens/concierge@*.token" -- for a
    credential that was on disk the whole time, one directory across."""
    from aimeat_crewai.daemon import _read_token

    monkeypatch.setenv("AIMEAT_HOME", str(tmp_path))
    (tmp_path / "keys").mkdir()
    (tmp_path / "keys" / "concierge@happyowner.key").write_text("PRIVATE-KEY-MATERIAL")
    agent_cfg_dir = tmp_path / "agents" / "concierge"
    agent_cfg_dir.mkdir(parents=True)
    (agent_cfg_dir / "config.yaml").write_text("node_url: https://node.example\n")

    token, node_url = _read_token("concierge", owner="happyowner")
    # Empty, deliberately: there is no bearer on disk, and the key material must never be
    # handed out as one. The loopback holds the real credential.
    assert token == ""
    assert node_url == "https://node.example"


def test_read_key_v2_agent_owner_auto_detect(tmp_path, monkeypatch) -> None:
    """The same auto-detection a v1 agent gets, for a key."""
    from aimeat_crewai.daemon import _read_token

    monkeypatch.setenv("AIMEAT_HOME", str(tmp_path))
    (tmp_path / "keys").mkdir()
    (tmp_path / "keys" / "crew-forge@happyowner.key").write_text("k")

    token, _ = _read_token("crew-forge")
    assert token == ""


def test_read_token_ambiguous_across_both_families(tmp_path, monkeypatch) -> None:
    """Two OWNERS is ambiguous whichever family each of them uses."""
    from aimeat_crewai.daemon import _read_token
    from aimeat_crewai import AimeatLiaisonError
    import pytest

    monkeypatch.setenv("AIMEAT_HOME", str(tmp_path))
    (tmp_path / "tokens").mkdir()
    (tmp_path / "keys").mkdir()
    (tmp_path / "tokens" / "concierge@alice.token").write_text("a")
    (tmp_path / "keys" / "concierge@bob.key").write_text("b")

    with pytest.raises(AimeatLiaisonError, match="Multiple owners"):
        _read_token("concierge")


def test_read_token_one_owner_holding_both_is_not_ambiguous(tmp_path, monkeypatch) -> None:
    """A v1 agent that migrated to a key leaves both files. That is ONE owner, not a conflict."""
    from aimeat_crewai.daemon import _read_token

    monkeypatch.setenv("AIMEAT_HOME", str(tmp_path))
    (tmp_path / "tokens").mkdir()
    (tmp_path / "keys").mkdir()
    (tmp_path / "tokens" / "concierge@happyowner.token").write_text("old-bearer")
    (tmp_path / "keys" / "concierge@happyowner.key").write_text("new-key")

    _read_token("concierge")  # must not raise


def test_read_token_reads_the_per_owner_config_path(tmp_path, monkeypatch) -> None:
    """The connector moved to agents/{owner}/{agent}/config.yaml on 2026-09-01.

    Reading only the old shared path found nothing on any current install and fell through to the
    default, which is aimeat.io -- so a LOCAL test agent reported production as its node."""
    from aimeat_crewai.daemon import _read_token

    monkeypatch.setenv("AIMEAT_HOME", str(tmp_path))
    (tmp_path / "keys").mkdir()
    (tmp_path / "keys" / "concierge@isoalice.key").write_text("k")
    cfg = tmp_path / "agents" / "isoalice" / "concierge"
    cfg.mkdir(parents=True)
    (cfg / "config.yaml").write_text("node_url: http://localhost:40310\n")

    _token, node_url = _read_token("concierge", owner="isoalice")
    assert node_url == "http://localhost:40310"


def test_read_token_still_reads_the_old_shared_config_path(tmp_path, monkeypatch) -> None:
    """An install that has not been migrated yet keeps working."""
    from aimeat_crewai.daemon import _read_token

    monkeypatch.setenv("AIMEAT_HOME", str(tmp_path))
    (tmp_path / "tokens").mkdir()
    (tmp_path / "tokens" / "oldbot@alice.token").write_text("t")
    cfg = tmp_path / "agents" / "oldbot"
    cfg.mkdir(parents=True)
    (cfg / "config.yaml").write_text("node_url: http://old.example:1\n")

    _token, node_url = _read_token("oldbot", owner="alice")
    assert node_url == "http://old.example:1"


def test_read_token_missing_names_both_places(tmp_path, monkeypatch) -> None:
    """The fast failure this function exists for is KEPT, and now says where it looked."""
    from aimeat_crewai.daemon import _read_token
    from aimeat_crewai import AimeatLiaisonError
    import pytest

    monkeypatch.setenv("AIMEAT_HOME", str(tmp_path))

    with pytest.raises(AimeatLiaisonError, match="No credential"):
        _read_token("nonexistent-agent")


def _write_key(home, agent, owner, gaii) -> None:
    import json as _json
    (home / "keys").mkdir(exist_ok=True)
    (home / "keys" / f"{agent}@{owner}.key").write_text(_json.dumps({"gaii": gaii, "kid": "k1"}))


def _write_bearer(home, agent, owner, sub) -> None:
    import base64 as _b64, json as _json
    (home / "tokens").mkdir(exist_ok=True)
    b64 = lambda o: _b64.urlsafe_b64encode(_json.dumps(o).encode()).decode().rstrip("=")
    (home / "tokens" / f"{agent}@{owner}.token").write_text(
        f"{b64({'alg': 'EdDSA'})}.{b64({'sub': sub})}.sig"
    )


def test_identity_gaii_is_read_from_a_v2_key(tmp_path, monkeypatch) -> None:
    """The credential's NAME and the routing IDENTITY are two values, and the GAII is READ.

    Driving both from one `agent_name` produced a search for
    keys/crew-forge#isoalice@node@*.key when the caller held a GAII, and routed to whichever
    owner matched first when it held a name."""
    from aimeat_crewai.daemon import resolve_agent_identity

    monkeypatch.setenv("AIMEAT_HOME", str(tmp_path))
    _write_key(tmp_path, "crew-forge", "isoalice", "crew-forge#isoalice@aimeat-iso-001-a")

    ident = resolve_agent_identity("crew-forge", owner="isoalice")
    assert ident.name == "crew-forge"                                  # what the FILE is called
    assert ident.owner == "isoalice"
    assert ident.gaii == "crew-forge#isoalice@aimeat-iso-001-a"        # what ROUTING wants


def test_identity_gaii_is_read_from_a_v1_bearer_sub(tmp_path, monkeypatch) -> None:
    from aimeat_crewai.daemon import resolve_agent_identity

    monkeypatch.setenv("AIMEAT_HOME", str(tmp_path))
    _write_bearer(tmp_path, "alicebot", "isoalice", "alicebot#isoalice@aimeat-iso-001-a")

    ident = resolve_agent_identity("alicebot")
    assert ident.gaii == "alicebot#isoalice@aimeat-iso-001-a"
    assert ident.name == "alicebot"


def test_identity_refuses_a_credential_carrying_no_identity(tmp_path, monkeypatch) -> None:
    """Guessing a GAII would put the wrong agent on the wire, so it is refused instead."""
    from aimeat_crewai.daemon import resolve_agent_identity
    from aimeat_crewai import AimeatLiaisonError
    import pytest

    monkeypatch.setenv("AIMEAT_HOME", str(tmp_path))
    (tmp_path / "keys").mkdir()
    (tmp_path / "keys" / "mystery@alice.key").write_text("{}")

    with pytest.raises(AimeatLiaisonError, match="carries no identity"):
        resolve_agent_identity("mystery", owner="alice")


def test_two_owners_one_name_resolve_to_two_identities(tmp_path, monkeypatch) -> None:
    """The case the whole separation is for: same name, two accounts, one home."""
    from aimeat_crewai.daemon import resolve_agent_identity

    monkeypatch.setenv("AIMEAT_HOME", str(tmp_path))
    _write_key(tmp_path, "concierge", "isoalice", "concierge#isoalice@aimeat-iso-001-a")
    _write_key(tmp_path, "concierge", "isobob", "concierge#isobob@aimeat-iso-001-a")

    a = resolve_agent_identity("concierge", owner="isoalice")
    b = resolve_agent_identity("concierge", owner="isobob")
    assert a.name == b.name == "concierge"      # one name
    assert a.gaii != b.gaii                     # two identities


def test_api_routes_by_gaii_and_builds_paths_from_the_name(tmp_path, monkeypatch) -> None:
    from aimeat_crewai.daemon import _Api, AgentIdentity

    ident = AgentIdentity(name="concierge", owner="isoalice", gaii="concierge#isoalice@aimeat-iso-001-a")
    api = _Api("http://127.0.0.1:1234", ident)
    assert api.session.headers["X-Aimeat-Agent"] == "concierge#isoalice@aimeat-iso-001-a"
    assert api.agent_name == "concierge"
    assert api.gaii == "concierge#isoalice@aimeat-iso-001-a"


def test_api_still_accepts_a_bare_string(tmp_path) -> None:
    """A single-owner caller that predates AgentIdentity behaves exactly as before."""
    from aimeat_crewai.daemon import _Api

    api = _Api("http://127.0.0.1:1234", "loopbot")
    assert api.session.headers["X-Aimeat-Agent"] == "loopbot"
    assert api.agent_name == "loopbot"


def test_serve_params_matches_the_gaii_row(monkeypatch) -> None:
    """serve.json has carried `gaii` on every agents[] row since schema 2, and this compared only
    the bare name — so an agent addressed by its full identity was called unregistered by the
    daemon holding its socket, and the error listed the halves it had not compared."""
    from aimeat_crewai import mcp_client

    doc = {"port": 5555, "agents": [
        {"agent": "concierge", "gaii": "concierge#isoalice@n"},
        {"agent": "concierge", "gaii": "concierge#isobob@n"},
    ]}
    monkeypatch.setattr(mcp_client, "ensure_serve", lambda **kw: doc)

    # The full identity is accepted, and the session carries it.
    p = mcp_client.serve_params(agent_name="concierge#isobob@n")
    assert "5555" in p["url"]
    assert p["headers"]["X-Aimeat-Agent"] == "concierge#isobob@n"

    # A bare name two owners share is REFUSED. This test used to assert it was accepted, which
    # encoded the ambiguity as acceptable — picking one is the silent-replace defect one layer up.
    import pytest
    with pytest.raises(mcp_client.AimeatServeError, match="more than one agent"):
        mcp_client.serve_params(agent_name="concierge")


def test_serve_params_unknown_agent_lists_identities_not_bare_names(monkeypatch) -> None:
    from aimeat_crewai import mcp_client
    from aimeat_crewai.mcp_client import AimeatServeError
    import pytest

    doc = {"port": 5555, "agents": [{"agent": "concierge", "gaii": "concierge#isoalice@n"}]}
    monkeypatch.setattr(mcp_client, "ensure_serve", lambda **kw: doc)

    with pytest.raises(AimeatServeError) as e:
        mcp_client.serve_params(agent_name="workflow-manager#isobob@n")
    # It must name what it DID compare against, or the message repeats the original mistake.
    assert "concierge#isoalice@n" in str(e.value)


def test_session_carries_the_named_agents_gaii(monkeypatch) -> None:
    """The session says who it is. It used to send nothing, and an anonymous session on a
    two-owner daemon is refused — which the MCP adapter experienced as a 30-second timeout with
    nothing reported, while the daemon's refusal named the fix and went unread."""
    from aimeat_crewai import mcp_client

    doc = {"port": 7001, "agents": [
        {"agent": "concierge", "gaii": "concierge#isoalice@n"},
        {"agent": "crew-forge", "gaii": "crew-forge#isoalice@n"},
    ]}
    monkeypatch.setattr(mcp_client, "ensure_serve", lambda **kw: doc)

    p = mcp_client.serve_params(agent_name="crew-forge")
    assert p["headers"]["X-Aimeat-Agent"] == "crew-forge#isoalice@n"   # the GAII, not the name
    assert p["headers"]["Authorization"].startswith("Bearer ")          # placeholder, unchanged


def test_a_bare_name_resolves_when_it_is_unambiguous(monkeypatch) -> None:
    from aimeat_crewai import mcp_client

    doc = {"port": 7002, "agents": [
        {"agent": "concierge", "gaii": "concierge#isoalice@n"},
        {"agent": "workflow-manager", "gaii": "workflow-manager#isobob@n"},
    ]}
    monkeypatch.setattr(mcp_client, "ensure_serve", lambda **kw: doc)

    # Two owners on the daemon, but only one agent carries this NAME, so it is not ambiguous.
    p = mcp_client.serve_params(agent_name="workflow-manager")
    assert p["headers"]["X-Aimeat-Agent"] == "workflow-manager#isobob@n"


def test_omitting_the_agent_with_one_loaded_works_as_today(monkeypatch) -> None:
    from aimeat_crewai import mcp_client

    doc = {"port": 7003, "agents": [{"agent": "loopbot", "gaii": "loopbot#alice@n"}]}
    monkeypatch.setattr(mcp_client, "ensure_serve", lambda **kw: doc)

    p = mcp_client.serve_params()
    assert p["headers"]["X-Aimeat-Agent"] == "loopbot#alice@n"


def test_omitting_the_agent_with_several_loaded_refuses_at_once(monkeypatch) -> None:
    """An instant refusal that names the candidates beats a silent 30-second timeout."""
    from aimeat_crewai import mcp_client
    import pytest

    doc = {"port": 7004, "agents": [
        {"agent": "concierge", "gaii": "concierge#isoalice@n"},
        {"agent": "concierge", "gaii": "concierge#isobob@n"},
    ]}
    monkeypatch.setattr(mcp_client, "ensure_serve", lambda **kw: doc)

    with pytest.raises(mcp_client.AimeatServeError) as e:
        mcp_client.serve_params()
    msg = str(e.value)
    assert "concierge#isoalice@n" in msg and "concierge#isobob@n" in msg
    assert "agent_name" in msg          # and it says what to do about it


def test_an_older_schema_1_daemon_still_gets_its_bare_name(monkeypatch) -> None:
    """No `gaii` on the row means a connector that predates schema 2. The bare name is all it ever
    had and all it can route by, so behaviour against one is unchanged."""
    from aimeat_crewai import mcp_client

    doc = {"port": 7005, "agents": [{"agent": "oldbot"}]}
    monkeypatch.setattr(mcp_client, "ensure_serve", lambda **kw: doc)

    assert mcp_client.serve_params()["headers"]["X-Aimeat-Agent"] == "oldbot"


def test_stdio_and_http_params_are_untouched() -> None:
    """They are for environments with no local connector; the loopback's identity is not their
    problem, and neither should grow an X-Aimeat-Agent header."""
    from aimeat_crewai.mcp_client import http_params, stdio_params

    h = http_params(node_url="https://aimeat.io", agent_token="t")
    assert set(h["headers"]) == {"Authorization"}
    s = stdio_params(agent_name="bot")
    assert "connect" in s.args and "serve" in s.args


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
