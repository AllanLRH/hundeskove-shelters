"""Command line entry point: argument parsing and dispatch, nothing else.

The work lives in `pipeline`, which sequences the I/O, and in `geo`, `booking`,
`osm` and `catalogue`, which hold the decisions and are pure enough to test
directly.
"""

import argparse
import logging
import sys
from pathlib import Path

from . import pipeline, serve as serve_module, udinaturen

DEFAULT_CATALOGUE = Path("output/shelters.json")
DEFAULT_OUT_DIR = Path("output")
DEFAULT_CACHE = Path("cache/place_ids.json")
DEFAULT_OSM_CACHE = Path("cache/osm_dog_parks.json")
DEFAULT_UI_DIR = Path("ui/dist")

logger = logging.getLogger("hundeskove")


def _regions(value: str) -> tuple[int, ...]:
    return tuple(int(part) for part in value.split(","))


def _categories(value: str) -> dict[int, str]:
    known = udinaturen.OVERNIGHT_CATEGORIES
    chosen = {}
    for part in value.split(","):
        umb_id = int(part)
        if umb_id not in known:
            raise argparse.ArgumentTypeError(
                f"unknown category {umb_id}; known: "
                + ", ".join(f"{k} ({v})" for k, v in known.items())
            )
        chosen[umb_id] = known[umb_id]
    return chosen


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="hundeskove",
        description="Shelters in Danish off-leash dog forests, and when they are free.",
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="debug logging")
    subparsers = parser.add_subparsers(dest="command", required=True)

    def add_discover_flags(sub: argparse.ArgumentParser) -> None:
        sub.add_argument(
            "--regions",
            type=_regions,
            default=udinaturen.ALL_REGIONS,
            help="comma-separated region ids (default: all five, 81-85)",
        )
        sub.add_argument(
            "--categories",
            type=_categories,
            default=udinaturen.OVERNIGHT_CATEGORIES,
            help="comma-separated umbIds to include (default: 1115,1111,1112,1106)",
        )
        sub.add_argument(
            "--max-distance",
            type=float,
            default=500.0,
            help="metres from a dog forest a facility may be and still count (default: 500)",
        )
        sub.add_argument(
            "--cache", type=Path, default=DEFAULT_CACHE, help="GUID -> place id cache file"
        )
        sub.add_argument(
            "--no-cache", action="store_true", help="ignore and do not write the cache"
        )
        sub.add_argument(
            "--osm-cache",
            type=Path,
            default=DEFAULT_OSM_CACHE,
            help="cached OSM dog parks used to fill missing dog-forest boundaries",
        )
        sub.add_argument(
            "--refresh-osm",
            action="store_true",
            help="re-query Overpass instead of using the cached dog parks",
        )

    def add_availability_flags(sub: argparse.ArgumentParser) -> None:
        sub.add_argument(
            "--months",
            type=int,
            default=3,
            help="how far ahead to look (default: 3, the booking limit)",
        )
        sub.add_argument(
            "--out-dir", type=Path, default=DEFAULT_OUT_DIR, help="where to write results"
        )
        sub.add_argument(
            "--anchor-step",
            type=int,
            default=2,
            help="months between calendar anchors; lower means more overlap (default: 2)",
        )

    serve_parser = subparsers.add_parser("serve", help="serve the built UI locally")
    serve_parser.add_argument("--port", type=int, default=8000)
    serve_parser.add_argument("--host", default="127.0.0.1")
    serve_parser.add_argument("--ui-dir", type=Path, default=DEFAULT_UI_DIR)
    serve_parser.add_argument("--data-dir", type=Path, default=DEFAULT_OUT_DIR)

    for name in ("discover", "availability", "run"):
        sub = subparsers.add_parser(name)
        sub.add_argument(
            "--max-workers", type=int, default=8, help="concurrent HTTP requests"
        )
        if name in ("discover", "run"):
            add_discover_flags(sub)
        if name in ("availability", "run"):
            add_availability_flags(sub)
        if name == "discover":
            sub.add_argument("--out", type=Path, default=DEFAULT_CATALOGUE)
        if name == "availability":
            sub.add_argument("--shelters", type=Path, default=DEFAULT_CATALOGUE)
        if name == "run":
            sub.add_argument("--shelters", type=Path, default=DEFAULT_CATALOGUE)
            sub.add_argument(
                "--refresh-shelters",
                action="store_true",
                help="re-run discovery even if the catalogue already exists",
            )

    return parser


def _discover(args: argparse.Namespace, out_path: Path) -> None:
    pipeline.discover(
        regions=args.regions,
        categories=args.categories,
        max_distance_m=args.max_distance,
        out_path=out_path,
        cache_path=args.cache,
        use_cache=not args.no_cache,
        max_workers=args.max_workers,
        osm_cache_path=args.osm_cache,
        refresh_osm=args.refresh_osm,
    )


def _availability(args: argparse.Namespace, catalogue_path: Path) -> None:
    pipeline.check_availability(
        catalogue_path=catalogue_path,
        months=args.months,
        out_dir=args.out_dir,
        max_workers=args.max_workers,
        anchor_step=args.anchor_step,
    )


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(name)s: %(message)s",
        stream=sys.stderr,
    )
    # httpx2 logs a line per request; hundreds of those drown out our own output.
    logging.getLogger("httpx2").setLevel(logging.DEBUG if args.verbose else logging.WARNING)

    if args.command == "serve":
        serve_module.serve(args.ui_dir, args.data_dir, args.port, args.host)
    elif args.command == "discover":
        _discover(args, args.out)
    elif args.command == "availability":
        _availability(args, args.shelters)
    else:
        if args.refresh_shelters or not args.shelters.exists():
            _discover(args, args.shelters)
        else:
            logger.info("reusing existing catalogue %s", args.shelters)
        _availability(args, args.shelters)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
