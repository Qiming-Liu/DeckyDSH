from __future__ import annotations

import asyncio
import logging
import os
import signal
import sys

sys.path.append(os.path.join(os.path.dirname(__file__), "py_modules"))

import api_key  # noqa: E402
import chat  # noqa: E402
import decky  # noqa: E402
import installer  # noqa: E402
import key_handoff  # noqa: E402
import plugin_log  # noqa: E402
import runtime  # noqa: E402
import plugin_settings  # noqa: E402
import uninstall_cleanup  # noqa: E402
import voice  # noqa: E402

# Decky kills a plugin still running five seconds after asking it to stop.
UNLOAD_WAIT = 3.0
INSTALLER = installer.Installer()
CHAT = chat.ChatService()
VOICE_INSTALLER = voice.VoiceInstaller()
RECORDER = voice.Recorder()
LOG = plugin_log.PluginLog(decky.DECKY_PLUGIN_LOG_DIR, "DeckyDSH")
KEY_HANDOFF = key_handoff.KeyHandoff(on_saved=CHAT.restart)


async def _chat_call(function, *args) -> dict:
    """Run a chat request off the event loop; a refusal comes back as data, not an exception."""
    try:
        return {"ok": True, "value": await asyncio.to_thread(function, *args)}
    except chat.ChatError as error:
        decky.logger.warning("chat request failed (%s): %s", error.code, error)
        return {"ok": False, "error": error.code, "detail": str(error)[:300]}


async def _voice_call(function, *args) -> dict:
    """Run a voice request off the event loop; a refusal comes back as data, not an exception."""
    try:
        return {"ok": True, "value": await asyncio.to_thread(function, *args)}
    except voice.VoiceError as error:
        decky.logger.warning("voice request failed (%s): %s", error.code, error)
        return {"ok": False, "error": error.code, "detail": str(error)[:300]}


# Decky stops a plugin with SIGTERM and then closes its socket. Once the socket
# is closed, Decky's read loop in this process (decky-loader 3.3.1) spins
# without yielding, so neither Decky's own SIGTERM callback nor an await in
# _unload is guaranteed to run before the five-second kill. Stopping therefore
# never waits on the event loop: it runs on this thread, within that limit.
def _stop_background_work() -> None:
    KEY_HANDOFF.stop()
    CHAT.stop()
    RECORDER.cancel()
    # Both installs are told to stop first, so their waits overlap within UNLOAD_WAIT.
    INSTALLER.cancel()
    VOICE_INSTALLER.cancel()
    if not INSTALLER.close(UNLOAD_WAIT / 2):
        decky.logger.warning("DeckyDSH stopped while the runtime install was still stopping")
    if not VOICE_INSTALLER.close(UNLOAD_WAIT / 2):
        decky.logger.warning("DeckyDSH stopped while the speech recognition install was still stopping")
    # Deletes the runtime and speech recognition if this stop was an uninstall; see uninstall_cleanup.
    uninstall_cleanup.schedule()
    decky.logger.info("DeckyDSH unloaded")
    LOG.detach()


def _terminate(signum, frame):
    # A Python-level handler runs between bytecodes, even while the loop spins.
    _stop_background_work()
    logging.shutdown()
    os._exit(0)


