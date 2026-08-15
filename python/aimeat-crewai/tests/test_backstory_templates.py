"""
Tests for rendering a backstory template.

A backstory is PROSE THAT CONTAINS JSON. The FULL template shows an AI-provenance declaration
inline, and `str.format` reads every brace in that example as a field name, so rendering it raised
`KeyError: '"level"'` — for every agent that reaches it, which is every agent registered through the
device-authorize API rather than the CLI (no skill bundle means the FULL template, not SLIM). SLIM
survived by accident: it happens to contain no JSON at all.

So the two cases below are the whole point. FULL must render, and the JSON example must still be in
the output afterwards — a "fix" that escaped or stripped the braces would pass the first assertion
and quietly take the example out of the agent's instructions.
"""
from __future__ import annotations

from aimeat_crewai.liaison import FULL_BACKSTORY_TEMPLATE, SLIM_BACKSTORY_TEMPLATE

TEMPLATES = {"FULL": FULL_BACKSTORY_TEMPLATE, "SLIM": SLIM_BACKSTORY_TEMPLATE}


def render(template: str, agent_name: str) -> str:
    """The substitution the liaison performs. Literal on purpose — see liaison.py."""
    return template.replace("{agent_name}", agent_name)


def test_every_template_renders_with_an_agent_name() -> None:
    for name, template in TEMPLATES.items():
        out = render(template, "newsbot")
        assert "{agent_name}" not in out, f"{name} left the placeholder unrendered"
        assert "newsbot" in out, f"{name} did not carry the agent name into the text"


def test_the_json_example_survives_rendering() -> None:
    # The example an agent copies when it declares how its output was made. If this ever disappears
    # the template still renders, and the agent silently loses the one thing that shows the shape.
    out = render(FULL_BACKSTORY_TEMPLATE, "newsbot")
    assert '"level"' in out
    assert '"human_involvement"' in out


def test_str_format_is_still_the_wrong_tool_for_this() -> None:
    # Not a demand on the templates — a record of WHY the substitution is a replace(). If someone
    # ever "tidies" this back to .format(), this test says what happens next.
    try:
        FULL_BACKSTORY_TEMPLATE.format(agent_name="newsbot")
    except KeyError:
        return
    raise AssertionError(
        "FULL_BACKSTORY_TEMPLATE no longer breaks str.format. If the JSON example was escaped to "
        "achieve that, the next example added to this template will break it again — the liaison "
        "substitutes literally so that braces in prose mean nothing."
    )
