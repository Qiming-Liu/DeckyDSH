"""The dsh runtime the plugin downloads: which one fits this machine and whether it is installed."""
from __future__ import annotations

import json
import os
import platform
from pathlib import Path

import paths

# platform.machine() values -> the manifest's platform keys.
MACHINES = {"x86_64": "linux-x64", "amd64": "linux-x64", "aarch64": "linux-arm64", "arm64": "linux-arm64"}
INSTALLED_MARKER = "installed.json"
# Inside the wheel, everything the executable needs sits under this folder.
WHEEL_RUNTIME_PREFIX = "deepseek_harness_runtime/runtime/"


def load_manifest(path: Path = paths.MANIFEST) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def platform_key(machine: str | None = None) -> str | None:
    return MACHINES.get((machine if machine is not None else platform.machine()).lower())


def executable_name(key: str) -> str:
    return f"deepseek-harness-sdk-runtime-{key}"


def executable(version: str, key: str, root: Path | None = None) -> Path:
    return (root or paths.runtime_dir(version)) / executable_name(key)


def glibc_version() -> tuple[int, ...] | None:
    """The running glibc as (major, minor), or None where it cannot be read (musl, not Linux)."""
    try:
        text = os.confstr("CS_GNU_LIBC_VERSION")  # "glibc 2.39"
    except (AttributeError, ValueError, OSError):
        return None
    return parse_version(text.split()[-1]) if text else None


def parse_version(text: str) -> tuple[int, ...] | None:
    try:
        return tuple(int(part) for part in text.split("."))
    except ValueError:
        return None


def status(manifest: dict | None = None, machine: str | None = None,
           glibc: tuple[int, ...] | None = None, root: Path | None = None) -> dict:
    """What the frontend needs to decide between the installer and the chat panel."""
    manifest = manifest if manifest is not None else load_manifest()
    key = platform_key(machine)
    asset = manifest["assets"].get(key) if key else None
    found = glibc if glibc is not None else glibc_version()
    required = parse_version(manifest["glibc"])
    reason = None
    if asset is None:
        reason = "unsupported_cpu"
    elif found is None or (required is not None and found < required):
        reason = "old_glibc"
    installed = asset is not None and is_installed(manifest["dsh"], asset["sha256"], root)
    return {
        "dsh": manifest["dsh"],
        "platform": key or (machine if machine is not None else platform.machine()),
        "supported": reason is None,
        "reason": reason,
        "glibc": ".".join(map(str, found)) if found else None,
        "required_glibc": manifest["glibc"],
        "download_size": asset["size"] if asset else None,
        "installed": installed,
    }


def read_marker(version: str, root: Path | None = None) -> dict | None:
    try:
        data = json.loads(((root or paths.runtime_dir(version)) / INSTALLED_MARKER).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def is_installed(version: str, sha256: str, root: Path | None = None) -> bool:
    """True only when the install of this exact wheel finished; a half-done one has no marker."""
    marker = read_marker(version, root)
    return marker is not None and marker.get("sha256") == sha256


def write_marker(root: Path, sha256: str, reported: str) -> None:
    """Written last, after the runtime ran once, so its presence means the install is complete."""
    temp = root / (INSTALLED_MARKER + ".tmp")
    temp.write_text(json.dumps({"sha256": sha256, "version": reported}) + "\n", encoding="utf-8")
    os.replace(temp, root / INSTALLED_MARKER)
