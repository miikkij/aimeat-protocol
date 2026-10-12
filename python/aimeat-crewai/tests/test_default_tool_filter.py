"""
The daemon's default tool list reaches every capability, and cannot stop a start (0.35.0).

Until 0.35.0 a default liaison had 25 tools and no way to anything else: no `aimeat_discover`, no
`aimeat_invoke`, and none of the three `aimeat_mcp_*` tools. The list's own comment gave "~95
tools" as the reason for keeping it short; the node's catalog held 430.

Adding five names to a filter has a cost of its own, which these tests hold. A filter refuses to
start on a name the MCP server did not expose, and each of the five can be missing for a reason
that is not an error:

  - a connector started with `--surface agent` offers the 25 and `aimeat_discover`, and not
    `aimeat_invoke` or the `aimeat_mcp_*` tools;
  - a node's own MCP lists `aimeat_mcp_*` only to a session that holds `mcp:read` / `mcp:use`,
    which an agent with default permissions does not;
  - a connector older than a tool does not have it.

So the five are loaded when offered (`DAEMON_TOOLS_IF_OFFERED`) and left out otherwise, and every
other name stays required. The tool objects here are stand-ins with a `name`: the selection reads
nothing else. No node, no connector, no crewai.
"""
from __future__ import annotations

import inspect
from types import SimpleNamespace

import pytest

from aimeat_crewai import (
    DAEMON_DEFAULT_TOOL_FILTER,
    DAEMON_TOOLS_IF_OFFERED,
    AimeatLiaisonError,
    create_liaison_agent,
    select_liaison_tools,
)
from aimeat_crewai import daemon as daemon_module

FIVE = ("aimeat_discover", "aimeat_invoke", "aimeat_mcp_list", "aimeat_mcp_tools", "aimeat_mcp_call")
REQUIRED = tuple(n for n in DAEMON_DEFAULT_TOOL_FILTER if n not in DAEMON_TOOLS_IF_OFFERED)


def offered(*names: str) -> list[SimpleNamespace]:
    return [SimpleNamespace(name=n) for n in names]


def names_of(tools: list[SimpleNamespace]) -> set[str]:
    return {t.name for t in tools}


def test_the_default_list_names_the_five_and_keeps_its_25() -> None:
    assert set(FIVE) <= set(DAEMON_DEFAULT_TOOL_FILTER)
    assert set(DAEMON_TOOLS_IF_OFFERED) == set(FIVE)
    assert len(REQUIRED) == 25
    assert len(DAEMON_DEFAULT_TOOL_FILTER) == len(set(DAEMON_DEFAULT_TOOL_FILTER)) == 30


def test_a_connector_that_offers_everything_loads_all_30() -> None:
    server = offered(*DAEMON_DEFAULT_TOOL_FILTER, "aimeat_wallet_balance", "aimeat_board_post")
    tools, left_out = select_liaison_tools(server, DAEMON_DEFAULT_TOOL_FILTER, DAEMON_TOOLS_IF_OFFERED)
    assert names_of(tools) == set(DAEMON_DEFAULT_TOOL_FILTER)
    assert left_out == []


def test_a_connector_on_the_agent_surface_starts_without_invoke_and_the_mcp_tools() -> None:
    # `aimeat connect serve --surface agent`: the 25 and aimeat_discover are on it, the other four are not.
    server = offered(*REQUIRED, "aimeat_discover")
    tools, left_out = select_liaison_tools(server, DAEMON_DEFAULT_TOOL_FILTER, DAEMON_TOOLS_IF_OFFERED)
    assert names_of(tools) == set(REQUIRED) | {"aimeat_discover"}
    assert left_out == ["aimeat_invoke", "aimeat_mcp_call", "aimeat_mcp_list", "aimeat_mcp_tools"]


def test_a_session_without_the_mcp_permissions_starts_without_the_mcp_tools() -> None:
    # A node's own MCP registers aimeat_mcp_* only for a session that holds mcp:read / mcp:use.
    server = offered(*REQUIRED, "aimeat_discover", "aimeat_invoke")
    tools, left_out = select_liaison_tools(server, DAEMON_DEFAULT_TOOL_FILTER, DAEMON_TOOLS_IF_OFFERED)
    assert {"aimeat_discover", "aimeat_invoke"} <= names_of(tools)
    assert left_out == ["aimeat_mcp_call", "aimeat_mcp_list", "aimeat_mcp_tools"]


def test_before_0_35_0_the_same_list_would_have_stopped_that_start() -> None:
    # The same server and the same 30 names, read as every filter was read before: all required.
    server = offered(*REQUIRED, "aimeat_discover")
    with pytest.raises(AimeatLiaisonError) as refused:
        select_liaison_tools(server, DAEMON_DEFAULT_TOOL_FILTER)
    assert "aimeat_invoke" in str(refused.value)


def test_a_missing_required_tool_still_stops_the_start_and_is_named() -> None:
    server = offered(*(n for n in DAEMON_DEFAULT_TOOL_FILTER if n != "aimeat_task_complete"))
    with pytest.raises(AimeatLiaisonError) as refused:
        select_liaison_tools(server, DAEMON_DEFAULT_TOOL_FILTER, DAEMON_TOOLS_IF_OFFERED)
    assert "['aimeat_task_complete']" in str(refused.value)


def test_a_filter_the_caller_wrote_is_required_in_full() -> None:
    server = offered("aimeat_memory_read")
    with pytest.raises(AimeatLiaisonError):
        select_liaison_tools(server, ["aimeat_memory_read", "aimeat_invoke"])
    tools, left_out = select_liaison_tools(server, ["aimeat_memory_read"])
    assert names_of(tools) == {"aimeat_memory_read"} and left_out == []


def test_no_filter_loads_everything_offered() -> None:
    server = offered("aimeat_memory_read", "aimeat_wallet_balance")
    tools, left_out = select_liaison_tools(server, None, DAEMON_TOOLS_IF_OFFERED)
    assert names_of(tools) == {"aimeat_memory_read", "aimeat_wallet_balance"} and left_out == []


def test_the_daemon_passes_the_if_offered_list_only_with_its_own_default() -> None:
    # create_liaison_agent takes the list, and run_crew_daemon hands it over at both places it
    # builds a liaison, from a variable that is empty unless the default filter is in use.
    assert "tool_filter_if_offered" in inspect.signature(create_liaison_agent).parameters
    source = inspect.getsource(daemon_module.run_crew_daemon)
    assert source.count("tool_filter_if_offered=resolved_if_offered") == 2
    assert "resolved_if_offered: tuple[str, ...] = ()" in source
    assert "resolved_if_offered = DAEMON_TOOLS_IF_OFFERED" in source
