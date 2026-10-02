"""
The owner's model choice for a crew, read safely: the crew-side half of ``crews.llm.<agent>``.

The node stores the owner's choice for an agent's crew at ``crews.llm.<agent>`` (or
``crews.llm.default``) in three shapes (aimeat/src/services/crew-menu.ts):

  ``{kind: 'node', role?}``     the crew thinks through the node's ``/v1/llm`` with the agent's own
                                credential, and the node picks the model and the key: the agent's
                                own key, then the owner's own, then the node's from the owner's
                                allowance. ``llm_for_choice()`` builds that LLM with ``node_llm()``.
  ``{kind: 'profile', profile}`` a profile from the runtime's own provider map.
  ``{kind: 'model', provider}``  one model, whose ``api_key_env`` names the variable on THIS machine
                                that holds the key, sent to ``base_url``.

WHICH CHOICE APPLIES (``effective_llm_choice``) is the node's decision, read from
``GET /v1/agents/{name}/crew/llm``: the agent's own, the owner's default, then the node when the agent
holds ``ai:use`` and the node can pay for its text, otherwise the machine's key (Jouni, 2026-10-02).

THE GUARD (``unsafe_choice_reason``). A ``model`` choice makes the crew send
``os.environ[api_key_env]`` as a bearer to ``base_url``, and a crew run inherits the environment of
the machine it runs on. Since 2026-10-02 the node refuses to store a choice whose key variable is
not a provider key or whose address is not public https (aimeat/src/services/crew-llm-guard.ts). A
record saved before that, or one that reached the node some other way, is still readable, so the
runtime checks the same rules when it reads a choice and treats a refused one as no choice.

The rules, the node's own, word for word:
  - ``api_key_env``: a name ending in ``_API_KEY`` that does not start with ``AIMEAT_``, or one of
    ``EXACT_KEY_ENV_NAMES`` (the names the runtime's provider map uses that do not end so).
  - every address field (``base_url``, ``api_base``, ``endpoint``, ``url``): https, and no address it
    resolves to is private, loopback, link-local, carrier-grade NAT, reserved or multicast.

Mirror of the node contract; where this file and the node disagree, the node is right.
"""
from __future__ import annotations

import ipaddress
import re
import socket
from typing import Any
from urllib.parse import urlsplit

__all__ = [
    "EXACT_KEY_ENV_NAMES",
    "KEY_ENV_RULE",
    "effective_llm_choice",
    "is_node_choice",
    "llm_for_choice",
    "unsafe_choice_reason",
]

#: In words, for every refusal: what a key variable may be.
KEY_ENV_RULE = (
    "api_key_env names a provider key variable: a name ending in _API_KEY that does not start "
    "with AIMEAT_ (for example OPENROUTER_API_KEY)"
)

#: Key variable names the runtime's provider map uses that do not end in _API_KEY.
EXACT_KEY_ENV_NAMES: tuple[str, ...] = ("NVIDIA_KEY",)

_PROVIDER_KEY_ENV = re.compile(r"^[A-Z][A-Z0-9_]*_API_KEY$")
_ADDRESS_FIELD = re.compile(r"^(base_?url|api_?base|endpoint|url)$", re.IGNORECASE)


def _key_env_problem(name: Any) -> str | None:
    if not isinstance(name, str) or not name:
        return f"{KEY_ENV_RULE}. Got an empty value."
    if name in EXACT_KEY_ENV_NAMES:
        return None
    if _PROVIDER_KEY_ENV.match(name) and not name.startswith("AIMEAT_"):
        return None
    return f"{KEY_ENV_RULE}, or one of {', '.join(EXACT_KEY_ENV_NAMES)}. \"{name}\" is not one."


def _blocked_ip(raw: str) -> str | None:
    try:
        ip = ipaddress.ip_address(raw)
    except ValueError:
        return None
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    if ip.is_loopback:
        return "a loopback address"
    if ip.is_link_local:
        return "a link-local address"
    if ip.is_private:
        return "a private address"
    if isinstance(ip, ipaddress.IPv4Address) and ip in ipaddress.ip_network("100.64.0.0/10"):
        return "a carrier-grade NAT address"
    if ip.is_multicast or ip.is_reserved or ip.is_unspecified:
        return "a reserved address"
    return None


