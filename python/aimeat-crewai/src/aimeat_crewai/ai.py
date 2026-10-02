"""
The node's AI for a crew: a CrewAI LLM that calls the node's OpenAI-compatible route, and the list
of what the caller can do with AI.

``node_llm()`` returns a ``crewai.LLM`` whose base URL is the node's ``/v1/llm`` route and whose API
key is this agent's bearer token. Every completion the crew makes through it then goes through the
node's own gate: the owner's model policy, the key order (the agent's own key, then the owner's,
then the server's), the owner's daily budget, the agent's cap and the usage record. The crew holds
no provider key.

``capabilities()`` reads ``GET /v1/ai/capabilities``: for each capability (text, vision, files,
image, speech, transcription, embed) whether it is on for this caller, the model and provider a
call would use and its price, and for one that is off the reason and the fix. Read it at start-up
and build the crew on what is on, rather than finding out from a refused call.

HOW CREWAI REACHES THE ROUTE (verified by ``tests/test_ai.py`` against a local HTTP server).
``LLM(model="openai/<id>", base_url=..., api_key=...)`` works on both code paths CrewAI has:

  CrewAI 1.x routes an ``openai/`` model with a ``base_url`` to its native OpenAI provider (the
  ``openai`` SDK) as a custom OpenAI-compatible endpoint, whatever the id is. LiteLLM is not used
  and does not need to be installed.

  CrewAI before 1.0, and 1.x with ``is_litellm=True``, go through LiteLLM, which treats the
  ``openai/`` prefix as "an OpenAI-compatible server at ``api_base``".

Both send ``POST <base_url>/chat/completions`` with ``Authorization: Bearer <api_key>`` and the id
after the ``openai/`` prefix as the body's ``model``. No trailing ``/v1`` and no environment
variable is needed.
"""
from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from .decide import (
    DecideError,
    DecideRefused,
    DecideUnreachable,
    _call,
    _node,
)

__all__ = [
    "CAPABILITIES",
    "NODE_CHOOSES_MODEL",
    "AiError",
    "AiRefused",
    "AiUnreachable",
    "capabilities",
    "node_llm",
]

#: The model id ``node_llm()`` sends when the caller names none.
#:
#: THE NODE DOES NOT READ THE BODY'S ``model``. ``POST /v1/llm/chat/completions``
#: (aimeat/src/routes/llm-proxy.ts) builds its plan with ``prepareAiCall`` and never passes the
#: request's ``model`` to it: the owner's preference decides, then the node's default for the role,
#: and the answer's ``model`` field says which model ran. So any non-empty string works here. CrewAI
#: refuses an empty model, so the package sends this name, which says what happens.
NODE_CHOOSES_MODEL = "aimeat-node-chooses"

#: The capabilities ``GET /v1/ai/capabilities`` reports on, in the node's order.
CAPABILITIES = ("text", "vision", "files", "image", "speech", "transcription", "embed")

#: The header ``node_llm(role=...)`` sends the AI role in. ``POST /v1/llm/chat/completions``
#: (aimeat/src/routes/llm-proxy.ts) reads it, or a body field ``role``. A header, because an
#: OpenAI-compatible client sends one on every call on both CrewAI code paths, and a top-level body
#: field it can only add through a client-specific option.
_ROLE_HEADER = "X-AIMEAT-AI-Role"

#: The longest role the node accepts (readCallRole in aimeat/src/services/ai-call-guards.ts).
_ROLE_MAX_CHARS = 300


# ── failures ──────────────────────────────────────────────────────────────────────────────────


class AiError(RuntimeError):
    """Base for everything this module raises."""


class AiUnreachable(AiError):
    """The node could not be reached, or answered something that was not its envelope.

    Separate from AiRefused: this one may clear itself on the next attempt, and a refusal does not.
    """


class AiRefused(AiError):
    """The node refused, with ITS OWN code so the caller can branch on the real reason.

    The codes a crew meets on ``GET /v1/ai/capabilities``: ``AUTH_REQUIRED`` (no valid token,
    401), ``SCOPE_DENIED`` (the owner did not give this agent the ``ai:use`` scope, 403),
    ``FORBIDDEN`` (AI use is not allowed for this caller, 403). A capability that is OFF is not a
    refusal: it is an answer, with ``on: false`` and a ``reason`` (see ``capabilities()``).
    """

    def __init__(
        self,
        code: str,
        message: str,
        *,
        status: int = 0,
        details: Any = None,
        retry_after: float | None = None,
    ) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.node_message = message
        self.status = status
        self.details = details
        #: Seconds the node asked us to wait, from its Retry-After header or `details.retry_after_ms`.
        self.retry_after = retry_after

    @property
    def retryable(self) -> bool:
        """True only for a rate limit (429 ``RATE_LIMITED``). A missing scope or a bad token stays
        the same on a retry."""
        return self.code == "RATE_LIMITED"


