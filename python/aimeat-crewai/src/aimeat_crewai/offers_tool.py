"""
CrewAI tool wrappers for offers / workflow-compatibility.

These give the liaison agent two LOCAL (offline) capabilities alongside the
node's MCP surface:

  - aimeat_offers_check: validate an offers document and report which levels
    each offer reaches (offering / workflow-compatible / priced) + what's
    missing -- mirroring the node's save-time gate, so the agent can self-check
    before publishing.
  - aimeat_offers_publish: validate and publish to agents.{name}.offers via REST.

crewai is imported lazily so workflow_spec.py / offers.py / the CLI stay usable
without crewai installed.
"""
from __future__ import annotations

import json
from typing import Any

from .offers import OfferValidationError, publish_offers, validate_offers_doc


def _parse_doc(offers_json: Any) -> dict[str, Any]:
    if isinstance(offers_json, dict):
        return offers_json
    if isinstance(offers_json, str):
        return json.loads(offers_json)
    raise ValueError("offers must be a JSON object or a JSON string")


def offers_check(offers_json: Any) -> str:
    """Validate an offers document; return a human + machine readable verdict string."""
    try:
        doc = _parse_doc(offers_json)
        verdicts = validate_offers_doc(doc, require=None)
    except (ValueError, OfferValidationError) as exc:
        return f"INVALID offers document: {exc}"
    return json.dumps(verdicts, ensure_ascii=False)


def offers_publish(offers_json: Any, agent_name: str, node_url: str | None = None, require: str | None = "offering") -> str:
    """Validate then publish offers to agents.{agent_name}.offers; return the response/error."""
    try:
        doc = _parse_doc(offers_json)
        body = publish_offers(doc, agent_name=agent_name, node_url=node_url, require=require)
    except (ValueError, OfferValidationError, RuntimeError) as exc:
        return f"publish failed: {exc}"
    return json.dumps(body, ensure_ascii=False)


def offers_tools() -> list[Any]:
    """Return CrewAI tools [offers_check, offers_publish] for the liaison's toolset.

    Raises ImportError if crewai is not installed (the underlying functions
    offers_check/offers_publish work without it)."""
    try:
        from crewai.tools import tool  # type: ignore[import-not-found]
    except ImportError as exc:  # pragma: no cover
        raise ImportError("crewai is required for offers_tools(); use offers_check/offers_publish directly otherwise.") from exc

    @tool("aimeat_offers_check")
    def _check(offers_json: str) -> str:
        """Validate an AIMEAT offers document offline and report which levels each
        offer reaches (offering / workflow-compatible / priced) and what is missing.
        Input: the offers document as a JSON string. Use this BEFORE publishing."""
        return offers_check(offers_json)

    @tool("aimeat_offers_publish")
    def _publish(offers_json: str, agent_name: str) -> str:
        """Validate and publish an AIMEAT offers document to agents.{agent_name}.offers.
        Input: the offers document as a JSON string and the bare agent name."""
        return offers_publish(offers_json, agent_name)

    return [_check, _publish]
