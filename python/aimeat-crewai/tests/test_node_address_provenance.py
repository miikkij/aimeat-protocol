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
