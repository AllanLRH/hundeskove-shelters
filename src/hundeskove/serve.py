"""Static file server for the browser UI.

Not an API. The UI is a static build that reads the JSON `discover` and
`availability` already write, so all this does is put the built page and the
output directory on one origin, which `file://` cannot do.
"""

import functools
import logging
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DATA_PREFIX = "/data/"

logger = logging.getLogger(__name__)


class UIRequestHandler(SimpleHTTPRequestHandler):
    """Serve the built UI, with `/data/` mapped onto the output directory."""

    def __init__(self, *args, ui_dir: Path, data_dir: Path, **kwargs):
        self.data_dir = data_dir
        super().__init__(*args, directory=str(ui_dir), **kwargs)

    def translate_path(self, path: str) -> str:
        if path.startswith(DATA_PREFIX):
            # Re-root onto the data directory, reusing the base class's own
            # traversal-safe normalisation rather than joining by hand.
            original, self.directory = self.directory, str(self.data_dir)
            try:
                return super().translate_path(path[len(DATA_PREFIX) - 1 :])
            finally:
                self.directory = original
        return super().translate_path(path)

    # Parameter named `format` to match BaseHTTPRequestHandler, which is what
    # makes this a valid override — it shadows the builtin only inside these
    # two lines, and renaming it would break a keyword call from the base class.
    def log_message(self, format: str, *args) -> None:
        logger.debug("%s - %s", self.address_string(), format % args)


def serve(ui_dir: Path, data_dir: Path, port: int, host: str = "127.0.0.1") -> None:
    if not (ui_dir / "index.html").exists():
        raise SystemExit(
            f"No built UI at {ui_dir}. Run `just build` (or `npm --prefix ui run build`) first."
        )
    if not data_dir.exists():
        raise SystemExit(f"No data at {data_dir}. Run `just data` first.")

    handler = functools.partial(UIRequestHandler, ui_dir=ui_dir, data_dir=data_dir)
    with ThreadingHTTPServer((host, port), handler) as server:
        logger.info(
            "serving %s (data from %s) at http://%s:%d", ui_dir, data_dir, host, port
        )
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            logger.info("stopped")
