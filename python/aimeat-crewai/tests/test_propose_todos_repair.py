"""
Tests for the aimeat_task_propose_todos argument repair.

Background: the AIMEAT node requires a `title` on every proposed todo
(`z.string()`), while `description` is optional. Some models (observed with
GLM 5.2) emit todos shaped `{"description": "..."}` with no title. Both the
client-side pydantic args_schema and the server reject that, and CrewAI
re-prompts the same agent -- which repeats the same mistake until max_iter, a
runaway loop. The connector repairs the payload BEFORE validation so a real,
present title reaches both layers and the call succeeds on the first try.

These tests exercise the pure helpers plus the args_schema subclassing, and
do not require a running node or LLM.
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel

from aimeat_crewai.liaison import (
    _derive_todo_title,
    _install_propose_todos_repair,
    _repair_propose_todos_input,
    _strip_none_kwargs,
    _PROPOSE_TODOS_TOOL,
)


# --- _derive_todo_title -----------------------------------------------------

def test_derive_title_short_description_used_verbatim() -> None:
    assert _derive_todo_title("Create a changelog cortex") == "Create a changelog cortex"


def test_derive_title_takes_first_nonblank_line() -> None:
    assert _derive_todo_title("\n\n  Build the thing  \nmore detail here") == "Build the thing"


def test_derive_title_truncates_on_word_boundary_with_ellipsis() -> None:
    long = "word " * 40  # 200 chars, all single words
    title = _derive_todo_title(long)
    assert title.endswith("…")
    # Trimmed to the budget, never cutting mid-word (drop the ellipsis to check).
    assert len(title[:-1]) <= 80
    assert "word" in title and title[:-1].strip().split()[-1] == "word"


def test_derive_title_empty_or_nonstring_yields_empty() -> None:
    assert _derive_todo_title("") == ""
    assert _derive_todo_title("   \n  ") == ""
    assert _derive_todo_title(None) == ""
    assert _derive_todo_title(123) == ""


# --- _repair_propose_todos_input --------------------------------------------

def test_repair_fills_missing_title_from_description() -> None:
    raw = {"task_id": "t1", "todos": [{"description": "Create a changelog cortex"}]}
    out = _repair_propose_todos_input(raw)
    assert out["todos"][0]["title"] == "Create a changelog cortex"
    # Description is preserved untouched.
    assert out["todos"][0]["description"] == "Create a changelog cortex"


def test_repair_upgrades_blank_title() -> None:
    raw = {"task_id": "t1", "todos": [{"title": "   ", "description": "Do the work"}]}
    out = _repair_propose_todos_input(raw)
    assert out["todos"][0]["title"] == "Do the work"


def test_repair_leaves_good_title_untouched_and_returns_same_object() -> None:
    raw = {"task_id": "t1", "todos": [{"title": "Real title", "description": "d"}]}
    out = _repair_propose_todos_input(raw)
    # No change -> the exact same object is returned (no needless copy).
    assert out is raw
    assert out["todos"][0]["title"] == "Real title"


def test_repair_does_not_mutate_caller_objects() -> None:
    todo = {"description": "derive me"}
    raw = {"task_id": "t1", "todos": [todo]}
    _repair_propose_todos_input(raw)
    assert "title" not in todo, "original todo dict must not be mutated"


def test_repair_ignores_non_propose_todos_shapes() -> None:
    # Not a dict.
    assert _repair_propose_todos_input("nope") == "nope"
    # todos not a list -> untouched.
    weird = {"task_id": "t1", "todos": "oops"}
    assert _repair_propose_todos_input(weird) is weird
    # Non-dict todo entries are passed through as-is (still invalid downstream).
    passthrough = {"todos": ["a string", 42]}
    assert _repair_propose_todos_input(passthrough)["todos"] == ["a string", 42]


def test_repair_missing_title_and_description_yields_present_empty_title() -> None:
    # Degenerate but must still produce a PRESENT string title so validation
    # passes rather than looping. Empty string satisfies z.string().
    raw = {"task_id": "t1", "todos": [{}]}
    out = _repair_propose_todos_input(raw)
    assert out["todos"][0]["title"] == ""


# --- args_schema subclassing (the actual choke point) -----------------------

class _TodoItem(BaseModel):
    title: str  # required, mirrors the node schema
    description: Optional[str] = None


class _ProposeTodosArgs(BaseModel):
    task_id: str
    todos: list[_TodoItem]


class _FakeTool:
    """Minimal stand-in for a CrewAI MCP tool: only what the wrapper touches
    (`name`, `args_schema`, `_run`, and an assignable `cache_function`)."""

    def __init__(self) -> None:
        self.name = _PROPOSE_TODOS_TOOL
        self.args_schema = _ProposeTodosArgs
        self.cache_function = None

    def _run(self, **kwargs: object) -> object:  # pragma: no cover -- never invoked here
        return kwargs


def test_install_repair_makes_schema_accept_missing_title() -> None:
    tool = _FakeTool()
    # Baseline: the unpatched schema rejects a todo with no title.
    import pytest

    with pytest.raises(Exception):
        _ProposeTodosArgs.model_validate(
            {"task_id": "t1", "todos": [{"description": "d"}]}
        )

    _install_propose_todos_repair(tool)

    # After the repair, the same payload validates and the title is filled.
    validated = tool.args_schema.model_validate(
        {"task_id": "t1", "todos": [{"description": "Publish the report"}]}
    )
    dumped = validated.model_dump()
    assert dumped["todos"][0]["title"] == "Publish the report"
    assert dumped["todos"][0]["description"] == "Publish the report"
    # Schema name is preserved so error messages/descriptions read the same.
    assert tool.args_schema.__name__ == "_ProposeTodosArgs"


def test_install_repair_preserves_valid_calls() -> None:
    tool = _FakeTool()
    _install_propose_todos_repair(tool)
    validated = tool.args_schema.model_validate(
        {"task_id": "t1", "todos": [{"title": "Given title", "description": "d"}]}
    )
    assert validated.model_dump()["todos"][0]["title"] == "Given title"


def test_strip_none_kwargs_installs_repair_only_for_propose_todos() -> None:
    # A propose_todos tool gets the repairing schema...
    todo_tool = _FakeTool()
    original_schema = todo_tool.args_schema
    _strip_none_kwargs(todo_tool)
    assert todo_tool.args_schema is not original_schema
    todo_tool.args_schema.model_validate(
        {"task_id": "t1", "todos": [{"description": "d"}]}
    )  # no raise

    # ...an unrelated tool keeps its schema unchanged.
    class _OtherTool(_FakeTool):
        def __init__(self) -> None:
            super().__init__()
            self.name = "aimeat_memory_write"

    other = _OtherTool()
    other_schema = other.args_schema
    _strip_none_kwargs(other)
    assert other.args_schema is other_schema
