"""Tiny HTTP wrapper around yt-dlp so Harmoni never runs it in-process.

GET /resolve?id=<youtube id>  -> {"url", "mimeType", "ext", "abr", "filesize", "durationMs", "headers", "expiresAt"}
GET /health                    -> {"ok": true, "ytdlp": "<version>"}

Resolved URLs are cached in memory until shortly before they expire.
"""

import json
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import yt_dlp
from yt_dlp.version import __version__ as YTDLP_VERSION

ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{11}$")
# m4a/AAC first: it plays everywhere, including Safari.
FORMAT = "bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/bestaudio"
EXPIRY_MARGIN_S = 600

_cache: dict[str, dict] = {}
_lock = threading.Lock()


class NotFound(Exception):
    pass


def resolve(video_id: str) -> dict:
    with _lock:
        hit = _cache.get(video_id)
        if hit and hit["expiresAt"] - EXPIRY_MARGIN_S > time.time():
            return hit

    opts = {"format": FORMAT, "quiet": True, "no_warnings": True, "noplaylist": True}
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(f"https://music.youtube.com/watch?v={video_id}", download=False)
    except yt_dlp.utils.DownloadError as err:
        message = str(err)
        if "unavailable" in message.lower() or "private" in message.lower():
            raise NotFound(message) from err
        raise

    url = info["url"]
    expire = parse_qs(urlparse(url).query).get("expire", [None])[0]
    ext = info.get("ext") or "m4a"
    result = {
        "url": url,
        "ext": ext,
        "mimeType": "audio/mp4" if ext == "m4a" else f"audio/{ext}",
        "abr": info.get("abr"),
        "filesize": info.get("filesize") or info.get("filesize_approx"),
        "durationMs": int(info["duration"] * 1000) if info.get("duration") else None,
        "headers": info.get("http_headers") or {},
        "expiresAt": int(expire) if expire else int(time.time()) + 3600,
    }
    with _lock:
        _cache[video_id] = result
    return result


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            return self._json(200, {"ok": True, "ytdlp": YTDLP_VERSION})
        if parsed.path != "/resolve":
            return self._json(404, {"error": "not found"})

        video_id = parse_qs(parsed.query).get("id", [""])[0]
        if not ID_PATTERN.match(video_id):
            return self._json(400, {"error": "invalid id"})
        started = time.time()
        try:
            result = resolve(video_id)
        except NotFound as err:
            return self._json(404, {"error": str(err)})
        except Exception as err:  # noqa: BLE001 - report every failure to the caller
            return self._json(502, {"error": str(err)})
        self.log_message("resolved %s in %.2fs", video_id, time.time() - started)
        self._json(200, result)

    def _json(self, status: int, body: dict):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    print(f"harmoni-ytdlp listening on :8080 (yt-dlp {YTDLP_VERSION})", flush=True)
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
