"""Download, verify and unpack the pinned dsh runtime, one install at a time.

The install runs on a worker thread and reports its progress through snapshot().
Nothing counts as installed until the runtime has run once and its marker is
written (see runtime.write_marker), so an interrupted install is simply redone.
"""
from __future__ import annotations

import hashlib
import os
import shutil
import stat
import subprocess
import threading
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

import net
import paths
import runtime

CHUNK = 1 << 20
# The unpacked executable is about twice the wheel; keep room for both plus dsh's data.
SPACE_FACTOR = 3
NETWORK_TIMEOUT = 30
SMOKE_TIMEOUT = 120


class InstallError(Exception):
    """A failed install. `code` is what the frontend translates."""

    def __init__(self, code: str, detail: str = ""):
        super().__init__(detail or code)
        self.code = code


class Cancelled(Exception):
    pass


def dsh_environment() -> dict:
    """The environment every dsh the plugin starts runs with."""
    env = {key: value for key, value in os.environ.items() if key in ("PATH", "LANG", "LC_ALL", "TZ")}
    env.update({"HOME": str(paths.USER_HOME), "DSH_HOME": str(paths.DSH_HOME)})
    return env


class Installer:
    # Names the install in the log.
    LABEL = "dsh runtime"
    THREAD = "dsh-install"

    def __init__(self, manifest: dict | None = None, platform: str | None = None,
                 opener=net.open_url, smoke=None):
        self._manifest = manifest
        self._platform = platform
        self._open = opener
        self._smoke = smoke or smoke_test
        self._lock = threading.Lock()
        self._cancel = threading.Event()
        self._thread: threading.Thread | None = None
        self._state = {"phase": "idle", "done": 0, "total": 0, "error": None}

    def snapshot(self) -> dict:
        with self._lock:
            return dict(self._state)

    def _set(self, **changes) -> None:
        with self._lock:
            self._state.update(changes)

    def start(self) -> dict:
        with self._lock:
            if self._thread and self._thread.is_alive():
                return dict(self._state)
            self._cancel.clear()
            self._state = {"phase": "downloading", "done": 0, "total": 0, "error": None}
            self._thread = threading.Thread(target=self._run, name=self.THREAD, daemon=True)
            self._thread.start()
            return dict(self._state)

    def cancel(self) -> None:
        self._cancel.set()

    def close(self, timeout: float) -> bool:
        """Stop a running install; True when the worker ended within `timeout` seconds."""
        self._cancel.set()
        thread = self._thread
        if thread:
            thread.join(timeout)
            return not thread.is_alive()
        return True

    def run(self) -> None:
        """Install synchronously (the worker body; tests call it directly)."""
        self._run()

    def _run(self) -> None:
        try:
            self._install()
            self._set(phase="done")
        except Cancelled:
            self._set(phase="cancelled")
        except InstallError as error:
            import decky
            decky.logger.warning("%s install failed (%s): %s", self.LABEL, error.code, error)
            self._set(phase="error", error=error.code)
        except Exception:  # noqa: BLE001  Any surprise must end the install, not the plugin.
            import decky
            decky.logger.exception("%s install failed", self.LABEL)
            self._set(phase="error", error="unexpected")

    def _install(self) -> None:
        manifest = self._manifest or runtime.load_manifest()
        key = self._platform or runtime.platform_key()
        asset = manifest["assets"].get(key or "")
        if asset is None:
            raise InstallError("unsupported_cpu")
        version = manifest["dsh"]
        paths.DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
        if shutil.disk_usage(paths.DOWNLOAD_DIR).free < asset["size"] * SPACE_FACTOR:
            raise InstallError("disk_space")
        wheel = self._download(asset)
        self._set(phase="verifying")
        if sha256_of(wheel, self._cancel) != asset["sha256"]:
            wheel.unlink(missing_ok=True)
            raise InstallError("checksum")
        self._set(phase="unpacking")
        staged = unpack(wheel, paths.STAGING_DIR, self._cancel)
        self._set(phase="testing")
        reported = self._smoke(runtime.executable(version, key, staged))
        final = paths.runtime_dir(version)
        shutil.rmtree(final, ignore_errors=True)
        os.replace(staged, final)
        runtime.write_marker(final, asset["sha256"], reported)
        wheel.unlink(missing_ok=True)
        remove_other_versions(version)

    def _download(self, asset: dict) -> Path:
        """Fetch the wheel into DOWNLOAD_DIR, continuing a partial file where the server allows it."""
        self._set(done=0, total=asset["size"])
        return download([asset["url"]], paths.DOWNLOAD_DIR / asset["file"], asset["size"], self._open,
                        self._cancel, lambda done: self._set(done=done))


