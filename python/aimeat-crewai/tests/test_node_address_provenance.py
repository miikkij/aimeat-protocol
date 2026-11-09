"""A bearer token goes only to a node address that came from the same place as the token.

``decide._node`` (used by ``decide()``, ``capabilities()``, ``node_llm()`` and the crew LLM path)
can read the node address from ``<connector home>/config.yaml``. Without ``AIMEAT_HOME`` the home
is the folder the process runs in, so a folder somebody cloned or received can hold a config.yaml
that names another node. A token from the environment (``AIMEAT_AGENT_TOKEN``) is not paired with
that address: the folder's config is read only when ``AIMEAT_HOME`` is set explicitly, or when the
token itself was read from the same home (secaudit2026oct22).

These tests build the pair and look at it; nothing is sent.
"""
from __future__ import annotations

import logging
from pathlib import Path

import pytest

from aimeat_crewai.decide import DecideError, _node


@pytest.fixture
def clean_env(monkeypatch) -> None:
    for var in ("AIMEAT_HOME", "AIMEAT_NODE_URL", "AIMEAT_AGENT_TOKEN"):
        monkeypatch.delenv(var, raising=False)


def _folder_with_config(root: Path, node_url: str) -> Path:
    folder = root / "received-project"
    (folder / ".aimeat").mkdir(parents=True)
    (folder / ".aimeat" / "config.yaml").write_text(f"node_url: {node_url}\n", encoding="utf-8")
    return folder


def test_an_env_token_is_not_paired_with_the_current_folders_config(
    clean_env, tmp_path, monkeypatch, caplog
) -> None:
    folder = _folder_with_config(tmp_path, "http://other-node.example.invalid")
    monkeypatch.chdir(folder)
    monkeypatch.setenv("AIMEAT_AGENT_TOKEN", "env-token")

    with (
        caplog.at_level(logging.WARNING, logger="aimeat_crewai.decide"),
        pytest.raises(DecideError, match="node_url is required"),
    ):
        _node(agent_name="x")

    ignored = [r.getMessage() for r in caplog.records if "config.yaml" in r.getMessage()]
    assert len(ignored) == 1, "one plain line names the ignored file"
    assert str(folder / ".aimeat" / "config.yaml") in ignored[0]


def test_an_env_token_goes_to_the_env_address_and_the_folders_config_is_ignored(
    clean_env, tmp_path, monkeypatch
) -> None:
    folder = _folder_with_config(tmp_path, "http://other-node.example.invalid")
    monkeypatch.chdir(folder)
    monkeypatch.setenv("AIMEAT_AGENT_TOKEN", "env-token")
    monkeypatch.setenv("AIMEAT_NODE_URL", "http://own-node.example.invalid")

    node = _node(agent_name="x")
    assert (node.url, node.token) == ("http://own-node.example.invalid", "env-token")


def test_an_argument_token_is_not_paired_with_the_current_folders_config(
    clean_env, tmp_path, monkeypatch
) -> None:
    folder = _folder_with_config(tmp_path, "http://other-node.example.invalid")
    monkeypatch.chdir(folder)

    with pytest.raises(DecideError, match="node_url is required"):
        _node(agent_token="arg-token")


def test_a_token_stored_in_the_current_folders_home_uses_that_homes_address(
    clean_env, tmp_path, monkeypatch
) -> None:
    # The connector wrote both files into the same home: the pair has one source.
    folder = _folder_with_config(tmp_path, "http://own-node.example.invalid")
    (folder / ".aimeat" / "tokens").mkdir()
    (folder / ".aimeat" / "tokens" / "x@me.token").write_text("stored-token", encoding="utf-8")
    monkeypatch.chdir(folder)
    monkeypatch.setenv("AIMEAT_AGENT_TOKEN", "env-token")

    node = _node(agent_name="x")
    assert (node.url, node.token) == ("http://own-node.example.invalid", "stored-token")


def test_with_aimeat_home_set_the_homes_config_names_the_node_for_an_env_token(
    clean_env, tmp_path, monkeypatch
) -> None:
    # The hosted fleet's shape: AIMEAT_HOME set in the crew image, node_url in its config.yaml,
    # the token in the environment, and no AIMEAT_NODE_URL.
    home = tmp_path / "fleet-home"
    home.mkdir()
    (home / "config.yaml").write_text("node_url: http://fleet-node.example.invalid/\n", encoding="utf-8")
    monkeypatch.setenv("AIMEAT_HOME", str(home))
    monkeypatch.setenv("AIMEAT_AGENT_TOKEN", "env-token")

    node = _node(agent_name="x")
    assert (node.url, node.token) == ("http://fleet-node.example.invalid", "env-token")


