"""Chats with dsh: one `dsh --profile acp` process, the plugin's own transcripts.

ACP's session/resume restores a conversation without replaying it, so the
plugin keeps what it showed (messages, tool calls, approvals) in its data
folder and dsh keeps the conversation itself in DSH_HOME.
"""
from __future__ import annotations

import json
import os
import posixpath
import threading
import time
from pathlib import Path
from urllib.parse import quote

import acp
import api_key
import installer
import paths
import plugin_settings
import runtime

START_TIMEOUT = 60
REQUEST_TIMEOUT = 60
TEXT_LIMIT = 2000
INPUT_LIMIT = 400
TITLE_LIMIT = 40
CHATS_DIR = paths.DATA_DIR / "chats"
PATCH_FILE = paths.DATA_DIR / "acp.patch.yml"
# The permission presets dsh ships, restated because a patch replaces the whole row.
PRESETS = {
    "read-only": ("read-only", "ask"),
    "workspace-write": ("workspace-write", "ask"),
    "danger-full-access": ("danger-full-access", "never"),
}


class ChatError(Exception):
    """A request the frontend made that cannot run; `code` is translated there."""

    def __init__(self, code: str, detail: str = ""):
        super().__init__(detail or code)
        self.code = code


def profile_patch(values: dict) -> str:
    """The overlay every dsh the plugin starts runs with: the user's approval default, and
    dsh's session-log upload to DeepSeek switched off; the plugin never sends it."""
    lines = ["- id: permission", "  config:", "    presets:"]
    for name, (sandbox, approval) in PRESETS.items():
        lines.append(f"      {name}: {{sandbox: {sandbox}, approval: {approval}}}")
    lines.append(f"    defaultPreset: {values['default_permission']}")
    lines += ["- id: session-log-deepseek", "  disabled: true"]
    return "\n".join(lines) + "\n"


def model_name(config_options) -> str:
    """The display name of the session's current model, from session/new's config options."""
    for option in config_options or []:
        if isinstance(option, dict) and option.get("id") == "model":
            current = option.get("currentValue")
            for group in option.get("options") or []:
                choices = (group.get("options") or [group]) if isinstance(group, dict) else []
                for choice in choices:
                    if isinstance(choice, dict) and choice.get("value") == current:
                        return str(choice.get("name", ""))
    return ""


def summarize_input(raw) -> str:
    if isinstance(raw, dict):
        for key in ("command", "cmd", "path", "file_path", "url", "query"):
            if isinstance(raw.get(key), str):
                return raw[key][:INPUT_LIMIT]
    text = raw if isinstance(raw, str) else json.dumps(raw, ensure_ascii=False)
    return text[:INPUT_LIMIT]


def content_text(blocks) -> str:
    """Text of ACP content blocks (or tool-call content wrappers), images left out."""
    parts = []
    for block in blocks or []:
        if isinstance(block, dict) and block.get("type") == "content":
            block = block.get("content")
        if isinstance(block, dict) and block.get("type") == "text":
            parts.append(str(block.get("text", "")))
    return "".join(parts)


class Chat:
    def __init__(self, meta: dict, items: list | None = None):
        self.meta = meta
        self.items: list[dict] = items or []
        self.version = 1
        self.busy = False
        self.usage: dict | None = None
        # Set when Stop interrupts a turn that left background jobs running.
        self.restart_after = False

    def changed(self) -> None:
        self.version += 1
        self.meta["updated"] = time.time()


