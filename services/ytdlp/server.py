"""Tiny HTTP wrapper around yt-dlp so Harmoni never runs it in-process.

GET /resolve?id=<youtube id>  -> {"url", "mimeType", "ext", "abr", "filesize", "durationMs", "headers", "expiresAt", "availableAt"}
     &fresh=1                    resolves again instead of answering from the cache
GET /download?id=<youtube id> -> the audio file itself, downloaded by yt-dlp (honours Range)
GET /health                    -> {"ok": true, "ytdlp": "<version>"}

/resolve is the fast path: Harmoni fetches the audio from YouTube itself.
Resolved URLs are cached in memory until shortly before they expire.
When YouTube attaches a pre-roll ad, the URL only serves once the ad could
have been skipped: "availableAt" (unix seconds) says when.

/download is the fallback: yt-dlp does the whole job (waiting out ads,
retrying, whatever YouTube needs this week) and the file is served once it's
complete. Slower to start, but it keeps up with YouTube better than any copy
of yt-dlp's tricks could. Files are kept briefly, so the player's follow-up
range requests don't download again.
"""

import json
import os
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
DOWNLOAD_DIR = "/tmp/harmoni-downloads"
KEEP_DOWNLOADS_S = 600
DOWNLOAD_ATTEMPTS = 2
AUDIO_TYPES = {"m4a": "audio/mp4", "mp4": "audio/mp4", "webm": "audio/webm", "opus": "audio/ogg", "mp3": "audio/mpeg"}

_cache: dict[str, dict] = {}
_lock = threading.Lock()
_download_locks: dict[str, threading.Lock] = {}


class NotFound(Exception):
    pass


def _extract(video_id: str, opts: dict, download: bool):
    try:
        with yt_dlp.YoutubeDL({"format": FORMAT, "quiet": True, "no_warnings": True, "noplaylist": True, **opts}) as ydl:
            info = ydl.extract_info(f"https://music.youtube.com/watch?v={video_id}", download=download)
            return info, ydl.prepare_filename(info) if download else None
    except yt_dlp.utils.DownloadError as err:
        message = str(err)
        if "unavailable" in message.lower() or "private" in message.lower():
            raise NotFound(message) from err
        raise


def resolve(video_id: str, fresh: bool = False) -> dict:
    with _lock:
        hit = None if fresh else _cache.get(video_id)
        if hit and hit["expiresAt"] - EXPIRY_MARGIN_S > time.time():
            return hit

    info, _ = _extract(video_id, {}, download=False)
    url = info["url"]
    expire = parse_qs(urlparse(url).query).get("expire", [None])[0]
    ext = info.get("ext") or "m4a"
    result = {
        "url": url,
        "ext": ext,
        "mimeType": AUDIO_TYPES.get(ext, f"audio/{ext}"),
        "abr": info.get("abr"),
        "filesize": info.get("filesize") or info.get("filesize_approx"),
        "durationMs": int(info["duration"] * 1000) if info.get("duration") else None,
        "headers": info.get("http_headers") or {},
        "expiresAt": int(expire) if expire else int(time.time()) + 3600,
        "availableAt": info.get("available_at"),
    }
    with _lock:
        _cache[video_id] = result
    return result


def _finished(video_id: str) -> str | None:
    for name in os.listdir(DOWNLOAD_DIR):
        stem, ext = os.path.splitext(name)
        if stem == video_id and ext[1:] in AUDIO_TYPES:
            return os.path.join(DOWNLOAD_DIR, name)
    return None


def _sweep():
    cutoff = time.time() - KEEP_DOWNLOADS_S
    for name in os.listdir(DOWNLOAD_DIR):
        path = os.path.join(DOWNLOAD_DIR, name)
        try:
            if os.path.getmtime(path) < cutoff:
                os.remove(path)
        except OSError:
            pass


# The path of the song's audio, downloaded by yt-dlp. Asks for the same song
# at once share one download.
def download(video_id: str) -> str:
    os.makedirs(DOWNLOAD_DIR, exist_ok=True)
    _sweep()
    with _lock:
        lock = _download_locks.setdefault(video_id, threading.Lock())
    with lock:
        done = _finished(video_id)
        if done:
            os.utime(done)  # still in use: keep it a while longer
            return done
        # YouTube now and then refuses a freshly resolved URL for good, even
        # after the ad wait; a fresh look-up gets one that works.
        for attempt in range(DOWNLOAD_ATTEMPTS):
            try:
                _, path = _extract(
                    video_id,
                    {"outtmpl": f"{DOWNLOAD_DIR}/%(id)s.%(ext)s", "noprogress": True, "socket_timeout": 15, "continuedl": False},
                    download=True,
                )
                return path
            except yt_dlp.utils.DownloadError as err:
                if "403" not in str(err) or attempt == DOWNLOAD_ATTEMPTS - 1:
                    raise
        raise AssertionError("unreachable")


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            return self._json(200, {"ok": True, "ytdlp": YTDLP_VERSION})
        if parsed.path not in ("/resolve", "/download"):
            return self._json(404, {"error": "not found"})

        query = parse_qs(parsed.query)
        video_id = query.get("id", [""])[0]
        if not ID_PATTERN.match(video_id):
            return self._json(400, {"error": "invalid id"})
        started = time.time()
        try:
            if parsed.path == "/download":
                path = download(video_id)
            else:
                result = resolve(video_id, fresh=query.get("fresh", [""])[0] == "1")
        except NotFound as err:
            return self._json(404, {"error": str(err)})
        except Exception as err:  # noqa: BLE001 - report every failure to the caller
            return self._json(502, {"error": str(err)})

        if parsed.path == "/download":
            self.log_message("downloaded %s in %.2fs", video_id, time.time() - started)
            return self._file(path)
        self.log_message("resolved %s in %.2fs", video_id, time.time() - started)
        self._json(200, result)

    def _file(self, path: str):
        size = os.path.getsize(path)
        ext = os.path.splitext(path)[1][1:]
        start, end = 0, size - 1
        match = re.match(r"^bytes=(\d+)-(\d*)$", self.headers.get("Range") or "")
        if match:
            start = int(match.group(1))
            end = min(int(match.group(2)), size - 1) if match.group(2) else size - 1
            if start >= size or start > end:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.end_headers()
                return
        self.send_response(206 if match else 200)
        self.send_header("Content-Type", AUDIO_TYPES.get(ext, "application/octet-stream"))
        self.send_header("X-Ext", ext)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        if match:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        try:
            with open(path, "rb") as f:
                f.seek(start)
                left = end - start + 1
                while left > 0:
                    chunk = f.read(min(65536, left))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass  # the player moved on

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
