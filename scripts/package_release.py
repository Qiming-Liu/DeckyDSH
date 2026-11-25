"""Package the built plugin as a ZIP for Decky's "Install Plugin from ZIP".

Run `pnpm run build` first. The dsh runtime is not packaged: the plugin downloads
the version runtime/manifest.json pins on first use.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import shutil
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
NAME = "DeckyDSH"


def stage(destination: Path) -> None:
    destination.mkdir()
    for name in ("package.json", "main.py", "README.md"):
        shutil.copy2(ROOT / name, destination / name)
    # The development tree keeps Decky's "debug" flag for live reload; releases drop it.
    metadata = json.loads((ROOT / "plugin.json").read_text(encoding="utf-8"))
    metadata["flags"] = [flag for flag in metadata.get("flags", []) if flag != "debug"]
    (destination / "plugin.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    shutil.copytree(ROOT / "py_modules", destination / "py_modules",
                    ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    (destination / "runtime").mkdir()
    shutil.copy2(ROOT / "runtime" / "manifest.json", destination / "runtime" / "manifest.json")
    (destination / "dist").mkdir()
    shutil.copy2(ROOT / "dist" / "index.js", destination / "dist" / "index.js")
    # The downloaded runtime is DeepSeek Harness; ship its license with the plugin.
    (destination / "dsh").mkdir()
    shutil.copy2(ROOT / "dsh" / "LICENSE", destination / "dsh" / "LICENSE")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=ROOT / "out" / f"{NAME}.zip")
    output = parser.parse_args().output.resolve()
    if not (ROOT / "dist" / "index.js").is_file():
        print("dist/index.js is missing; run pnpm run build first", file=sys.stderr)
        return 1
    with tempfile.TemporaryDirectory() as temp:
        staged = Path(temp) / NAME
        stage(staged)
        output.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(staged.rglob("*")):
                archive.write(path, path.relative_to(staged.parent).as_posix())
    print(f"Wrote {output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