def download(urls: list[str], target: Path, size: int, opener, cancel: threading.Event, progress) -> Path:
    """Fetch `size` bytes into `target`, trying each URL in turn and continuing a partial file
    where the server allows it. `progress(bytes_so_far)` follows the download."""
    if target.is_file() and target.stat().st_size == size:
        progress(size)
        return target
    error = InstallError("network", "no download source")
    for url in urls:
        try:
            _download_from(url, target, size, opener, cancel, progress)
            return target
        except InstallError as failed:
            if failed.code != "network":
                raise
            error = failed
    raise error


def _download_from(url: str, target: Path, size: int, opener, cancel: threading.Event, progress) -> None:
    part = target.with_name(target.name + ".part")
    offset = part.stat().st_size if part.is_file() else 0
    if offset >= size:
        part.unlink()
        offset = 0
    request = urllib.request.Request(url, headers={"User-Agent": "DeckyDSH"})
    if offset:
        request.add_header("Range", f"bytes={offset}-")
    try:
        with opener(request, timeout=NETWORK_TIMEOUT) as response:
            if offset and getattr(response, "status", 200) != 206:
                offset = 0  # The server ignored the range: start over.
            progress(offset)
            with open(part, "ab" if offset else "wb") as out:
                while chunk := response.read(CHUNK):
                    if cancel.is_set():
                        raise Cancelled()
                    out.write(chunk)
                    offset += len(chunk)
                    progress(offset)
    except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
        raise InstallError("network", str(error)) from error
    except OSError as error:
        raise InstallError("disk_space" if error.errno == 28 else "network", str(error)) from error
    if offset != size:
        raise InstallError("network", "incomplete download")
    os.replace(part, target)


def sha256_of(path: Path, cancel: threading.Event) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as file:
        while chunk := file.read(CHUNK):
            if cancel.is_set():
                raise Cancelled()
            digest.update(chunk)
    return digest.hexdigest()


def unpack(wheel: Path, staging: Path, cancel: threading.Event) -> Path:
    """Extract the wheel's runtime folder into a fresh staging folder, keeping file modes."""
    shutil.rmtree(staging, ignore_errors=True)
    staging.mkdir(parents=True)
    try:
        with zipfile.ZipFile(wheel) as archive:
            members = [m for m in archive.infolist()
                       if m.filename.startswith(runtime.WHEEL_RUNTIME_PREFIX) and not m.is_dir()]
            if not members:
                raise InstallError("extract", "no runtime in wheel")
            for member in members:
                if cancel.is_set():
                    raise Cancelled()
                relative = member.filename[len(runtime.WHEEL_RUNTIME_PREFIX):]
                parts = Path(relative).parts
                if not parts or ".." in parts or Path(relative).is_absolute():
                    raise InstallError("extract", f"unsafe path {member.filename}")
                destination = staging.joinpath(*parts)
                destination.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(member) as source, open(destination, "wb") as out:
                    shutil.copyfileobj(source, out, CHUNK)
                mode = (member.external_attr >> 16) & 0o777
                os.chmod(destination, mode or stat.S_IRUSR | stat.S_IWUSR | stat.S_IRGRP | stat.S_IROTH)
    except zipfile.BadZipFile as error:
        raise InstallError("extract", str(error)) from error
    except OSError as error:
        raise InstallError("disk_space" if error.errno == 28 else "extract", str(error)) from error
    return staging


def smoke_test(executable: Path) -> str:
    """Run `dsh --version` once; a runtime that cannot start is not installed."""
    paths.DSH_HOME.mkdir(parents=True, exist_ok=True)
    try:
        result = subprocess.run([str(executable), "--version"], env=dsh_environment(), cwd=paths.USER_HOME,
                                capture_output=True, text=True, timeout=SMOKE_TIMEOUT)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise InstallError("smoke", str(error)) from error
    if result.returncode != 0:
        raise InstallError("smoke", (result.stderr or result.stdout).strip()[-400:])
    return result.stdout.strip().splitlines()[-1] if result.stdout.strip() else ""


def remove_other_versions(keep: str) -> None:
    """Old runtimes are about 190 MB each; only the pinned one is ever started."""
    for child in paths.RUNTIME_DIR.iterdir():
        if child.is_dir() and child.name not in (keep, paths.DOWNLOAD_DIR.name, paths.STAGING_DIR.name):
            shutil.rmtree(child, ignore_errors=True)
