"""Stand-in for Decky Loader's `decky` module, which only exists inside a real Decky runtime.

It lets the tests import main.py and py_modules with every Decky folder in a temporary place.
"""
from __future__ import annotations

import logging
import os
import tempfile

_TMP = tempfile.mkdtemp(prefix="decky-dsh-test-")

DECKY_VERSION = "0.0.0-test"
DECKY_USER = "deck"
DECKY_USER_HOME = os.path.join(_TMP, "home")
DECKY_HOME = os.path.join(_TMP, "homebrew")
DECKY_PLUGIN_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DECKY_PLUGIN_NAME = "DeckyDSH"
DECKY_PLUGIN_VERSION = "0.0.0-test"
DECKY_PLUGIN_AUTHOR = "Qiming-Liu"
DECKY_PLUGIN_SETTINGS_DIR = os.path.join(_TMP, "settings")
DECKY_PLUGIN_RUNTIME_DIR = os.path.join(_TMP, "data")
DECKY_PLUGIN_LOG_DIR = os.path.join(_TMP, "logs")
DECKY_PLUGIN_LOG = os.path.join(DECKY_PLUGIN_LOG_DIR, "plugin.log")

for _dir in (DECKY_USER_HOME, DECKY_HOME, DECKY_PLUGIN_SETTINGS_DIR, DECKY_PLUGIN_RUNTIME_DIR, DECKY_PLUGIN_LOG_DIR):
    os.makedirs(_dir, exist_ok=True)

logger = logging.getLogger("decky-dsh-test")
logger.addHandler(logging.NullHandler())


def emit(event, *args):
    logger.debug("emit(%s, %s)", event, args)
