"""AI provenance — the `ai_provenance` block a crew sends on writes, and the one it reads back.

This module MIRRORS the node contract (``aimeat.provenance/v1``); it does not define it. **The node
schema wins on any mismatch.** The source of truth is
``aimeat/src/models/ai-provenance-schemas.ts`` and ``aimeat/src/mcp/ai-provenance-input.ts``; if you
find a difference, fix it here rather than working around it there.

Why a crew should care
----------------------
An AIMEAT node records how every piece of content was made. When a non-human principal writes and
declares nothing, the node stamps the write ``ai-generated`` with ``humanInvolvement: "none"`` —
deliberately, because reading silence as "a person wrote this" would be a false statement about
authorship, and that is the one mistake nobody can correct afterwards.

So the case that needs a crew to speak up is **relaying a person's words**. Everything else the node
gets right by default.

Declaring requires the ``provenance:write`` scope, because a declaration can assert that a person
wrote or reviewed something. Without it the node refuses the block and names the scope; omitting the
block always works and records what the node observed.

Usage
-----
    from aimeat_crewai.provenance import declare, HumanInvolvement, Level, read_provenance

    # A model wrote it — the node's default, stated explicitly.
    tool.run(key="report", value=text, ai_provenance=declare(Level.AI_GENERATED, model="anthropic/claude-opus-5"))

    # A person wrote it and the crew is only relaying. THIS is the one worth saying.
    tool.run(key="notes", value=text, ai_provenance=declare(Level.ORIGINAL))

    # Reading back: absence means UNSTATED, never "a person wrote it".
    prov = read_provenance(result)
    if prov is None:
        origin = "not stated"
    else:
        origin = prov["record"]["level"]
"""

from __future__ import annotations

from typing import Any, Iterable, Mapping

__all__ = [
    "SPEC",
    "Level",
    "Method",
    "HumanInvolvement",
    "declare",
    "source",
    "read_provenance",
    "is_model_written",
]

#: The spec string a reader branches on. An unknown spec reads as UNSTATED — never as an error, and
#: never as "a human wrote it".
SPEC = "aimeat.provenance/v1"


class Level:
    """How much of the content a model made. Frozen vocabulary; mirrors ``AI_PROVENANCE_LEVELS``."""

    #: A person wrote it. No model involved. Use this when relaying human text.
    ORIGINAL = "original"
    #: A person wrote it; a model edited, refined or filled in.
    ASSISTED = "assisted"
    #: A model combined real sources into new content, at someone's direction.
    SYNTHESIZED = "synthesized"
    #: A model produced it.
    AI_GENERATED = "ai-generated"

    ALL = (ORIGINAL, ASSISTED, SYNTHESIZED, AI_GENERATED)


class Method:
    """Optional detail under ``level``. Mirrors ``AI_PROVENANCE_METHODS``."""

    HUMAN = "human"
    REWRITTEN = "rewritten"
    SUMMARIZED = "summarized"
    TRANSLATED = "translated"
    SYNTHESIZED = "synthesized"
    FULLY_GENERATED = "fully-generated"
    MULTI_AGENT = "multi-agent"

    ALL = (HUMAN, REWRITTEN, SUMMARIZED, TRANSLATED, SYNTHESIZED, FULLY_GENERATED, MULTI_AGENT)


class HumanInvolvement:
    """Whether a person examined what the model produced. Mirrors ``AI_HUMAN_INVOLVEMENT``.

    **Only a step where a person reads the substance and can reject it counts.** Clicking publish is
    not that step. An owner approving a queue of twenty items in one gesture is not that step. A
    crew running on a schedule has no such step at all, which is why ``NONE`` is the default and why
    :func:`declare` will not invent anything else.
    """

    #: Nobody read the substance before it went out.
    NONE = "none"
    #: Someone glanced: spelling, formatting, a skim.
    LIGHT_REVIEW = "light-review"
    #: A person examined the substance and could approve, alter or reject it.
    EDITORIAL_CONTROL = "editorial-control"
    #: A person authored or rewrote it.
    FULL_HUMAN = "full-human"

    ALL = (NONE, LIGHT_REVIEW, EDITORIAL_CONTROL, FULL_HUMAN)


