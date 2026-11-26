"""Takes the API key from a phone on the same network, so nobody types it on the handheld.

While the key step is open, a small HTTP server on the local network serves one page.
The QR code on screen holds its address and a one-time token; the phone sends the key
back here, where it is checked with DeepSeek and saved. The server stops once a key is
saved, after TTL seconds, after too many wrong tokens, or when the step closes.
The key and the token are never logged.
"""
from __future__ import annotations

import hmac
import html
import http.server
import json
import secrets
import socket
import socketserver
import threading
import urllib.parse

import api_key

PORTS = range(8765, 8785)
TTL = 600
MAX_BAD_TOKENS = 20
MAX_BODY = 4096


def lan_address() -> str | None:
    """The address other devices on the network reach this one at. Sends no packet."""
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(("192.0.2.1", 9))  # TEST-NET-1: only picks the outgoing interface
        address = probe.getsockname()[0]
    except OSError:
        return None
    finally:
        probe.close()
    return None if not address or address.startswith("127.") or address == "0.0.0.0" else address


class KeyHandoff:
    def __init__(self, check=api_key.check, save=api_key.save, on_saved=None, address=lan_address,
                 ports=PORTS, ttl=TTL):
        self._check, self._save, self._on_saved = check, save, on_saved
        self._address, self._ports, self._ttl = address, ports, ttl
        self._lock = threading.Lock()
        self._server: _Server | None = None
        self._timer: threading.Timer | None = None
        self._token = ""
        self._url: str | None = None
        self._language = "en"
        self._phase = "off"  # off | waiting | saved | unavailable
        self._bad_tokens = 0

    def start(self, language: str = "en") -> dict:
        with self._lock:
            self._language = language if language in PAGES else "en"
            if self._server:
                return self._snapshot()
            address = self._address()
            server = self._bind() if address else None
            if not server:
                self._phase, self._url = "unavailable", None
                return self._snapshot()
            self._server, self._token, self._bad_tokens = server, secrets.token_urlsafe(18), 0
            self._url = f"http://{address}:{server.server_address[1]}/?t={self._token}"
            self._phase = "waiting"
            threading.Thread(target=server.serve_forever, name="key-handoff", daemon=True).start()
            self._timer = threading.Timer(self._ttl, self.stop)
            self._timer.daemon = True
            self._timer.start()
            return self._snapshot()

    def stop(self) -> None:
        with self._lock:
            self._close("off" if self._phase != "saved" else "saved")

    def snapshot(self) -> dict:
        with self._lock:
            return self._snapshot()

    def _snapshot(self) -> dict:
        return {"phase": self._phase, "url": self._url if self._phase == "waiting" else None}

    def _bind(self) -> _Server | None:
        handoff = self

        class Handler(_Handler):
            owner = handoff

        for port in self._ports:
            try:
                server = _Server(("0.0.0.0", port), Handler)
            except OSError:
                continue
            return server
        return None

    def _close(self, phase: str) -> None:
        """Caller holds the lock. Shutting down waits for serve_forever, so it runs on its own thread."""
        server, self._server = self._server, None
        if self._timer:
            self._timer.cancel()
            self._timer = None
        self._phase, self._url, self._token = phase, None, ""
        if server:
            threading.Thread(target=lambda: (server.shutdown(), server.server_close()), daemon=True).start()

    # Called from the server's threads.
    def _token_ok(self, token: str) -> bool:
        with self._lock:
            if self._phase != "waiting":
                return False
            if token and hmac.compare_digest(token, self._token):
                return True
            self._bad_tokens += 1
            if self._bad_tokens >= MAX_BAD_TOKENS:
                self._close("off")
            return False

    def _receive(self, token: str, key: str) -> tuple[int, str]:
        if not self._token_ok(token):
            return 403, "expired"
        result = self._check(key)
        if result != "ok":
            return 200, result
        with self._lock:
            if self._phase != "waiting" or not hmac.compare_digest(token, self._token):
                return 403, "expired"
            try:
                self._save(key)
            except ValueError:
                return 200, "invalid"
            self._close("saved")
        if self._on_saved:
            self._on_saved()
        return 200, "ok"

    def _page(self) -> str:
        with self._lock:
            return render_page(self._language)


class _Server(http.server.ThreadingHTTPServer):
    daemon_threads = True
    # A link still closing keeps its port; a new one takes the next port instead of sharing it.
    allow_reuse_address = False

    def server_bind(self):
        # HTTPServer.server_bind looks up the host's name by reverse DNS, which can stall
        # for seconds; the page never uses it.
        socketserver.TCPServer.server_bind(self)
        self.server_name, self.server_port = "DeckyDSH", self.server_address[1]


class _Handler(http.server.BaseHTTPRequestHandler):
    owner: KeyHandoff
    server_version = "DeckyDSH"
    sys_version = ""

    def log_message(self, format, *args):  # the query carries the token
        pass

    def _send(self, status: int, body: str, content_type: str) -> None:
        data = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        parts = urllib.parse.urlsplit(self.path)
        token = urllib.parse.parse_qs(parts.query).get("t", [""])[0]
        if parts.path != "/" or not self.owner._token_ok(token):
            self._send(403, EXPIRED_PAGE, "text/html; charset=utf-8")
            return
        self._send(200, self.owner._page(), "text/html; charset=utf-8")

    def do_POST(self):
        if urllib.parse.urlsplit(self.path).path != "/key":
            self._send(404, "{}", "application/json")
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_BODY:
                raise ValueError
            body = json.loads(self.rfile.read(length))
            token, key = str(body["token"]), str(body["key"]).strip()
        except (ValueError, KeyError, TypeError):
            self._send(400, json.dumps({"result": "invalid"}), "application/json")
            return
        status, result = self.owner._receive(token, key)
        self._send(status, json.dumps({"result": result}), "application/json")


