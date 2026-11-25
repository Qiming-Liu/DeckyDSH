import concurrent.futures
import json
import shutil
import tempfile
import unittest
from pathlib import Path

import api_key
import chat
import paths
import plugin_settings
import runtime

MANIFEST = runtime.load_manifest()


class FakeDsh:
    """Stands in for acp.AcpProcess; the test plays dsh's side."""

    instances: list["FakeDsh"] = []

    def __init__(self, argv, env, cwd, on_notification, on_request, on_exit):
        self.argv, self.env, self.cwd = argv, env, cwd
        self.notify_client, self.ask_client, self.exit_client = on_notification, on_request, on_exit
        self.requests: list[tuple[str, dict, concurrent.futures.Future]] = []
        self.notifications: list[tuple[str, dict]] = []
        self.responses: list[tuple[object, dict | None]] = []
        self.alive = True
        FakeDsh.instances.append(self)

    def initialize(self, timeout):
        return {"protocolVersion": 1}

    def request(self, method, params):
        future = concurrent.futures.Future()
        if method == "session/new":
            future.set_result({"sessionId": f"s{len(FakeDsh.instances)}"})
        elif method == "session/resume":
            future.set_result({"configOptions": []})
        self.requests.append((method, params, future))
        return future

    def notify(self, method, params):
        self.notifications.append((method, params))

    def respond(self, message_id, result=None, error=None):
        self.responses.append((message_id, result))

    def stop(self, timeout=1.0):
        self.alive = False

    def prompt(self):
        return next(future for method, _, future in reversed(self.requests) if method == "session/prompt")

    def update(self, session_id, **update):
        self.notify_client("session/update", {"sessionId": session_id, "update": update})


