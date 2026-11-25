"""A JSON-RPC 2.0 connection to `dsh --profile acp` over its standard input and output.

The process and its reader run on plain threads, so stopping never depends on
Decky's event loop. Agent-to-client requests (permission prompts) are handed to
`on_request`; notifications (session updates) to `on_notification`.
"""
from __future__ import annotations

import concurrent.futures
import json
import os
import signal
import subprocess
import threading
from typing import Callable

PROTOCOL_VERSION = 1


class AcpError(Exception):
    def __init__(self, message: str, code: int | None = None):
        super().__init__(message)
        self.code = code


class AcpProcess:
    def __init__(self, argv: list[str], env: dict, cwd: str,
                 on_notification: Callable[[str, dict], None],
                 on_request: Callable[[object, str, dict], None],
                 on_exit: Callable[[int | None, str], None],
                 popen=subprocess.Popen):
        self._process = popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              env=env, cwd=cwd, start_new_session=True)
        self._on_notification = on_notification
        self._on_request = on_request
        self._on_exit = on_exit
        self._lock = threading.Lock()
        self._next_id = 0
        self._pending: dict[int, concurrent.futures.Future] = {}
        self._stderr_tail: list[str] = []
        threading.Thread(target=self._read_stdout, name="dsh-acp-out", daemon=True).start()
        threading.Thread(target=self._read_stderr, name="dsh-acp-err", daemon=True).start()

    @property
    def alive(self) -> bool:
        return self._process.poll() is None

    def request(self, method: str, params: dict) -> concurrent.futures.Future:
        future: concurrent.futures.Future = concurrent.futures.Future()
        with self._lock:
            self._next_id += 1
            message_id = self._next_id
            self._pending[message_id] = future
        try:
            self._send({"jsonrpc": "2.0", "id": message_id, "method": method, "params": params})
        except OSError as error:
            with self._lock:
                self._pending.pop(message_id, None)
            future.set_exception(AcpError(f"dsh is not running: {error}"))
        return future

    def notify(self, method: str, params: dict) -> None:
        self._send({"jsonrpc": "2.0", "method": method, "params": params})

    def respond(self, message_id: object, result: dict | None = None, error: dict | None = None) -> None:
        reply = {"jsonrpc": "2.0", "id": message_id}
        reply.update({"error": error} if error is not None else {"result": result})
        self._send(reply)

    def initialize(self, timeout: float) -> dict:
        return self.request("initialize", {
            "protocolVersion": PROTOCOL_VERSION,
            "clientCapabilities": {"fs": {"readTextFile": False, "writeTextFile": False}, "terminal": False},
        }).result(timeout)

    def stop(self, timeout: float = 2.0) -> None:
        """Close stdin (dsh's clean shutdown), then end the whole process group if it lingers."""
        try:
            if self._process.stdin:
                self._process.stdin.close()
            self._process.wait(timeout)
        except (OSError, subprocess.TimeoutExpired):
            try:
                os.killpg(self._process.pid, signal.SIGKILL)
            except (OSError, AttributeError):
                self._process.kill()

    def _send(self, message: dict) -> None:
        data = (json.dumps(message, ensure_ascii=False) + "\n").encode("utf-8")
        with self._lock:
            self._process.stdin.write(data)
            self._process.stdin.flush()

    def _read_stdout(self) -> None:
        for raw in self._process.stdout:
            try:
                message = json.loads(raw)
            except ValueError:
                continue
            if not isinstance(message, dict):
                continue
            if "method" in message and "id" in message:
                self._on_request(message["id"], message["method"], message.get("params") or {})
            elif "method" in message:
                self._on_notification(message["method"], message.get("params") or {})
            elif "id" in message:
                with self._lock:
                    future = self._pending.pop(message["id"], None)
                if future is None:
                    continue
                if "error" in message:
                    error = message["error"] or {}
                    future.set_exception(AcpError(str(error.get("message", "dsh error")), error.get("code")))
                else:
                    future.set_result(message.get("result") or {})
        code = self._process.wait()
        with self._lock:
            pending, self._pending = self._pending, {}
        for future in pending.values():
            future.set_exception(AcpError("dsh exited"))
        self._on_exit(code, "\n".join(self._stderr_tail))

    def _read_stderr(self) -> None:
        for raw in self._process.stderr:
            line = raw.decode("utf-8", "replace").rstrip()
            if line:
                self._stderr_tail = (self._stderr_tail + [line])[-20:]
