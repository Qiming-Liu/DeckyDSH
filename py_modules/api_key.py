"""The DeepSeek API key dsh uses, kept in DSH_HOME/.env (mode 600). Never logged."""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path

import net
import paths

ENV_NAME = "DEEPSEEK_API_KEY"
# Listing models needs a valid key and costs nothing.
CHECK_URL = "https://api.deepseek.com/models"
TIMEOUT = 15


def env_file() -> Path:
    return paths.DSH_HOME / ".env"


def clean(key: str) -> str:
    key = key.strip()
    if not key or len(key) > 256 or any(ch.isspace() or ord(ch) < 33 or ch in "\"'#$`\\" for ch in key):
        raise ValueError("invalid key")
    return key


def check(key: str, opener=net.open_url) -> str:
    """'ok', 'invalid' (the API refused it) or 'network' (couldn't ask)."""
    try:
        key = clean(key)
    except ValueError:
        return "invalid"
    request = urllib.request.Request(CHECK_URL, headers={"Authorization": f"Bearer {key}", "User-Agent": "DeckyDSH"})
    try:
        with opener(request, timeout=TIMEOUT) as response:
            data = json.load(response)
        return "ok" if isinstance(data, dict) and isinstance(data.get("data"), list) else "network"
    except urllib.error.HTTPError as error:
        return "invalid" if error.code in (401, 403) else "network"
    except (urllib.error.URLError, TimeoutError, ConnectionError, OSError, ValueError):
        return "network"


def read() -> str | None:
    for line in _read_lines() or []:
        if line.startswith(ENV_NAME + "="):
            return line[len(ENV_NAME) + 1:] or None
    return None


def has_key() -> bool:
    return read() is not None


def save(key: str) -> None:
    """Replace only our line in the .env, keep any others, and write it readable by its owner alone."""
    key = clean(key)
    lines = [line for line in (_read_lines() or []) if not line.startswith(ENV_NAME + "=")]
    lines.append(f"{ENV_NAME}={key}")
    path = env_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(".env.tmp")
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as out:
        out.write("\n".join(lines) + "\n")
    os.chmod(temp, 0o600)
    os.replace(temp, path)


def _read_lines() -> list[str] | None:
    try:
        return env_file().read_text(encoding="utf-8").splitlines()
    except OSError:
        return None
