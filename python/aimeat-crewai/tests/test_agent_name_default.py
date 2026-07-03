"""
Tests for the agent_name default injection.

A SHARED `aimeat connect serve` daemon fronts every agent in a fleet; each aimeat_* tool routes by its
`agent_name` param and falls back to the daemon's PRIMARY agent when it is omitted. A caller that leaves
agent_name blank (the Hello Integration driver, a raw liaison tool call) would read/write the WRONG
agent -- e.g. aimeat_onboarding_status returns the primary's 7/7, so onboarding stalls. The liaison
defaults agent_name to THIS agent, BEFORE validation (so the None-strip can't drop it).
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel

from aimeat_crewai.liaison import _install_agent_name_default


class _RoutedArgs(BaseModel):
    agent_name: Optional[str] = None
    other: Optional[str] = None


class _UnroutedArgs(BaseModel):
    task_id: str


class _FakeTool:
    def __init__(self, schema: type) -> None:
        self.name = "tool"
        self.args_schema = schema


def test_injects_agent_name_when_omitted() -> None:
    tool = _FakeTool(_RoutedArgs)
    _install_agent_name_default(tool, "mroom-sniffer")
    assert tool.args_schema.model_validate({}).agent_name == "mroom-sniffer"
    assert tool.args_schema.model_validate({"other": "x"}).agent_name == "mroom-sniffer"


def test_blank_or_none_agent_name_is_replaced() -> None:
    tool = _FakeTool(_RoutedArgs)
    _install_agent_name_default(tool, "mroom-sniffer")
    assert tool.args_schema.model_validate({"agent_name": ""}).agent_name == "mroom-sniffer"
    assert tool.args_schema.model_validate({"agent_name": None}).agent_name == "mroom-sniffer"


def test_explicit_agent_name_always_wins() -> None:
    tool = _FakeTool(_RoutedArgs)
    _install_agent_name_default(tool, "mroom-sniffer")
    assert tool.args_schema.model_validate({"agent_name": "someone-else"}).agent_name == "someone-else"


def test_tool_without_agent_name_field_is_untouched() -> None:
    tool = _FakeTool(_UnroutedArgs)
    original = tool.args_schema
    _install_agent_name_default(tool, "mroom-sniffer")
    assert tool.args_schema is original  # no subclass installed
    assert tool.args_schema.model_validate({"task_id": "t1"}).task_id == "t1"


def test_schema_name_preserved() -> None:
    tool = _FakeTool(_RoutedArgs)
    _install_agent_name_default(tool, "mroom-sniffer")
    assert tool.args_schema.__name__ == "_RoutedArgs"
