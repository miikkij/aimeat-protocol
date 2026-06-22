"""
Interactive messages (federated AskUserQuestion) -- crew-facing helpers.

A crew can ask a person a STRUCTURED question through the AIMEAT inbox instead of free text: a set of
option-based questions the human answers by tapping choices (radio / checkbox) plus an "Other" freeform,
then Send. The answer comes back as a normal reply whose `interactive.answers` carries the machine-readable
picks keyed by question id. This module wraps that round-trip for deterministic / scripted crews:

    from aimeat_crewai import serve_client, build_question, ask, read_answers

    api = serve_client("company-crew")              # loopback serve daemon (auto-auth as the agent)
    q = build_question("env", "Which environment?",
                       [("prod", "Production"), ("staging", "Staging")], required=True)
    sent = ask(api, "alice@aimeat-fi-001-genesis", [q])   # -> {"message_id", "conversation_id"}

    # later, when a dm.inbound with interactive == "answers" wakes the daemon (or just poll):
    got = read_answers(api, sent["conversation_id"])      # -> {"answers_for", "answers": {qid: {...}}}

A CrewAI LLM agent does not need this module -- it can call the `aimeat_dm_ask` MCP tool directly. These
helpers exist for crews that talk REST through the serve loopback (the same path `aimeat connect call`
uses). Mirrors the node contract in aimeat/src/models/message-schemas.ts (the node schema wins on any
mismatch).

Changelog:
  0.9.0 -- New: ask() / read_answers() / answers_from_dm() / build_question() + serve_client() for
    federated AskUserQuestion. The on_dm wake already carries `interactive` ("questions" | "answers" |
    None) so a handler can tell a question it should answer from an answer to one it asked; read_answers
    fetches the structured picks for the latter. Requires AIMEAT >= 1.31 (the `interactive` field +
    aimeat_dm_ask).
"""
from __future__ import annotations

from typing import Any, Mapping, Sequence

try:
    import requests
except ImportError as exc:  # pragma: no cover
    raise ImportError(
        "The `requests` package is required for messaging helpers. Install: pip install requests"
    ) from exc


class AimeatMessagingError(RuntimeError):
    """A federated-inbox messaging helper failed (bad input or a non-2xx node response)."""


class ServeClient:
    """Minimal REST client against the loopback `aimeat connect serve` daemon. The daemon proxies any
    `/v1/...` path over its persistent tunnel and holds the agent's bearer token, so no Authorization
    header is needed here -- `X-Aimeat-Agent` selects which registered agent the call runs as."""

    def __init__(self, base_url: str, agent_name: str | None = None, session: Any = None) -> None:
        self.base_url = base_url.rstrip("/")
        self.agent_name = agent_name
        self.session = session or requests.Session()
        if agent_name:
            self.session.headers.update({"X-Aimeat-Agent": agent_name})

    def get(self, path: str, **kwargs: Any) -> Any:
        kwargs.setdefault("timeout", 15)
        return self.session.get(f"{self.base_url}{path}", **kwargs)

    def post(self, path: str, **kwargs: Any) -> Any:
        kwargs.setdefault("timeout", 15)
        return self.session.post(f"{self.base_url}{path}", **kwargs)


def serve_client(agent_name: str | None = None, *, base_url: str | None = None, **ensure_kwargs: Any) -> ServeClient:
    """Build a ServeClient pointed at the loopback serve daemon, auto-starting it if needed (via
    ensure_serve). Pass `base_url` to skip discovery (e.g. a node URL in a test)."""
    if base_url:
        return ServeClient(base_url, agent_name)
    from .mcp_client import ensure_serve  # local import: keeps this module crewai-free
    disc = ensure_serve(**ensure_kwargs)
    port = disc["port"]
    agent = agent_name or ((disc.get("agents") or [{}])[0].get("agent"))
    return ServeClient(f"http://127.0.0.1:{port}", agent)


