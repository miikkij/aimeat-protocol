"""
`aimeat-offers` -- shell entry point for offer authoring / checking / publishing.

Subcommands:
  aimeat-offers check   [--file offers.json | --stdin]   -> per-offer level verdicts
  aimeat-offers publish --agent <name> [--node-url URL] [--require LEVEL] (--file|--stdin)

The local workflow-compat validator (`check`) is offline and dependency-light;
it mirrors the node's save-time gate so an agent can verify an offer before it
ever talks to the node. `publish` writes to agents.{name}.offers over REST.
"""
from __future__ import annotations

import argparse
import json
import sys
from typing import Any

from .offers import OfferValidationError, publish_offers, validate_offers_doc


def _load_doc(args: argparse.Namespace) -> dict[str, Any]:
    if args.stdin:
        raw = sys.stdin.read()
    elif args.file:
        with open(args.file, encoding="utf-8") as fh:
            raw = fh.read()
    else:
        raise SystemExit("provide --file <path> or --stdin")
    try:
        return json.loads(raw)
    except ValueError as exc:
        raise SystemExit(f"input is not valid JSON: {exc}") from exc


def _print_verdicts(verdicts: list[dict[str, Any]]) -> int:
    """Human-readable summary. Returns an exit code: 0 if every offer reaches at
    least level 1 (offering); 1 otherwise."""
    ok = True
    for v in verdicts:
        levels = []
        if v["offering"]:
            levels.append("offering")
        if v["workflow_compatible"]:
            levels.append("workflow-compatible")
        if v["priced"]:
            levels.append("priced")
        badge = ", ".join(levels) if levels else "INCOMPLETE"
        print(f"- {v.get('id') or '<no id>'}: {badge}")
        for level, reasons in v.get("missing", {}).items():
            for r in reasons:
                print(f"    · not {level}: {r}")
        for w in v.get("warnings", []):
            print(f"    ⚠ {w}")
        if not v["offering"]:
            ok = False
    return 0 if ok else 1


def cmd_check(args: argparse.Namespace) -> int:
    doc = _load_doc(args)
    try:
        verdicts = validate_offers_doc(doc, require=None)
    except OfferValidationError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    except ValueError as exc:
        print(f"invalid offers document: {exc}", file=sys.stderr)
        return 1
    if args.json:
        print(json.dumps(verdicts, ensure_ascii=False, indent=2))
        return 0 if all(v["offering"] for v in verdicts) else 1
    return _print_verdicts(verdicts)


def cmd_publish(args: argparse.Namespace) -> int:
    doc = _load_doc(args)
    try:
        body = publish_offers(
            doc,
            agent_name=args.agent,
            node_url=args.node_url,
            require=args.require,
        )
    except (OfferValidationError, RuntimeError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print(json.dumps(body, ensure_ascii=False, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="aimeat-offers", description="Author / check / publish AIMEAT offers.")
    sub = parser.add_subparsers(dest="command", required=True)

    def add_input(p: argparse.ArgumentParser) -> None:
        g = p.add_mutually_exclusive_group(required=True)
        g.add_argument("--file", help="path to an offers JSON document")
        g.add_argument("--stdin", action="store_true", help="read the offers JSON document from stdin")

    p_check = sub.add_parser("check", help="validate offers and report which levels each reaches")
    add_input(p_check)
    p_check.add_argument("--json", action="store_true", help="emit verdicts as JSON")
    p_check.set_defaults(func=cmd_check)

    p_pub = sub.add_parser("publish", help="publish offers to agents.{name}.offers on the node")
    add_input(p_pub)
    p_pub.add_argument("--agent", required=True, help="bare agent name (memory key segment)")
    p_pub.add_argument("--node-url", help="node base URL (else env AIMEAT_NODE_URL)")
    p_pub.add_argument(
        "--require",
        default="offering",
        choices=["offering", "workflow_compatible", "priced", "none"],
        help="minimum level to enforce before publishing (default: offering)",
    )
    p_pub.set_defaults(func=cmd_publish)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if getattr(args, "require", None) == "none":
        args.require = None
    return args.func(args)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
