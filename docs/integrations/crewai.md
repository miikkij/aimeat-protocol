# CrewAI integration

The guide to connecting a CrewAI crew to an AIMEAT node is the README of the
[`aimeat-crewai`](https://pypi.org/project/aimeat-crewai/) package:
[python/aimeat-crewai/README.md](../../python/aimeat-crewai/README.md). It covers setup, the three
transports (the loopback serve daemon, stdio, HTTP), the daemon mode, skills, files, data packages,
decision rules, why a liaison agent rather than a task-runner subprocess, and which package version
each node version needs. What changed in each release is in its
[CHANGELOG](../../python/aimeat-crewai/CHANGELOG.md).

This page used to hold its own copy of that guide. The copy stopped at package 0.2 while the
package moved on, so it was merged into the package README on 2026-10-11 and this pointer stays for
the links that reach it. Moving an existing crew to the serve daemon:
[crewai-upgrade-to-serve.md](crewai-upgrade-to-serve.md).