class ChatTest(unittest.TestCase):
    def setUp(self):
        shutil.rmtree(paths.DATA_DIR, ignore_errors=True)
        shutil.rmtree(paths.SETTINGS_FILE.parent, ignore_errors=True)
        root = paths.runtime_dir(MANIFEST["dsh"])
        root.mkdir(parents=True)
        for key in MANIFEST["assets"]:
            if key == runtime.platform_key():
                runtime.write_marker(root, MANIFEST["assets"][key]["sha256"], MANIFEST["dsh"])
        FakeDsh.instances = []
        self.chats_dir = Path(tempfile.mkdtemp())
        self.service = chat.ChatService(FakeDsh, self.chats_dir)

    def start_chat(self):
        return self.service.new()["id"]

    def test_reply_streams_into_one_message_and_is_saved(self):
        api_key.save("sk-test")
        session = self.start_chat()
        self.service.send(session, "why does my game crash?")
        dsh = FakeDsh.instances[-1]
        self.assertEqual(dsh.env[api_key.ENV_NAME], "sk-test")
        dsh.update(session, sessionUpdate="agent_message_chunk", messageId="m1", content={"type": "text", "text": "Shader "})
        dsh.update(session, sessionUpdate="agent_message_chunk", messageId="m1", content={"type": "text", "text": "cache."})
        dsh.update(session, sessionUpdate="tool_call", toolCallId="t1", title="bash", rawInput={"command": "ls ~"}, status="in_progress")
        dsh.update(session, sessionUpdate="tool_call_update", toolCallId="t1", status="completed",
                   content=[{"type": "content", "content": {"type": "text", "text": "Games"}}])
        self.assertTrue(self.service.snapshot(session)["busy"])
        dsh.prompt().set_result({"stopReason": "end_turn"})
        snapshot = self.service.snapshot(session)
        self.assertFalse(snapshot["busy"])
        self.assertEqual([item["kind"] for item in snapshot["items"]], ["user", "assistant", "tool"])
        self.assertEqual(snapshot["items"][1]["text"], "Shader cache.")
        self.assertEqual((snapshot["items"][2]["input"], snapshot["items"][2]["output"]), ("ls ~", "Games"))
        saved = json.loads((self.chats_dir / f"{session}.json").read_text(encoding="utf-8"))
        self.assertEqual(saved, snapshot["items"])
        self.assertEqual(self.service.list()[0]["title"], "why does my game crash?")

    def test_approval_is_answered_once_and_unanswered_ones_expire(self):
        session = self.start_chat()
        self.service.send(session, "clean up")
        dsh = FakeDsh.instances[-1]
        dsh.ask_client(7, "session/request_permission", {"sessionId": session, "toolCall": {"toolCallId": "t1"}})
        dsh.ask_client(8, "session/request_permission", {"sessionId": session, "toolCall": {"toolCallId": "t2"}})
        pending = [item for item in self.service.snapshot(session)["items"] if item["kind"] == "permission"]
        self.service.answer(session, pending[0]["request"], True)
        self.assertEqual(dsh.responses, [(7, {"outcome": {"outcome": "selected", "optionId": "allow-once"}})])
        with self.assertRaises(chat.ChatError):
            self.service.answer(session, pending[0]["request"], False)
        dsh.prompt().set_result({"stopReason": "cancelled"})
        items = self.service.snapshot(session)["items"]
        self.assertEqual([i["state"] for i in items if i["kind"] == "permission"], ["allowed", "cancelled"])
        self.assertEqual(items[-1], {"kind": "notice", "code": "cancelled", "text": ""})

    def test_dsh_exit_ends_the_running_turn(self):
        session = self.start_chat()
        self.service.send(session, "hello")
        FakeDsh.instances[-1].exit_client(1, "fatal: out of memory")
        snapshot = self.service.snapshot(session)
        self.assertFalse(snapshot["busy"])
        self.assertEqual(snapshot["items"][-1]["code"], "exited")
        self.assertEqual(snapshot["items"][-1]["text"], "fatal: out of memory")

    def test_a_chat_from_an_earlier_run_is_resumed_before_sending(self):
        session = self.start_chat()
        reopened = chat.ChatService(FakeDsh, self.chats_dir)
        reopened.send(session, "continue")
        methods = [method for method, _, _ in FakeDsh.instances[-1].requests]
        self.assertEqual(methods, ["session/resume", "session/prompt"])

    def test_a_second_message_waits_for_the_first(self):
        session = self.start_chat()
        self.service.send(session, "one")
        with self.assertRaises(chat.ChatError) as raised:
            self.service.send(session, "two")
        self.assertEqual(raised.exception.code, "busy")

    def test_rename_star_archive_and_delete_stay_in_the_plugin(self):
        session = self.start_chat()
        self.service.update(session, {"title": "  Battery tips ", "starred": True})
        self.service.update(session, {"archived": True})
        meta = self.service.list()[0]
        self.assertEqual((meta["title"], meta["starred"], meta["archived"]), ("Battery tips", True, True))
        with self.assertRaises(chat.ChatError):
            self.service.update(session, {"cwd": "/"})
        self.service.delete(session)
        self.assertEqual(self.service.list(), [])
        self.assertFalse((self.chats_dir / f"{session}.json").exists())
        self.assertEqual(FakeDsh.instances[-1].requests[-1][0], "session/close")

    def test_stop_ends_dsh_when_the_turn_left_background_jobs(self):
        session = self.start_chat()
        self.service.send(session, "sleep in the background")
        dsh = FakeDsh.instances[-1]
        dsh.update(session, sessionUpdate="tool_call", toolCallId="t1", title="bash",
                   rawInput={"command": "sleep 90", "run_in_background": True})
        self.service.cancel(session)
        self.assertEqual(dsh.notifications, [("session/cancel", {"sessionId": session})])
        dsh.prompt().set_result({"stopReason": "cancelled"})
        for thread in [t for t in __import__("threading").enumerate() if t.name == "dsh-restart"]:
            thread.join(2)
        self.assertFalse(dsh.alive)

    def test_attached_files_go_to_dsh_as_links(self):
        session = self.start_chat()
        self.service.send(session, "", ["/home/deck/notes.txt"])
        prompt = next(params for method, params, _ in FakeDsh.instances[-1].requests if method == "session/prompt")["prompt"]
        self.assertEqual(prompt, [{"type": "resource_link", "uri": "file:///home/deck/notes.txt", "name": "notes.txt"}])
        self.assertEqual(self.service.list()[0]["title"], "notes.txt")

    def test_profile_patch_carries_the_approval_default_and_never_uploads_logs(self):
        values = dict(plugin_settings.DEFAULTS, default_permission="danger-full-access")
        patch = chat.profile_patch(values)
        self.assertIn("defaultPreset: danger-full-access", patch)
        self.assertIn("danger-full-access: {sandbox: danger-full-access, approval: never}", patch)
        self.assertIn("- id: session-log-deepseek\n  disabled: true", patch)


if __name__ == "__main__":
    unittest.main()