class ChatService:
    def __init__(self, spawn=acp.AcpProcess, chats_dir: Path = CHATS_DIR):
        self._spawn = spawn
        self._dir = chats_dir
        # _lock guards the chats; it is never held while waiting on dsh, because
        # dsh's replies and updates arrive on a reader thread that needs it.
        self._lock = threading.RLock()
        self._start_lock = threading.Lock()
        self._process: acp.AcpProcess | None = None
        self._preset = plugin_settings.load()["default_permission"]
        self._live: set[str] = set()
        self._chats: dict[str, Chat] = {}
        self._load_index()

    # Storage -----------------------------------------------------------------

    def _load_index(self) -> None:
        try:
            metas = json.loads((self._dir / "index.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            metas = []
        for meta in metas if isinstance(metas, list) else []:
            if isinstance(meta, dict) and isinstance(meta.get("id"), str):
                chat = Chat(meta)
                chat.items = None  # Read from disk when the chat is first opened.
                self._chats[meta["id"]] = chat

    def _items(self, chat: Chat) -> list[dict]:
        if chat.items is None:
            try:
                chat.items = json.loads((self._dir / f"{chat.meta['id']}.json").read_text(encoding="utf-8"))
            except (OSError, ValueError):
                chat.items = []
        return chat.items

    def _save(self, chat: Chat | None = None) -> None:
        self._dir.mkdir(parents=True, exist_ok=True)
        if chat is not None and chat.items is not None:
            _write_json(self._dir / f"{chat.meta['id']}.json", chat.items)
        _write_json(self._dir / "index.json", [c.meta for c in self._chats.values()])

    # The dsh process ---------------------------------------------------------

    def _ensure_process(self) -> acp.AcpProcess:
        with self._start_lock:
            if self._process is not None and self._process.alive:
                return self._process
            return self._start()

    def _start(self) -> acp.AcpProcess:
        manifest = runtime.load_manifest()
        key = runtime.platform_key()
        if key is None or not runtime.is_installed(manifest["dsh"], manifest["assets"][key]["sha256"]):
            raise ChatError("not_installed")
        values = plugin_settings.load()
        self._preset = values["default_permission"]
        paths.DATA_DIR.mkdir(parents=True, exist_ok=True)
        PATCH_FILE.write_text(profile_patch(values), encoding="utf-8")
        env = installer.dsh_environment()
        stored = api_key.read()
        if stored:
            env[api_key.ENV_NAME] = stored
        argv = [str(runtime.executable(manifest["dsh"], key)), "--profile", "acp", "--patch", str(PATCH_FILE)]
        process = self._spawn(argv, env, str(paths.USER_HOME), self._on_notification, self._on_request, self._on_exit)
        try:
            process.initialize(START_TIMEOUT)
        except Exception as error:
            process.stop()
            raise ChatError("start_failed", str(error)) from error
        with self._lock:
            self._process = process
            self._live = set()
        return process

    def restart(self) -> None:
        """Settings changed: the next request starts dsh with them, unless a chat is running."""
        with self._lock:
            if self._process is not None and not any(c.busy for c in self._chats.values()):
                self._process.stop()
                self._process = None

    def stop(self, timeout: float = 1.0) -> None:
        with self._lock:
            process, self._process = self._process, None
        if process is not None:
            process.stop(timeout)

    # Requests from the frontend ----------------------------------------------

    def list(self) -> list[dict]:
        with self._lock:
            return sorted((dict(c.meta, busy=c.busy) for c in self._chats.values()),
                          key=lambda meta: meta.get("updated", 0), reverse=True)

    def new(self) -> dict:
        process = self._ensure_process()
        workspace = plugin_settings.load()["workspace"]
        Path(workspace).mkdir(parents=True, exist_ok=True)
        try:
            result = process.request("session/new", {"cwd": workspace, "mcpServers": []}).result(REQUEST_TIMEOUT)
        except Exception as error:
            raise ChatError("request_failed", str(error)) from error
        session_id = result["sessionId"]
        now = time.time()
        meta = {"id": session_id, "title": "", "cwd": workspace, "created": now, "updated": now,
                "preset": self._preset, "model": model_name(result.get("configOptions")),
                "starred": False, "archived": False}
        with self._lock:
            chat = Chat(meta, [])
            self._chats[session_id] = chat
            self._live.add(session_id)
            self._save(chat)
            return dict(chat.meta)

    def snapshot(self, session_id: str, version: int = 0) -> dict:
        with self._lock:
            chat = self._chat(session_id)
            items = self._items(chat)
            if version == chat.version:
                return {"version": chat.version, "unchanged": True}
            return {"version": chat.version, "busy": chat.busy, "title": chat.meta.get("title", ""),
                    "items": items, "usage": chat.usage, "model": chat.meta.get("model", ""),
                    "preset": chat.meta.get("preset", self._preset), "starred": chat.meta.get("starred", False)}

    def send(self, session_id: str, text: str, files: list[str] | None = None) -> dict:
        text = text.strip()
        files = [path for path in (files or []) if isinstance(path, str) and posixpath.isabs(path)]
        if not text and not files:
            raise ChatError("empty")
        with self._lock:
            chat = self._chat(session_id)
            if chat.busy:
                raise ChatError("busy")
            chat.busy = True  # Held while dsh starts or resumes, so a second send is refused.
        try:
            process = self._ensure_process()
            with self._lock:
                live = session_id in self._live
            if not live:
                try:
                    process.request("session/resume", {"sessionId": session_id, "cwd": chat.meta["cwd"],
                                                       "mcpServers": []}).result(REQUEST_TIMEOUT)
                except Exception as error:
                    raise ChatError("resume_failed", str(error)) from error
                with self._lock:
                    self._live.add(session_id)
        except Exception:
            with self._lock:
                chat.busy = False
            raise
        with self._lock:
            items = self._items(chat)
            items.append({"kind": "user", "text": text, "files": [posixpath.basename(path) for path in files]})
            if not chat.meta.get("title"):
                chat.meta["title"] = (text.splitlines() or [posixpath.basename(files[0])])[0][:TITLE_LIMIT]
            chat.changed()
            self._save(chat)
            prompt = [{"type": "text", "text": text}] if text else []
            # The model opens a linked file with its own tools.
            prompt += [{"type": "resource_link", "uri": "file://" + quote(path), "name": posixpath.basename(path)}
                       for path in files]
            future = process.request("session/prompt", {"sessionId": session_id, "prompt": prompt})
        future.add_done_callback(lambda done: self._finish(session_id, done))
        return {"version": chat.version}

    def cancel(self, session_id: str) -> None:
        with self._lock:
            chat = self._chat(session_id)
            # dsh keeps background jobs running after a cancel; ending dsh ends them.
            turn = []
            for item in reversed(self._items(chat)):
                if item["kind"] == "user":
                    break
                turn.append(item)
            chat.restart_after = any(item.get("background") for item in turn)
            if self._process is not None and self._process.alive:
                self._process.notify("session/cancel", {"sessionId": session_id})

    def answer(self, session_id: str, request_id: str, allow: bool) -> None:
        with self._lock:
            chat = self._chat(session_id)
            for item in self._items(chat):
                if item.get("kind") == "permission" and item.get("request") == request_id and item["state"] == "pending":
                    item["state"] = "allowed" if allow else "rejected"
                    chat.changed()
                    if self._process is not None:
                        self._process.respond(json.loads(request_id), {"outcome": {
                            "outcome": "selected", "optionId": "allow-once" if allow else "reject-once"}})
                    return
        raise ChatError("no_request")

    def update(self, session_id: str, changes: dict) -> dict:
        """Rename, star or archive a chat; these live in the plugin, not in dsh."""
        with self._lock:
            chat = self._chat(session_id)
            for key, value in changes.items():
                if key == "title" and isinstance(value, str) and value.strip():
                    chat.meta["title"] = value.strip()[:80]
                elif key in ("starred", "archived") and isinstance(value, bool):
                    chat.meta[key] = value
                else:
                    raise ChatError("bad_change", key)
            chat.version += 1
            self._save(chat)
            return dict(chat.meta)

    def delete(self, session_id: str) -> None:
        """Forget a chat. dsh cannot delete a session; it is closed and left in DSH_HOME."""
        with self._lock:
            chat = self._chat(session_id)
            if chat.busy:
                raise ChatError("busy")
            del self._chats[session_id]
            live = session_id in self._live
            self._live.discard(session_id)
            process = self._process
            (self._dir / f"{session_id}.json").unlink(missing_ok=True)
            self._save()
        if live and process is not None and process.alive:
            process.request("session/close", {"sessionId": session_id})

    def _chat(self, session_id: str) -> Chat:
        chat = self._chats.get(session_id)
        if chat is None:
            raise ChatError("unknown_chat")
        return chat

    # Messages from dsh (reader thread) ---------------------------------------

    def _finish(self, session_id: str, future) -> None:
        with self._lock:
            chat = self._chats.get(session_id)
            if chat is None:
                return
            chat.busy = False
            items = self._items(chat)
            error = future.exception()
            if error is not None:
                items.append({"kind": "notice", "code": "error", "text": str(error)[:TEXT_LIMIT]})
            else:
                reason = (future.result() or {}).get("stopReason", "end_turn")
                if reason != "end_turn":
                    items.append({"kind": "notice", "code": reason, "text": ""})
            for item in items:
                if item.get("kind") == "permission" and item["state"] == "pending":
                    item["state"] = "cancelled"
            chat.changed()
            self._save(chat)
            restart = chat.restart_after and not any(c.busy for c in self._chats.values())
            chat.restart_after = False
        if restart:
            threading.Thread(target=self.restart, name="dsh-restart", daemon=True).start()

    def _on_notification(self, method: str, params: dict) -> None:
        if method != "session/update":
            return
        with self._lock:
            chat = self._chats.get(params.get("sessionId", ""))
            update = params.get("update") or {}
            if chat is None or not isinstance(update, dict):
                return
            if self._apply(self._items(chat), chat, update):
                chat.changed()

    @staticmethod
    def _apply(items: list[dict], chat: Chat, update: dict) -> bool:
        kind = update.get("sessionUpdate")
        if kind in ("agent_message_chunk", "agent_thought_chunk"):
            text = content_text([update.get("content")])
            if not text:
                return False
            item_kind = "assistant" if kind == "agent_message_chunk" else "thought"
            message_id = update.get("messageId")
            last = items[-1] if items else None
            if last and last["kind"] == item_kind and last.get("id") == message_id:
                last["text"] += text
            else:
                items.append({"kind": item_kind, "id": message_id, "text": text})
            return True
        if kind == "tool_call":
            items.append({"kind": "tool", "id": update.get("toolCallId"), "title": str(update.get("title", "")),
                          "input": summarize_input(update.get("rawInput")),
                          "status": update.get("status", "in_progress"), "output": "",
                          "background": isinstance(update.get("rawInput"), dict)
                          and bool(update["rawInput"].get("run_in_background"))})
            return True
        if kind == "tool_call_update":
            for item in reversed(items):
                if item["kind"] == "tool" and item.get("id") == update.get("toolCallId"):
                    item["status"] = update.get("status", item["status"])
                    if update.get("content"):
                        item["output"] = content_text(update["content"])[:TEXT_LIMIT]
                    return True
            return False
        if kind == "usage_update":
            chat.usage = {"used": update.get("used"), "size": update.get("size")}
            return True
        return False

    def _on_request(self, message_id, method: str, params: dict) -> None:
        with self._lock:
            process = self._process
            chat = self._chats.get(params.get("sessionId", "")) if method == "session/request_permission" else None
            if chat is None:
                if process is not None:
                    if method == "session/request_permission":
                        process.respond(message_id, {"outcome": {"outcome": "selected", "optionId": "reject-once"}})
                    else:
                        process.respond(message_id, error={"code": -32601, "message": f"unsupported: {method}"})
                return
            tool = (params.get("toolCall") or {}).get("toolCallId")
            self._items(chat).append({"kind": "permission", "request": json.dumps(message_id), "tool": tool,
                                      "state": "pending"})
            chat.changed()

    def _on_exit(self, code, stderr: str) -> None:
        with self._lock:
            for chat in self._chats.values():
                if chat.busy:
                    chat.busy = False
                    self._items(chat).append({"kind": "notice", "code": "exited",
                                              "text": (stderr.splitlines() or [f"exit {code}"])[-1][:TEXT_LIMIT]})
                    chat.changed()
                    self._save(chat)
            self._live = set()


def _write_json(path: Path, value) -> None:
    temp = path.with_name(path.name + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
    os.replace(temp, path)