def _address_problem(url: Any) -> str | None:
    if not isinstance(url, str) or not url.strip():
        return "base_url is not an address."
    try:
        parts = urlsplit(url.strip())
    except ValueError:
        return "base_url is not an address."
    if parts.scheme != "https" or not parts.hostname:
        return f"base_url must be https: the crew sends its key there. Got {parts.scheme or 'no scheme'}."
    host = parts.hostname
    if host == "localhost" or host.endswith(".localhost"):
        return "base_url is refused: a loopback address. A crew may send its key only to a public https address."
    literal = _blocked_ip(host)
    if literal:
        return f"base_url is refused: {literal}. A crew may send its key only to a public https address."
    try:
        infos = socket.getaddrinfo(host, parts.port or 443, proto=socket.IPPROTO_TCP)
    except OSError:
        return "base_url is refused: its name does not resolve."
    for info in infos:
        reason = _blocked_ip(str(info[4][0]))
        if reason:
            return f"base_url is refused: it resolves to {reason}. A crew may send its key only to a public https address."
    return None


def _provider_problem(provider: Any, depth: int = 0) -> str | None:
    if depth > 4 or not isinstance(provider, (dict, list)):
        return None
    items = provider.items() if isinstance(provider, dict) else enumerate(provider)
    for key, value in items:
        if key == "api_key_env" and value is not None:
            problem = _key_env_problem(value)
            if problem:
                return problem
        elif isinstance(key, str) and _ADDRESS_FIELD.match(key) and isinstance(value, str) and value.strip():
            problem = _address_problem(value)
            if problem:
                return problem
        elif isinstance(value, (dict, list)):
            problem = _provider_problem(value, depth + 1)
            if problem:
                return problem
    return None


def unsafe_choice_reason(choice: Any) -> str | None:
    """Why the runtime must not use this stored choice, or None when it may.

    Only a ``model`` choice can be unsafe: it is the one that names a key variable and an address.
    The caller treats a refused choice as no choice, logs the reason, and falls back the way it does
    when the owner chose nothing.
    """
    if not isinstance(choice, dict) or choice.get("kind") != "model":
        return None
    return _provider_problem(choice.get("provider"))


def is_node_choice(choice: Any) -> bool:
    """True for ``{kind: 'node', role?}``: the crew thinks through the node."""
    return isinstance(choice, dict) and choice.get("kind") == "node"


def effective_llm_choice(*, agent_name: str, **node_kwargs: Any) -> dict[str, Any] | None:
    """The choice that applies to this agent's crew, as the node decides it, or None.

    ``GET /v1/agents/{name}/crew/llm`` (aimeat/src/services/crew-menu.ts effectiveLlmChoice) answers
    ``{value, scope, key_source?, why}``: the agent's own saved choice, else the owner's default, else
    ``{kind: 'node'}`` when the agent holds ``ai:use`` and the node can pay for its text now (the
    agent's key, the owner's or the node's), else no choice. Ruled by Jouni on 2026-10-02. The node is
    the one place that decides; this only reads it, so a runtime cannot drift from the rule.

    A ``model`` choice is checked with ``unsafe_choice_reason`` before it is returned, and a refused
    one is None. Any failure to ask (no token, the node unreachable or older, a refusal) is None too:
    the crew keeps the key on its own machine, which is what it did before this existed.
    ``node_kwargs`` go to the node client (``node_url``, ``agent_token``, ``session``).
    """
    from urllib.parse import quote

    from .ai import AiError, _as_ai_errors
    from .decide import _call, _node

    try:
        with _as_ai_errors():
            node = _node(agent_name=agent_name, **node_kwargs)
            data = _call(node, "get", f"/v1/agents/{quote(agent_name, safe='')}/crew/llm")
    except AiError:
        return None
    value = (data or {}).get("value") if isinstance(data, dict) else None
    if not isinstance(value, dict) or unsafe_choice_reason(value):
        return None
    return value


def llm_for_choice(choice: Any, *, agent_name: str, **llm_kwargs: Any) -> Any:
    """A ``crewai.LLM`` for a ``{kind: 'node'}`` choice, or None for any other shape.

    The LLM calls the node's ``/v1/llm`` as ``agent_name`` (``node_llm()``): the node picks the model
    and the key, holds the call to the owner's policy, budget and the agent's cap, and records it.
    ``role`` from the choice goes in the ``X-AIMEAT-AI-Role`` header. The agent needs ``ai:use``; a
    node that refuses it answers 403 ``SCOPE_DENIED`` on the first call, and the agent's page then
    shows the owner which word to grant.
    """
    if not is_node_choice(choice):
        return None
    from .ai import node_llm

    role = choice.get("role")
    return node_llm(agent_name=agent_name, **({"role": role} if isinstance(role, str) and role else {}), **llm_kwargs)