def build_question(
    qid: str,
    prompt: str,
    options: Sequence[Any],
    *,
    header: str | None = None,
    multi_select: bool = False,
    allow_other: bool = True,
    required: bool = False,
) -> dict[str, Any]:
    """Build one interactive question. `options` accepts (id, label) pairs, {"id","label"} dicts, or bare
    strings (label == id). Mirrors InteractiveQuestion in the node schema."""
    norm: list[dict[str, str]] = []
    for o in options:
        if isinstance(o, Mapping):
            oid = str(o["id"])
            norm.append({"id": oid, "label": str(o.get("label", oid))})
        elif isinstance(o, (tuple, list)) and len(o) == 2:
            norm.append({"id": str(o[0]), "label": str(o[1])})
        else:
            norm.append({"id": str(o), "label": str(o)})
    if not norm:
        raise AimeatMessagingError("a question needs at least one option")
    return {
        "id": str(qid),
        "header": (str(header) if header else str(qid))[:80],
        "prompt": str(prompt),
        "options": norm,
        "multiSelect": bool(multi_select),
        "allowOther": bool(allow_other),
        "required": bool(required),
    }


def ask(
    api: Any,
    to: str,
    questions: Sequence[Mapping[str, Any]],
    *,
    body: str | None = None,
    subject: str | None = None,
    conversation_id: str | None = None,
    submit_label: str | None = None,
) -> dict[str, Any]:
    """Send a structured (interactive) question to `to` (owner@node, agent#owner@node, or eco:app#owner@node).
    `api` is any object with `.post(path, json=...)` (a ServeClient or the daemon's api). Returns
    {"message_id", "conversation_id"}."""
    if not questions:
        raise AimeatMessagingError("ask() needs at least one question")
    interactive: dict[str, Any] = {"role": "questions", "v": 1, "questions": list(questions)}
    if submit_label:
        interactive["submitLabel"] = submit_label
    payload: dict[str, Any] = {"to": to, "interactive": interactive}
    if body:
        payload["body"] = body
    if subject:
        payload["subject"] = subject
    if conversation_id:
        payload["conversation_id"] = conversation_id
    resp = api.post("/v1/messages", json=payload)
    if getattr(resp, "status_code", 0) >= 300:
        raise AimeatMessagingError(f"dm ask failed: {getattr(resp, 'status_code', '?')} {_body_text(resp)}")
    msg = (_json(resp).get("data") or {}).get("message") or {}
    return {"message_id": msg.get("id"), "conversation_id": msg.get("conversationId")}


def read_answers(api: Any, conversation_id: str, *, answers_for: str | None = None) -> dict[str, Any] | None:
    """Read the latest interactive ANSWERS in a thread (this agent's view). Returns
    {"answers_for", "answers": {qid: {"selected": [...], "other": ...}}, "message_id"} or None if no answer
    yet. Pass `answers_for` to require the answer be to a specific question message id."""
    resp = api.get(f"/v1/messages/agent-thread/{conversation_id}")
    if getattr(resp, "status_code", 0) >= 300:
        raise AimeatMessagingError(f"read thread failed: {getattr(resp, 'status_code', '?')} {_body_text(resp)}")
    msgs = (_json(resp).get("data") or {}).get("messages") or []
    # agent-thread is oldest-first; scan newest-first for the most recent answers payload.
    for m in reversed(msgs):
        inter = m.get("interactive")
        if isinstance(inter, dict) and inter.get("role") == "answers":
            if answers_for and inter.get("answersFor") != answers_for:
                continue
            return {
                "answers_for": inter.get("answersFor"),
                "answers": inter.get("answers") or {},
                "message_id": m.get("id"),
            }
    return None


def answers_from_dm(api: Any, event: Mapping[str, Any]) -> dict[str, Any] | None:
    """Convenience for an on_dm handler: if `event` is an ANSWERS wake (event["interactive"] == "answers"),
    fetch and return the structured answers for its thread; else None."""
    if (event or {}).get("interactive") != "answers":
        return None
    conv = event.get("conversationId")
    return read_answers(api, conv) if conv else None


def _json(resp: Any) -> dict[str, Any]:
    try:
        return resp.json() or {}
    except Exception:  # pragma: no cover - defensive
        return {}


def _body_text(resp: Any) -> str:
    try:
        return resp.text[:300]
    except Exception:  # pragma: no cover - defensive
        return ""
