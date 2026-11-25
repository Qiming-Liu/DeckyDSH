"""The plugin's own settings: defaults for new dsh sessions."""
from __future__ import annotations

import json
import os
from pathlib import Path

import paths

# dsh permission presets a new session may start with. "auto" (model-reviewed
# actions) needs Harness's experimental Auto review and is offered later.
PERMISSIONS = ("workspace-write", "danger-full-access")
DEFAULTS = {"default_permission": "workspace-write", "workspace": str(paths.DEFAULT_WORKSPACE),
            "risk_accepted": False, "upload_session_log": False, "show_text_input": False}


def load(path: Path | None = None) -> dict:
    try:
        stored = json.loads((path or paths.SETTINGS_FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        stored = {}
    values = dict(DEFAULTS)
    if isinstance(stored, dict):
        values.update({key: stored[key] for key in DEFAULTS if key in stored})
    return values


def save(changes: dict, path: Path | None = None) -> dict:
    """Merge known keys, validate them, write atomically, and return the result."""
    values = load(path)
    for key, value in changes.items():
        if key not in DEFAULTS:
            raise ValueError(f"unknown setting {key}")
        values[key] = value
    if values["default_permission"] not in PERMISSIONS:
        raise ValueError("unknown permission preset")
    if values["default_permission"] == "danger-full-access" and not values["risk_accepted"]:
        raise ValueError("full access needs the risk confirmation")
    if not isinstance(values["workspace"], str) or not os.path.isabs(values["workspace"]):
        raise ValueError("workspace must be an absolute path")
    for key in ("risk_accepted", "upload_session_log", "show_text_input"):
        values[key] = bool(values[key])
    target = path or paths.SETTINGS_FILE
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_name(target.name + ".tmp")
    temp.write_text(json.dumps(values, indent=2) + "\n", encoding="utf-8")
    os.replace(temp, target)
    Path(values["workspace"]).mkdir(parents=True, exist_ok=True)
    return values
