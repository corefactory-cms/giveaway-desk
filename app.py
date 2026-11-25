"""Serve 응모수첩 in a browser on this computer."""

import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import secrets
import sqlite3
import sys
import urllib.error
import urllib.request
from urllib.parse import urlsplit
import webbrowser

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))  # Windows embedded Python starts with an isolated module path.
import storage

DEFAULT_PORT = 18437
APP_VERSION = "1.2.2"
ASSETS = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/app.css": ("app.css", "text/css; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/agents.js": ("agents.js", "text/javascript; charset=utf-8"),
    "/records.js": ("records.js", "text/javascript; charset=utf-8"),
    "/records.css": ("records.css", "text/css; charset=utf-8"),
    "/inventory.js": ("inventory.js", "text/javascript; charset=utf-8"),
    "/inventory.css": ("inventory.css", "text/css; charset=utf-8"),
    "/fonts/PretendardVariable.woff2": ("fonts/PretendardVariable.woff2", "font/woff2"),
}


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False

    def __init__(self, addr, instance):
        super().__init__(addr, Handler)
        self.instance = instance
        self.token = secrets.token_urlsafe(32)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def reply(self, status, content, mime="application/json; charset=utf-8"):
        if not isinstance(content, bytes):
            content = json.dumps(content, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
            "connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'",
        )
        self.end_headers()
        try:
            self.wfile.write(content)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def local_host(self):
        port = self.server.server_port
        return self.headers.get("Host") in (f"127.0.0.1:{port}", f"localhost:{port}")

    def do_GET(self):
        if not self.local_host():
            return self.reply(403, {"error": "PC의 로컬 주소로 열어 주세요."})
        path = urlsplit(self.path).path
        if path == "/api/health":
            return self.reply(200, {"app": "giveaway-desk", "instance": self.server.instance})
        if path == "/api/state":
            try:
                return self.reply(200, {"items": storage.catalog(personal=True),
                                        "today": storage.today(), "token": self.server.token})
            except sqlite3.Error:
                return self.reply(500, {"error": "로컬 데이터베이스를 읽을 수 없습니다."})
        if path in ASSETS:
            filename, mime = ASSETS[path]
            try:
                return self.reply(200, (ROOT / "web" / filename).read_bytes(), mime)
            except OSError:
                return self.reply(404, {"error": "화면 파일을 찾을 수 없습니다."})
        return self.reply(404, {"error": "페이지를 찾을 수 없습니다."})

    def do_POST(self):
        if not self.local_host():
            return self.reply(403, {"error": "PC의 로컬 주소로 열어 주세요."})
        origin = self.headers.get("Origin")
        token = self.headers.get("X-Local-Token", "")
        if (origin is not None and origin != f'http://{self.headers["Host"]}') or not secrets.compare_digest(
            token.encode("utf-8"), self.server.token.encode("ascii")
        ):
            return self.reply(403, {"error": "화면을 새로고침한 뒤 다시 시도해 주세요."})
        handlers = {"/api/import": storage.import_events, "/api/record": storage.save_record,
                    "/api/records/preview": lambda data: storage.import_records(data, preview=True),
                    "/api/records/apply": storage.import_records}
        handler = handlers.get(self.path)
        if not handler:
            return self.reply(404, {"error": "페이지를 찾을 수 없습니다."})
        if self.headers.get_content_type() != "application/json":
            return self.reply(415, {"error": "JSON 형식으로 보내 주세요."})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= storage.MAX_BYTES:
                return self.reply(413, {"error": "입력은 5 MiB까지 가능합니다."})
            data = json.loads(self.rfile.read(length).decode("utf-8-sig"))
            return self.reply(200, handler(data))
        except (ValueError, RecursionError) as exc:
            return self.reply(400, {"error": str(exc)})
        except sqlite3.Error:
            return self.reply(500, {"error": "로컬 저장소에 기록할 수 없습니다. 다시 시도해 주세요."})


def existing_instance(url, instance):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(url + "/api/health", timeout=1) as response:
            state = json.loads(response.read(2048))
        return isinstance(state, dict) and state.get("instance") == instance
    except (OSError, ValueError, urllib.error.URLError):
        return False


def main():
    parser = argparse.ArgumentParser(description="응모수첩을 이 PC에서 실행합니다.")
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    if args.port is not None and not 0 <= args.port <= 65535:
        parser.error("포트 번호는 0~65535 사이여야 합니다.")
    storage.initialize()
    install = f"{APP_VERSION}\n{ROOT}\n{storage.app_home().resolve()}"
    instance = hashlib.sha256(install.encode("utf-8")).hexdigest()[:20]
    # An older release may still be running when a new download is opened.
    ports = [args.port] if args.port is not None else [*range(DEFAULT_PORT, DEFAULT_PORT + 5), 0]
    for port in ports:
        try:
            server = Server(("127.0.0.1", port), instance)
            break
        except OSError:
            url = f"http://127.0.0.1:{port}"
            if existing_instance(url, instance):
                if sys.stdout is not None:
                    print(url, flush=True)
                if not args.no_browser:
                    webbrowser.open(url)
                return
            if args.port is not None or port == 0:
                raise
    with server:
        url = f"http://127.0.0.1:{server.server_port}"
        if sys.stdout is not None:
            print(url, flush=True)
        if not args.no_browser:
            webbrowser.open(url)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
