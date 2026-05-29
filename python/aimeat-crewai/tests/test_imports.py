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
        "stdio_params",
        "http_params",
        "sse_params",
    }
    assert expected <= set(dir(aimeat_crewai)), (
        f"Missing from package surface: {expected - set(dir(aimeat_crewai))}"
    )


def test_version_is_string() -> None:
    from aimeat_crewai import __version__

    assert isinstance(__version__, str)
    assert __version__.count(".") >= 2, f"Expected semver-ish version, got {__version__!r}"


def test_stdio_params_builds_with_defaults() -> None:
    """stdio_params should be callable with no args (uses primary agent)."""
    from aimeat_crewai import stdio_params

    p = stdio_params()
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