PAGES = {
    "en": {
        "lang": "en", "title": "DeckyDSH API key",
        "lead": "Paste your DeepSeek API key. It goes straight to your handheld on this network.",
        "label": "API key", "save": "Send to handheld", "checking": "Checking with DeepSeek…",
        "ok": "Saved. You can close this page; your handheld moves on by itself.",
        "invalid": "DeepSeek refused this key. Check it and try again.",
        "network": "Your handheld couldn't reach DeepSeek. Check its connection and try again.",
        "expired": "This link has expired. Open the key step on your handheld again for a new QR code.",
        "where": "Create a key at platform.deepseek.com → API keys.",
    },
    "zh-CN": {
        "lang": "zh-CN", "title": "DeckyDSH API Key",
        "lead": "粘贴你的 DeepSeek API Key，它会通过当前网络直接发到掌机上。",
        "label": "API Key", "save": "发送到掌机", "checking": "正在向 DeepSeek 校验…",
        "ok": "已保存。可以关掉这个页面，掌机会自动进入下一步。",
        "invalid": "DeepSeek 不认这个 Key，请检查后重试。",
        "network": "掌机连不上 DeepSeek，请检查掌机网络后重试。",
        "expired": "链接已失效。请在掌机上重新打开填 Key 这一步，扫新的二维码。",
        "where": "在 platform.deepseek.com → API keys 创建。",
    },
    "zh-TW": {
        "lang": "zh-TW", "title": "DeckyDSH API Key",
        "lead": "貼上你的 DeepSeek API Key，它會透過目前網路直接傳到掌機上。",
        "label": "API Key", "save": "傳送到掌機", "checking": "正在向 DeepSeek 驗證…",
        "ok": "已儲存。可以關掉這個頁面，掌機會自動進入下一步。",
        "invalid": "DeepSeek 不接受這個 Key，請檢查後重試。",
        "network": "掌機連不上 DeepSeek，請檢查掌機網路後重試。",
        "expired": "連結已失效。請在掌機上重新開啟填 Key 這一步，掃新的 QR 碼。",
        "where": "在 platform.deepseek.com → API keys 建立。",
    },
}

EXPIRED_PAGE = """<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>DeckyDSH</title><body style="font:16px/1.5 system-ui,sans-serif;background:#0e141b;color:#dcdedf;padding:24px">
<p>This link has expired. Open the key step on your handheld again.</p><p>链接已失效，请在掌机上重新打开填 Key 这一步。</p></body>"""

_TEMPLATE = """<!doctype html>
<html lang="{lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<style>
body{{margin:0;font:16px/1.5 system-ui,-apple-system,sans-serif;background:#0e141b;color:#dcdedf}}
main{{max-width:480px;margin:0 auto;padding:28px 20px}}
h1{{font-size:22px;margin:0 0 8px}} p{{color:#8b929a;margin:0 0 18px}}
label{{display:block;font-size:14px;color:#8b929a;margin-bottom:6px}}
input{{width:100%;box-sizing:border-box;font:16px ui-monospace,monospace;padding:12px;border-radius:6px;border:1px solid #3d4450;background:#1f2126;color:#fff}}
button{{width:100%;margin-top:14px;padding:14px;border:0;border-radius:6px;font-size:17px;font-weight:600;background:#1a9fff;color:#fff}}
button:disabled{{opacity:.5}} #msg{{margin-top:16px;min-height:24px}} .ok{{color:#5ba32b}} .bad{{color:#e35e5e}}
small{{display:block;margin-top:24px;color:#67707b}}
</style></head><body><main>
<h1>{title}</h1><p>{lead}</p>
<form id="f"><label for="k">{label}</label>
<input id="k" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="sk-…" required>
<button id="b">{save}</button></form>
<div id="msg"></div><small>{where}</small>
<script>
const T={messages};
const token=new URLSearchParams(location.search).get("t")||"";
const f=document.getElementById("f"),k=document.getElementById("k"),b=document.getElementById("b"),m=document.getElementById("msg");
f.addEventListener("submit",async e=>{{e.preventDefault();b.disabled=true;m.className="";m.textContent=T.checking;
let r="network";try{{const res=await fetch("/key",{{method:"POST",headers:{{"Content-Type":"application/json"}},body:JSON.stringify({{token,key:k.value.trim()}})}});r=(await res.json()).result||"network";}}catch(_){{r="expired";}}
m.textContent=T[r]||T.network;m.className=r==="ok"?"ok":"bad";
if(r==="ok"){{k.value="";f.remove();}}else if(r!=="expired"){{b.disabled=false;}}}});
</script></main></body></html>"""


def render_page(language: str) -> str:
    strings = PAGES.get(language, PAGES["en"])
    escaped = {name: html.escape(value) for name, value in strings.items()}
    messages = json.dumps({name: strings[name] for name in ("checking", "ok", "invalid", "network", "expired")},
                          ensure_ascii=False).replace("<", "\\u003c")
    return _TEMPLATE.format(messages=messages, **escaped)
