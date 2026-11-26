"""Frees the downloaded runtime and speech recognition when the plugin is uninstalled.

Decky stops a plugin the same way for an uninstall and for installing over it (a
reinstall first uninstalls the old copy), and this plugin exits on SIGTERM before
Decky's _uninstall hook can run. So every stop leaves a small detached shell behind
that waits, then looks at the plugin folder: a reinstall has put it back by then, an
uninstall has not. Only then are the downloads deleted. The API key (DSH_HOME/.env),
settings and logs stay, so installing again needs no new key.
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

import paths

DELAY = 30
SHELL = "/bin/sh"
# $1 delay, $2 plugin folder, then the folders to delete.
SCRIPT = 'sleep "$1"; [ -e "$2" ] && exit 0; shift 2; rm -rf -- "$@"'


def command(plugin_dir: Path, targets: list[Path], delay: float = DELAY, shell: str = SHELL) -> list[str]:
    return [shell, "-c", SCRIPT, "uninstall-cleanup", str(delay), str(plugin_dir), *map(str, targets)]


def downloads() -> list[Path]:
    return [paths.RUNTIME_DIR, paths.VOICE_DIR]


def schedule(plugin_dir: Path = paths.PLUGIN_DIR, targets: list[Path] | None = None, delay: float = DELAY,
             shell: str = SHELL) -> bool:
    """Start the detached check. Never raises: stopping the plugin must not fail over this."""
    if not os.path.exists(shell):
        return False
    try:
        subprocess.Popen(command(plugin_dir, targets if targets is not None else downloads(), delay, shell),
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         start_new_session=True, close_fds=True)
    except OSError:
        return False
    return True