@contextmanager
def _as_ai_errors() -> Iterator[None]:
    """The shared node client (decide.py) raises the Decide* types; this module's callers catch
    the Ai* types, so each one is converted with its code, status, details and retry_after."""
    try:
        yield
    except DecideRefused as exc:
        raise AiRefused(
            exc.code,
            exc.node_message,
            status=exc.status,
            details=exc.details,
            retry_after=exc.retry_after,
        ) from exc
    except DecideUnreachable as exc:
        raise AiUnreachable(str(exc)) from exc
    except DecideError as exc:
        raise AiError(str(exc)) from exc


# ── the LLM ───────────────────────────────────────────────────────────────────────────────────


def node_llm(
    *,
    model: str | None = None,
    role: str | None = None,
    agent_name: str | None = None,
    node_url: str | None = None,
    agent_token: str | None = None,
    **llm_kwargs: Any,
) -> Any:
    """A ``crewai.LLM`` that calls the node's ``/v1/llm`` route with this agent's token.

    Pass it as any agent's ``llm=`` (``create_liaison_agent(llm=node_llm(...))`` included). The
    node then decides which model answers and which key pays, holds the call to the owner's policy,
    budget and the agent's cap, and records the usage. The agent needs the ``ai:use`` scope.

    ``model``: THE NODE CURRENTLY IGNORES IT. ``/v1/llm/chat/completions`` never reads the body's
    ``model``; the owner's preference decides, then the node's default. When ``model`` is None the
    package sends ``NODE_CHOOSES_MODEL``. A model id given here is sent as it is (the bare id as the
    owner's provider knows it, without the ``openai/`` prefix, which is added here), so it reaches
    the node if the node starts to read it. ``GET <node>/v1/llm/models`` lists the models the
    owner's policy allows.

    ``role``: the AI role the crew's calls run as, one of the owner's role ids (``GET /v1/ai/roles``
    lists them; ``reasoning`` and ``execution`` are built in). A capability says what a model does;
    a role says what it is used for, and the owner's role names the providers and models to try, in
    order. Sent on every call in the ``X-AIMEAT-AI-Role`` header, merged into any ``extra_headers``
    you pass. A role the owner does not have is refused ``400 AI_ROLE_UNKNOWN``; a string that is
    empty or longer than 300 characters raises ``AiError`` here, before anything is sent.

    The node and the token are resolved the way ``decide()`` resolves them: the argument, then the
    connector-stored token for ``agent_name``, then ``AIMEAT_NODE_URL`` and ``AIMEAT_AGENT_TOKEN``.
    ``llm_kwargs`` go to ``crewai.LLM`` unchanged (``temperature``, ``max_tokens``, ``timeout``,
    ``stream``...). ``base_url``, ``api_base`` and ``api_key`` are refused, because each one would
    send the crew's calls past the node.

    A refusal from the node (``402 AGENT_QUOTA_EXHAUSTED``, ``403`` for a model the policy does not
    allow, and so on) comes out of ``llm.call()`` as the exception CrewAI's provider raises. On the
    native path that is ``openai.APIStatusError``, whose text carries the HTTP status and the node's
    whole envelope, code included. On the LiteLLM path it is ``litellm.APIError``, whose text
    carries the node's message but not its code.
    """
    for key in ("base_url", "api_base", "api_key"):
        if key in llm_kwargs:
            raise AiError(
                f"node_llm() sets {key} itself: the LLM must call the node's /v1/llm route with the "
                "agent's token. Pass node_url= and agent_token= instead."
            )
    if role is not None:
        if not isinstance(role, str) or not 1 <= len(role) <= _ROLE_MAX_CHARS:
            raise AiError(
                f"node_llm(role=...) is one of the owner's AI role ids, a string of 1 to {_ROLE_MAX_CHARS} "
                "characters (GET /v1/ai/roles lists them)."
            )
        # extra_headers reaches the request on both code paths: the native OpenAI client takes it on
        # every create() call, and LiteLLM's completion() takes it too.
        headers = dict(llm_kwargs.pop("extra_headers", None) or {})
        headers[_ROLE_HEADER] = role
        llm_kwargs["extra_headers"] = headers
    try:
        from crewai import LLM
    except ImportError as exc:  # pragma: no cover -- crewai is a dependency of this package
        raise AiError("node_llm() needs crewai (pip install crewai).") from exc
    try:
        with _as_ai_errors():
            node = _node(agent_name=agent_name, node_url=node_url, agent_token=agent_token)
    except AiError:
        # No token or no address of its own. An agent made by the basic-agents button holds a key
        # and no stored token, and the connector daemon mints its credential; the daemon's REST
        # pass-through forwards /v1/llm over the agent's own connection with a current token.
        via = None if (node_url or agent_token) else _through_daemon(agent_name)
        if via is None:
            raise
        base_url, secret = via
        headers = dict(llm_kwargs.pop("extra_headers", None) or {})
        headers[_AGENT_HEADER] = agent_name or ""
        llm_kwargs["extra_headers"] = headers
        # The pass-through answers with the whole body: a streamed answer would arrive as one
        # parsed object, not as events.
        llm_kwargs["stream"] = False
        return LLM(model=f"openai/{model or NODE_CHOOSES_MODEL}", base_url=base_url, api_key=secret, **llm_kwargs)
    return LLM(
        model=f"openai/{model or NODE_CHOOSES_MODEL}",
        base_url=f"{node.url}/v1/llm",
        api_key=node.token,
        **llm_kwargs,
    )


