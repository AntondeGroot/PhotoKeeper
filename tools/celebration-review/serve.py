"""Review server.

Threaded + keep-alive, so a few hundred thumbnails in one page load do not queue
behind each other one connection at a time.

It also takes writes, which the review pages need for work that has to outlive a
browser profile: locking a selection, and storing images pasted back in from the
image tool.

    POST /api/write?name=locked.json   body: JSON        -> <root>/locked.json
    POST /api/image?id=<tileId>        body: image bytes -> <root>/restyled/<id>.png
    GET  /api/restyled                 -> {id: mtime} for every stored image

Writes refuse anything that would escape the served directory.
"""
import json
import os
import re
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
RESTYLED = os.path.join(ROOT, "restyled")
RESTYLED_THUMBS = os.path.join(RESTYLED, "thumbs")

SAFE_NAME = re.compile(r"^[A-Za-z0-9._-]+$")

# Pasted images come out of the image tool at full size (~1.5 MB each). The review
# grid shows every tile at once, so it reads these instead.
THUMB_PX = 320


def write_thumb(png_path, tile_id):
    os.makedirs(RESTYLED_THUMBS, exist_ok=True)
    im = Image.open(png_path)
    im.thumbnail((THUMB_PX, THUMB_PX), Image.LANCZOS)
    im.save(os.path.join(RESTYLED_THUMBS, tile_id + ".webp"), quality=82, method=4)


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path.split("?")[0] == "/api/restyled":
            return self._ok(self._restyled_index())
        return super().do_GET()

    def _restyled_index(self):
        """{tileId: mtime} - mtime doubles as the cache-busting version."""
        if not os.path.isdir(RESTYLED):
            return {}
        return {f[:-4]: int(os.path.getmtime(os.path.join(RESTYLED, f)))
                for f in os.listdir(RESTYLED) if f.endswith(".png")}

    def do_POST(self):
        try:
            route, _, query = self.path.partition("?")
            params = dict(p.split("=", 1) for p in query.split("&") if "=" in p)
            body = self.rfile.read(int(self.headers.get("Content-Length", 0)))

            if route == "/api/write":
                self._write_json(params.get("name", ""), body)
            elif route == "/api/image":
                self._write_image(params.get("id", ""), body)
            else:
                self.send_error(404, "no such endpoint")
        except Exception as exc:                      # keep the page usable
            self.send_error(500, str(exc))

    def _write_json(self, name, body):
        if not SAFE_NAME.match(name) or not name.endswith(".json"):
            return self.send_error(400, "bad name")
        json.loads(body)                              # reject anything unparseable
        with open(os.path.join(ROOT, name), "wb") as fh:
            fh.write(body)
        self._ok({"wrote": name, "bytes": len(body)})

    def _write_image(self, tile_id, body):
        if not SAFE_NAME.match(tile_id):
            return self.send_error(400, "bad id")
        if not body[:8] == b"\x89PNG\r\n\x1a\n" and not body[:3] == b"\xff\xd8\xff":
            return self.send_error(400, "not a PNG or JPEG")
        os.makedirs(RESTYLED, exist_ok=True)
        path = os.path.join(RESTYLED, tile_id + ".png")
        with open(path, "wb") as fh:
            fh.write(body)
        write_thumb(path, tile_id)
        self._ok({"wrote": f"restyled/{tile_id}.png", "bytes": len(body),
                  "mtime": int(os.path.getmtime(path))})

    def _ok(self, payload):
        out = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)


if __name__ == "__main__":
    os.chdir(ROOT)
    ThreadingHTTPServer(("127.0.0.1", 8777), Handler).serve_forever()