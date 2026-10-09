"""The connector home, resolved as the Node connector resolves it (aimeat/src/cli/connect/home-dir.ts).

``AIMEAT_HOME`` wins; otherwise ``<cwd>/.aimeat``, one daemon per project (the 2026-06-17 ruling,
kept by the secrets audit of 2026-10-09, which keeps the folder out of git with a ``.gitignore`` of
``*`` instead of moving it). Both sides must agree, or the liaison looks for ``serve.json`` in one
folder while the daemon writes it in another.
"""
from __future__ import annotations

from pathlib import Path

from aimeat_crewai.paths import aimeat_home


def _in_project(monkeypatch, tmp_path: Path) -> Path:
    project = tmp_path / "project"
    project.mkdir()
    monkeypatch.delenv("AIMEAT_HOME", raising=False)
    monkeypatch.chdir(project)
    return project


def test_default_is_the_project_folder(tmp_path, monkeypatch) -> None:
    project = _in_project(monkeypatch, tmp_path)
    assert aimeat_home() == project / ".aimeat"


def test_aimeat_home_still_wins(tmp_path, monkeypatch) -> None:
    _in_project(monkeypatch, tmp_path)
    monkeypatch.setenv("AIMEAT_HOME", str(tmp_path / "explicit"))
    assert aimeat_home() == tmp_path / "explicit"
