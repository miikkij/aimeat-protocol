"""The connector home, resolved as the Node connector resolves it (aimeat/src/cli/connect/home-dir.ts).

Secrets audit 2026-10-09: the default home moved from ``<cwd>/.aimeat`` to ``~/.aimeat``, because a
home inside a project put the agent tokens and keys where that project's .gitignore does not cover
them. ``AIMEAT_HOME`` still wins, and an existing ``<cwd>/.aimeat`` that holds connector state is
still used until 3.27.0 of the node. Both sides must agree, or the liaison looks for ``serve.json``
in one folder while the daemon writes it in another.
"""
from __future__ import annotations

from pathlib import Path

from aimeat_crewai.paths import aimeat_home


def _at(monkeypatch, tmp_path: Path) -> tuple[Path, Path]:
    project = tmp_path / "project"
    user = tmp_path / "user"
    project.mkdir()
    user.mkdir()
    monkeypatch.delenv("AIMEAT_HOME", raising=False)
    monkeypatch.chdir(project)
    monkeypatch.setenv("HOME", str(user))
    monkeypatch.setenv("USERPROFILE", str(user))
    return project, user


def test_default_is_the_user_home_not_the_project(tmp_path, monkeypatch) -> None:
    _, user = _at(monkeypatch, tmp_path)
    assert aimeat_home() == user / ".aimeat"


def test_aimeat_home_still_wins(tmp_path, monkeypatch) -> None:
    _at(monkeypatch, tmp_path)
    monkeypatch.setenv("AIMEAT_HOME", str(tmp_path / "explicit"))
    assert aimeat_home() == tmp_path / "explicit"


def test_an_existing_project_home_with_state_is_still_used(tmp_path, monkeypatch) -> None:
    project, _ = _at(monkeypatch, tmp_path)
    (project / ".aimeat" / "tokens").mkdir(parents=True)
    assert aimeat_home() == project / ".aimeat"


def test_an_empty_project_folder_named_aimeat_is_not_a_home(tmp_path, monkeypatch) -> None:
    project, user = _at(monkeypatch, tmp_path)
    (project / ".aimeat").mkdir()
    assert aimeat_home() == user / ".aimeat"