def source(url: str, *, title: str | None = None, retrieved_at: str | None = None,
           role: str | None = None) -> dict[str, Any]:
    """One entry for the ``sources`` list — where synthesized material came from."""
    out: dict[str, Any] = {"url": url}
    if title:
        out["title"] = title
    if retrieved_at:
        out["retrieved_at"] = retrieved_at
    if role:
        out["role"] = role
    return out


def declare(
    level: str,
    *,
    method: str | None = None,
    human_involvement: str = HumanInvolvement.NONE,
    model: str | None = None,
    provider: str | None = None,
    sources: Iterable[Mapping[str, Any]] | None = None,
    notes: str | None = None,
) -> dict[str, Any]:
    """Build an ``ai_provenance`` block for a write tool.

    ``human_involvement`` defaults to ``NONE`` on purpose: a crew publishing on a schedule has no
    reviewer, and defaulting to anything else would manufacture a claim nobody made. Pass a stronger
    value ONLY when you can name the person and the step at which they read the substance.

    Nothing about identity is accepted here — the node fills in who you are, which node, when, and a
    hash of the exact bytes, and discards anything a caller says about it. That is by construction:
    it is the one place an agent could otherwise attribute its writing to somebody else.

    ``provider`` is who SERVED the model, and it is worth stating whenever you route through an
    intermediary: "which model" and "who ran it" are different questions, and a router alias answers
    neither. A crew recording ``openrouter/openrouter/free`` as its model has named a routing POOL,
    not the writer — prefer the model the response actually reports, and name the router here.

    ``notes`` must never carry prompt text or anything private: the record is published alongside
    the content it describes.
    """
    if level not in Level.ALL:
        raise ValueError(f"level must be one of {Level.ALL}, got {level!r}")
    if method is not None and method not in Method.ALL:
        raise ValueError(f"method must be one of {Method.ALL}, got {method!r}")
    if human_involvement not in HumanInvolvement.ALL:
        raise ValueError(
            f"human_involvement must be one of {HumanInvolvement.ALL}, got {human_involvement!r}")

    block: dict[str, Any] = {"level": level, "human_involvement": human_involvement}
    if method:
        block["method"] = method
    if model:
        block["model"] = model
    if provider:
        block["provider"] = provider
    src = [dict(s) for s in (sources or [])]
    if src:
        block["sources"] = src
    if notes:
        block["notes"] = notes
    return block


def read_provenance(result: Any) -> dict[str, Any] | None:
    """Pull the ``ai_provenance`` block off a tool result, or ``None``.

    ``None`` means the origin is **UNSTATED**. It does not mean a person wrote it, and it does not
    mean the tool failed — most content on a node predates any record. Say "the origin is not
    stated" rather than guessing, and never round it up to human authorship.

    Accepts the parsed dict a tool returns, or a JSON string.
    """
    if isinstance(result, str):
        import json
        try:
            result = json.loads(result)
        except ValueError:
            return None
    if not isinstance(result, Mapping):
        return None
    block = result.get("ai_provenance")
    if not isinstance(block, Mapping):
        return None
    record = block.get("record")
    if not isinstance(record, Mapping) or record.get("spec") != SPEC:
        return None
    return dict(block)


def is_model_written(result: Any) -> bool | None:
    """``True`` / ``False`` / ``None`` for "did a model write this?".

    Three-valued on purpose. ``None`` is UNSTATED, and collapsing it to ``False`` is exactly the
    false claim about human authorship the whole design exists to prevent — so a caller that wants a
    boolean has to decide what unstated means for its own purpose, in the open.
    """
    prov = read_provenance(result)
    if prov is None:
        return None
    level = prov["record"].get("level")
    return level in (Level.SYNTHESIZED, Level.AI_GENERATED, Level.ASSISTED)