def test_with_aimeat_home_set_a_stored_token_and_the_homes_config_pair_as_before(
    clean_env, tmp_path, monkeypatch
) -> None:
    home = tmp_path / "fleet-home"
    (home / "tokens").mkdir(parents=True)
    (home / "config.yaml").write_text("node_url: http://fleet-node.example.invalid\n", encoding="utf-8")
    (home / "tokens" / "concierge@alice.token").write_text("stored-token", encoding="utf-8")
    monkeypatch.setenv("AIMEAT_HOME", str(home))

    node = _node(agent_name="concierge")
    assert (node.url, node.token) == ("http://fleet-node.example.invalid", "stored-token")


# A home with two agents on two nodes. The connector writes the home's config.yaml for the first
# agent it connects (with its agent: and owner: lines) and every agent's own node_url to
# agents/<owner>/<agent>/config.yaml. A stored token goes only to the node its own agent was
# connected to, the way the Node connector's heldNodeUrl and fallbackConfigFor decide it
# (secaudit2026nov08 round 14).


def _two_agent_home(root: Path, monkeypatch) -> Path:
    home = root / "two-agent-home"
    (home / "tokens").mkdir(parents=True)
    (home / "config.yaml").write_text(
        "node_url: http://node-a.example.invalid\nagent: x\nowner: me\n", encoding="utf-8"
    )
    (home / "tokens" / "x@me.token").write_text("x-token", encoding="utf-8")
    (home / "tokens" / "y@me.token").write_text("y-token", encoding="utf-8")
    monkeypatch.setenv("AIMEAT_HOME", str(home))
    return home


def test_a_stored_token_goes_to_its_own_agents_node_not_the_first_agents(
    clean_env, tmp_path, monkeypatch
) -> None:
    home = _two_agent_home(tmp_path, monkeypatch)
    (home / "agents" / "me" / "y").mkdir(parents=True)
    (home / "agents" / "me" / "y" / "config.yaml").write_text(
        "node_url: http://node-b.example.invalid\n", encoding="utf-8"
    )

    node = _node(agent_name="y")
    assert (node.url, node.token) == ("http://node-b.example.invalid", "y-token")


def test_the_old_shared_per_agent_config_names_the_node_too(clean_env, tmp_path, monkeypatch) -> None:
    home = _two_agent_home(tmp_path, monkeypatch)
    (home / "agents" / "y").mkdir(parents=True)
    (home / "agents" / "y" / "config.yaml").write_text(
        "node_url: 'http://node-b.example.invalid/'\n", encoding="utf-8"
    )

    node = _node(agent_name="y")
    assert (node.url, node.token) == ("http://node-b.example.invalid", "y-token")


def test_a_home_config_written_for_another_agent_is_not_used_for_a_stored_token(
    clean_env, tmp_path, monkeypatch
) -> None:
    home = _two_agent_home(tmp_path, monkeypatch)

    with pytest.raises(DecideError) as refused:
        _node(agent_name="y")
    message = str(refused.value)
    assert str(home / "config.yaml") in message, "the refusal names the file that was not used"
    assert "AIMEAT_NODE_URL" in message, "the refusal says how to name the node"


def test_a_daemon_that_serves_the_agent_carries_the_call_when_its_node_is_unknown(
    clean_env, tmp_path, monkeypatch
) -> None:
    import json
    import os

    home = _two_agent_home(tmp_path, monkeypatch)
    (home / "serve.json").write_text(json.dumps({
        "schema_version": 3, "port": 9, "pid": os.getpid(), "secret": "s3cret",
        "agents": [{"agent": "y", "owner": "me", "gaii": "y#me@node-b"}],
    }), encoding="utf-8")

    node = _node(agent_name="y")
    assert (node.url, node.token, node.via_daemon_agent) == ("http://127.0.0.1:9", "s3cret", "y")


def test_a_home_config_written_for_another_owner_is_not_used_for_a_stored_token(
    clean_env, tmp_path, monkeypatch
) -> None:
    home = _two_agent_home(tmp_path, monkeypatch)
    (home / "tokens" / "x@other.token").write_text("other-x-token", encoding="utf-8")

    with pytest.raises(DecideError):
        _node(agent_name="x#other@node-b")


def test_the_first_agent_still_pairs_with_the_home_config(clean_env, tmp_path, monkeypatch) -> None:
    _two_agent_home(tmp_path, monkeypatch)

    node = _node(agent_name="x")
    assert (node.url, node.token) == ("http://node-a.example.invalid", "x-token")
    node = _node(agent_name="x#me@node-a")
    assert (node.url, node.token) == ("http://node-a.example.invalid", "x-token")


def test_an_address_in_the_environment_still_wins_for_a_stored_token(
    clean_env, tmp_path, monkeypatch
) -> None:
    _two_agent_home(tmp_path, monkeypatch)
    monkeypatch.setenv("AIMEAT_NODE_URL", "http://named-node.example.invalid")

    node = _node(agent_name="y")
    assert (node.url, node.token) == ("http://named-node.example.invalid", "y-token")
