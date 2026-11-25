"""Write runtime/manifest.json for the DeepSeek Harness version the submodule pins.

The runtime is the official `deepseek-harness-runtime-bin` wheel: one executable that
bundles the dsh CLI and its Node.js. The manifest pins each platform's wheel by URL,
size and SHA-256 so the plugin can verify what it downloads.
"""
from __future__ import annotations

import json
from pathlib import Path
import re
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
CLI_PACKAGE = ROOT / "dsh" / "apps" / "cli" / "package.json"
MANIFEST = ROOT / "runtime" / "manifest.json"
PYPI = "https://pypi.org/pypi/deepseek-harness-runtime-bin/{}/json"
# Wheel platform tag -> plugin platform key.
PLATFORMS = {"manylinux_2_28_x86_64": "linux-x64", "manylinux_2_28_aarch64": "linux-arm64"}


def pep440(version: str) -> str:
    """Translate an npm prerelease such as 0.2.2-rc.2 into PyPI's 0.2.2rc2."""
    match = re.fullmatch(r"(\d+\.\d+\.\d+)(?:-(alpha|beta|rc)\.(\d+))?", version)
    if not match:
        raise ValueError(f"Unsupported dsh version: {version}")
    base, kind, number = match.groups()
    return base + ({"alpha": "a", "beta": "b", "rc": "rc"}[kind] + number if kind else "")


def build(version: str, release: dict) -> dict:
    assets = {}
    for item in release["urls"]:
        name = item["filename"]
        for tag, key in PLATFORMS.items():
            if name.endswith(f"-{tag}.whl"):
                assets[key] = {"file": name, "url": item["url"], "size": item["size"],
                               "sha256": item["digests"]["sha256"]}
    missing = sorted(set(PLATFORMS.values()) - set(assets))
    if missing:
        raise ValueError(f"No runtime wheel for {', '.join(missing)} in {version}")
    # glibc 2.28 is what the manylinux_2_28 tag promises.
    return {"dsh": version, "glibc": "2.28", "assets": dict(sorted(assets.items()))}


def main() -> int:
    version = json.loads(CLI_PACKAGE.read_text(encoding="utf-8"))["version"]
    with urllib.request.urlopen(PYPI.format(pep440(version)), timeout=30) as response:
        release = json.load(response)
    MANIFEST.parent.mkdir(exist_ok=True)
    MANIFEST.write_text(json.dumps(build(version, release), indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {MANIFEST.relative_to(ROOT)} for dsh {version}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