#: The header the connector daemon reads to pick which of its agents a proxied call runs as.
_AGENT_HEADER = "X-Aimeat-Agent"


def _through_daemon(agent_name: str | None) -> tuple[str, str] | None:
    """``(base_url, secret)`` for the connector daemon's /v1/llm pass-through, when this home's
    serve.json names a live daemon that serves ``agent_name``; None otherwise.

    The daemon answers ``ALL /v1/*`` for the agent named in ``X-Aimeat-Agent`` and attaches that
    agent's current credential (aimeat/src/cli/connect/mcp/local-server.ts), so the crew never holds
    a token and a key-based agent works the same as one with a stored token.
    """
    if not agent_name:
        return None
    from .mcp_client import _pid_alive, _read_discovery, serve_discovery_path, serve_secret

    doc = _read_discovery(serve_discovery_path())
    if doc is None:
        return None
    pid = doc.get("pid")
    if isinstance(pid, int) and not _pid_alive(pid):
        return None
    rows = doc.get("agents") or []
    served = any(
        isinstance(r, dict) and agent_name in (r.get("agent"), r.get("gaii")) for r in rows
    ) or any(isinstance(r, str) and r == agent_name for r in rows)
    if not served:
        return None
    return f"http://127.0.0.1:{doc['port']}/v1/llm", serve_secret(doc) or "no-secret"


# ── what the caller can do ────────────────────────────────────────────────────────────────────


def capabilities(
    *,
    app_id: str | None = None,
    agent_name: str | None = None,
    node_url: str | None = None,
    agent_token: str | None = None,
    session: Any = None,
) -> dict[str, Any]:
    """What this agent can do with AI on this node: the ``data`` of ``GET /v1/ai/capabilities``.

    The answer has ``capabilities`` (one entry per name in ``CAPABILITIES``), ``policy`` (the
    owner's model policy mode and whether it binds this caller), ``budget`` (the daily budget and
    today's spend, in USD), ``catalog`` (when the model catalogue was last refreshed) and ``guide``
    (the node skill that explains all of it, ``node:aimeat-ai-capabilities``).

    Each capability has ``on``. One that is on names the ``model``, the ``provider`` and its
    ``providerType``, who chose it (``chosenBy``), which key pays (``keySource``), the
    ``fallbacks`` and the ``price``. One that is off has ``reason``, ``message`` and ``fix``: pass
    the message and the fix on to the owner as they are. The reasons:

      ``NO_MODEL``              no model is set for this capability.
      ``NO_PROVIDER_SUPPORTS``  none of the owner's providers can do it (``providersThatCan`` lists
                                the kinds that could).
      ``NO_KEY``                no key is set for a provider that could.
      ``POLICY_EMPTY``          the owner's model policy allows no model for it.
      ``BUDGET_EXHAUSTED``      today's budget is used up.
      ``RETIRED_MODEL``         the chosen model is retired.
      ``UNTESTED``              the provider was never tested.
      ``APP_NOT_ALLOWED``       the app named by ``app_id`` may not use it.
      ``UNAVAILABLE``           none of the above; ``message`` says why.

    ``app_id`` names the app the caller acts for, as on every AI call; left out, the answer is for
    the agent itself. Raises ``AiRefused`` with the node's code when the node refuses the read (a
    missing ``ai:use`` scope, a bad token), ``AiUnreachable`` when the node cannot be reached, and
    ``AiError`` when the node URL or the token is missing.
    """
    params = {"app_id": app_id} if app_id else None
    with _as_ai_errors():
        node = _node(agent_name=agent_name, node_url=node_url, agent_token=agent_token, session=session)
        data = _call(node, "get", "/v1/ai/capabilities", **({"params": params} if params else {}))
    return dict(data or {})