class Plugin:
    """Decky's RPC surface. Each method is a thin call into py_modules."""

    async def get_status(self) -> dict:
        status = runtime.status()
        status["has_api_key"] = api_key.has_key()
        # Voice is the only input, so setup is not finished until speech recognition is in.
        speech = voice.status()
        status["voice_supported"] = speech["supported"]
        status["voice_installed"] = speech["installed"]
        status["voice_download_size"] = speech["download_size"]
        status["plugin_version"] = decky.DECKY_PLUGIN_VERSION
        return status

    async def start_install(self) -> dict:
        return INSTALLER.start()

    async def cancel_install(self) -> None:
        INSTALLER.cancel()

    async def get_install_state(self) -> dict:
        return INSTALLER.snapshot()

    async def check_api_key(self, key: str) -> str:
        return await asyncio.to_thread(api_key.check, key)

    async def save_api_key(self, key: str) -> bool:
        try:
            api_key.save(key)
        except ValueError:
            return False
        CHAT.restart()
        return True

    # The phone hand-off for the key step: start shows a QR code, the step polls state.
    async def key_handoff_start(self, language: str = "en") -> dict:
        return await asyncio.to_thread(KEY_HANDOFF.start, language)

    async def key_handoff_state(self) -> dict:
        return KEY_HANDOFF.snapshot()

    async def key_handoff_stop(self) -> None:
        KEY_HANDOFF.stop()

    async def get_settings(self) -> dict:
        return plugin_settings.load()

    async def save_settings(self, changes: dict) -> dict:
        values = plugin_settings.save(changes)
        CHAT.restart()
        return values

    async def chat_list(self) -> dict:
        return await _chat_call(CHAT.list)

    async def chat_new(self) -> dict:
        return await _chat_call(CHAT.new)

    async def chat_snapshot(self, session_id: str, version: int) -> dict:
        return await _chat_call(CHAT.snapshot, session_id, version)

    async def chat_prepare(self, session_id: str) -> dict:
        return await _chat_call(CHAT.prepare, session_id)

    async def chat_send(self, session_id: str, text: str, files: list | None = None) -> dict:
        return await _chat_call(CHAT.send, session_id, text, files)

    async def chat_update(self, session_id: str, changes: dict) -> dict:
        return await _chat_call(CHAT.update, session_id, changes)

    async def chat_delete(self, session_id: str) -> dict:
        return await _chat_call(CHAT.delete, session_id)

    async def chat_cancel(self, session_id: str) -> dict:
        return await _chat_call(CHAT.cancel, session_id)

    async def chat_answer(self, session_id: str, request_id: str, allow: bool) -> dict:
        return await _chat_call(CHAT.answer, session_id, request_id, allow)

    async def voice_status(self) -> dict:
        state = voice.status()
        state["recording"] = RECORDER.recording()
        return state

    async def voice_install_start(self) -> dict:
        return VOICE_INSTALLER.start()

    async def voice_install_cancel(self) -> None:
        VOICE_INSTALLER.cancel()

    async def voice_install_state(self) -> dict:
        return VOICE_INSTALLER.snapshot()

    async def voice_start(self) -> dict:
        return await _voice_call(RECORDER.start)

    async def voice_stop(self) -> dict:
        return await _voice_call(RECORDER.stop)

    async def voice_preview(self) -> dict:
        return await _voice_call(RECORDER.preview)

    async def voice_levels(self) -> list:
        return await asyncio.to_thread(RECORDER.levels)

    async def voice_cancel(self) -> None:
        await asyncio.to_thread(RECORDER.cancel)

    async def get_log(self, limit: int = 500) -> list:
        return await asyncio.to_thread(LOG.read, limit)

    async def clear_log(self) -> None:
        await asyncio.to_thread(LOG.clear)

    async def get_log_export_directory(self) -> str:
        return LOG.export_directory(decky.DECKY_USER_HOME)

    async def export_log(self, directory: str) -> str:
        return await asyncio.to_thread(LOG.export, decky.DECKY_USER_HOME, directory)

    async def _main(self):
        # Replaces Decky's event-loop SIGTERM callback; see _stop_background_work.
        signal.signal(signal.SIGTERM, _terminate)
        LOG.attach(decky.logger)
        decky.logger.info("DeckyDSH %s loaded", decky.DECKY_PLUGIN_VERSION)

    async def _unload(self):
        # Used when Decky stops the plugin before _main installed the handler.
        _stop_background_work()

    async def _uninstall(self):
        decky.logger.info("DeckyDSH uninstalled")
