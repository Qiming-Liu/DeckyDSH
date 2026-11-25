"""Where the plugin keeps the dsh runtime, dsh's own data and the agent's workspace."""
from __future__ import annotations

from pathlib import Path

import decky

PLUGIN_DIR = Path(decky.DECKY_PLUGIN_DIR)
MANIFEST = PLUGIN_DIR / "runtime" / "manifest.json"
SETTINGS_FILE = Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / "settings.json"
USER_HOME = Path(decky.DECKY_USER_HOME)
# ~/homebrew/data/DeckyDSH: owned by the user Decky runs the plugin as.
DATA_DIR = Path(decky.DECKY_PLUGIN_RUNTIME_DIR)
RUNTIME_DIR = DATA_DIR / "runtime"
# Partial downloads and half-unpacked runtimes; never read as an installed runtime.
DOWNLOAD_DIR = RUNTIME_DIR / ".download"
STAGING_DIR = RUNTIME_DIR / ".staging"
# DSH_HOME for every dsh the plugin starts, separate from the user's own ~/.dsh.
DSH_HOME = DATA_DIR / "dsh"
DEFAULT_WORKSPACE = USER_HOME / "DeckyDSH"
# The default before 0.9.1; a stored copy of it follows the new default.
OLD_DEFAULT_WORKSPACE = USER_HOME / "DeckyDSH-workspace"
# Speech recognition: the pinned sherpa-onnx engine, the SenseVoice model and recordings.
VOICE_MANIFEST = PLUGIN_DIR / "runtime" / "voice.json"
VOICE_DIR = DATA_DIR / "voice"


def runtime_dir(version: str) -> Path:
    return RUNTIME_DIR / version
