# @file skills-standard-validate.py
# @author Jouni Miikki
# SPDX-License-Identifier: MIT
# @description Runs the Agent Skills specification's reference validator (skills-ref, from
#   github.com/agentskills/agentskills) on every skill folder named on the command line, in one
#   process, and prints one line per folder. Exit status 1 when any folder has an error.
#   scripts/check-skills-standard.ts writes the folders and calls this through uv with skills-ref
#   pinned; it is not meant to be run by hand.
# @usage uv run --no-project --python 3.12 --with skills-ref==0.1.1 python scripts/skills-standard-validate.py <dir>...
# @version-history
#   v1.0.0 - 2026-10-26 - Initial (wish-agent-skills-standardin-t-ysi-tuki-skill-rekisteriss).
import sys
from pathlib import Path

from skills_ref.validator import validate


def main(dirs: list[str]) -> int:
    failed = 0
    for d in dirs:
        errors = validate(Path(d))
        name = Path(d).name
        if errors:
            failed += 1
            for e in errors:
                print(f"FAIL {name}: {e}")
        else:
            print(f"ok {name}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
