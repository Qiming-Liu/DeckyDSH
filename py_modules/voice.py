"""Push-to-talk speech recognition, entirely on this machine.

PipeWire's `pw-record` captures the microphone to a 16 kHz mono WAV; the pinned
sherpa-onnx `vad-with-offline-asr` program cuts it into speech segments with
Silero VAD and transcribes each with SenseVoiceSmall (int8). The engine and the
model are downloaded on request, checked against runtime/voice.json, and kept
until the plugin is uninstalled. Nothing is uploaded: a recording lives only
until it is transcribed.
"""
from __future__ import annotations

import array
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tarfile
import threading
import wave
from pathlib import Path

import installer
import net
import paths
import runtime
from installer import Cancelled, InstallError

SAMPLE_RATE = 16000
# A recording stops by itself after this long; the frontend shows the same limit.
MAX_SECONDS = 120
STOP_TIMEOUT = 3
# The recording bar's waveform: one bar per tenth of a second.
LEVEL_BARS = 24
TRANSCRIBE_TIMEOUT = 90
SMOKE_TIMEOUT = 60
THREADS = 2
MARKER = "installed.json"
# One line per speech segment on stdout: "0.742 -- 5.568: text".
SEGMENT = re.compile(r"^\s*\d+(?:\.\d+)?\s+--\s+\d+(?:\.\d+)?:\s?(.*)$")
# Scripts written without spaces between words.
_CJK = re.compile(r"[　-ヿ㐀-鿿가-힯豈-﫿＀-￯]")


class VoiceError(Exception):
    """A refused or failed voice request. `code` is what the frontend translates."""

    def __init__(self, code: str, detail: str = ""):
        super().__init__(detail or code)
        self.code = code


def load_manifest(path: Path | None = None) -> dict:
    return json.loads((path or paths.VOICE_MANIFEST).read_text(encoding="utf-8"))


def engine_dir(manifest: dict) -> Path:
    return paths.VOICE_DIR / f"engine-{manifest['engine']}"


def models_dir() -> Path:
    return paths.VOICE_DIR / "models"


def binary(manifest: dict) -> Path:
    return engine_dir(manifest) / "bin" / manifest["binary"]


def fingerprint(manifest: dict, key: str) -> str:
    """Changes whenever any pinned file for this machine changes, so an old install is redone."""
    pins = [manifest["engine"], manifest["binary"], manifest["assets"][key]["sha256"],
            *(manifest["models"][name]["sha256"] for name in sorted(manifest["models"]))]
    return hashlib.sha256("\n".join(pins).encode()).hexdigest()


def is_installed(manifest: dict, key: str | None) -> bool:
    if not key or key not in manifest["assets"]:
        return False
    try:
        marker = json.loads((paths.VOICE_DIR / MARKER).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    return isinstance(marker, dict) and marker.get("fingerprint") == fingerprint(manifest, key)


def status(manifest: dict | None = None, machine: str | None = None) -> dict:
    manifest = manifest if manifest is not None else load_manifest()
    key = runtime.platform_key(machine)
    asset = manifest["assets"].get(key or "")
    return {
        "supported": asset is not None,
        "installed": is_installed(manifest, key),
        "download_size": asset["size"] + sum(model["size"] for model in manifest["models"].values()) if asset else None,
    }


def model_args(manifest: dict) -> list[str]:
    files = {name: str(models_dir() / model["file"]) for name, model in manifest["models"].items()}
    return [f"--silero-vad-model={files['vad']}", f"--tokens={files['tokens']}",
            f"--sense-voice-model={files['model']}", "--sense-voice-use-itn=1", f"--num-threads={THREADS}"]


def environment() -> dict:
    """What pw-record and the engine need; nothing from Decky's own process leaks in."""
    env = {key: value for key, value in os.environ.items() if key in ("PATH", "LANG", "LC_ALL", "HOME")}
    env.setdefault("PATH", "/usr/local/bin:/usr/bin:/bin")
    # Decky starts plugins without a session environment; PipeWire's socket lives here.
    runtime_dir = os.environ.get("XDG_RUNTIME_DIR")
    if not runtime_dir and hasattr(os, "getuid"):
        runtime_dir = f"/run/user/{os.getuid()}"
    if runtime_dir:
        env["XDG_RUNTIME_DIR"] = runtime_dir
    return env


def join_segments(segments: list[str]) -> str:
    text = ""
    for segment in (part.strip() for part in segments):
        if not segment:
            continue
        if text and not (_CJK.match(segment[0]) or _CJK.match(text[-1])):
            text += " "
        text += segment
    return text


def parse_output(stdout: str) -> str:
    return join_segments([match.group(1) for line in stdout.splitlines() if (match := SEGMENT.match(line))])


def transcribe(manifest: dict, wav: Path, run=subprocess.run, timeout: float = TRANSCRIBE_TIMEOUT) -> str:
    try:
        result = run([str(binary(manifest)), *model_args(manifest), str(wav)], env=environment(),
                     cwd=paths.VOICE_DIR, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as error:
        raise VoiceError("transcribe", "speech recognition timed out") from error
    except OSError as error:
        raise VoiceError("transcribe", str(error)) from error
    if result.returncode != 0:
        raise VoiceError("transcribe", (result.stderr or result.stdout).strip()[-300:])
    return parse_output(result.stdout)


def write_silence(path: Path, seconds: float = 1.0) -> None:
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(SAMPLE_RATE)
        out.writeframes(bytes(int(SAMPLE_RATE * seconds) * 2))


def copy_recorded(source: Path, target: Path, minimum_seconds: float = 0.3) -> bool:
    """Copy the samples pw-record has written so far into a complete WAV.

    While recording, the header's sizes are not final yet, so the samples are
    taken from after the "data" chunk header and given a fresh header.
    """
    try:
        data = source.read_bytes()
    except OSError:
        return False
    start = data.find(b"data", 12)
    if start < 0:
        return False
    samples = data[start + 8:]
    samples = samples[:len(samples) - len(samples) % 2]
    if len(samples) < SAMPLE_RATE * 2 * minimum_seconds:
        return False
    with wave.open(str(target), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(SAMPLE_RATE)
        out.writeframes(samples)
    return True


def smoke_test(manifest: dict) -> None:
    """Load the model once on a second of silence; an engine that cannot do that is not installed."""
    sample = paths.VOICE_DIR / "smoke.wav"
    write_silence(sample)
    try:
        transcribe(manifest, sample, timeout=SMOKE_TIMEOUT)
    except VoiceError as error:
        raise InstallError("smoke", str(error)) from error
    finally:
        sample.unlink(missing_ok=True)


def unpack_engine(archive: Path, manifest: dict, staging: Path, cancel: threading.Event) -> Path:
    """Take only the recognizer program and the ONNX Runtime it links from the release archive."""
    shutil.rmtree(staging, ignore_errors=True)
    staging.mkdir(parents=True)
    wanted = {f"bin/{manifest['binary']}": 0o755, "lib/libonnxruntime.so": 0o644}
    found = set()
    try:
        with tarfile.open(archive, "r:bz2") as tar:
            for member in tar:
                if cancel.is_set():
                    raise Cancelled()
                parts = Path(member.name).parts
                relative = "/".join(parts[1:])
                if relative not in wanted or not member.isfile():
                    continue
                destination = staging / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                source = tar.extractfile(member)
                if source is None:
                    continue
                with source, open(destination, "wb") as out:
                    shutil.copyfileobj(source, out, installer.CHUNK)
                os.chmod(destination, wanted[relative])
                found.add(relative)
    except tarfile.TarError as error:
        raise InstallError("extract", str(error)) from error
    except OSError as error:
        raise InstallError("disk_space" if error.errno == 28 else "extract", str(error)) from error
    missing = set(wanted) - found
    if missing:
        raise InstallError("extract", f"missing {', '.join(sorted(missing))}")
    return staging


class VoiceInstaller(installer.Installer):
    """Downloads the engine and the model with the same progress and cancel contract as the runtime."""

    LABEL = "speech recognition"
    THREAD = "voice-install"

    def __init__(self, manifest: dict | None = None, platform: str | None = None,
                 opener=None, smoke=None):
        super().__init__(manifest, platform, opener or net.open_url, smoke or smoke_test)

    def _install(self) -> None:
        manifest = self._manifest or load_manifest()
        key = self._platform or runtime.platform_key()
        asset = manifest["assets"].get(key or "")
        if asset is None:
            raise InstallError("unsupported_cpu")
        files = [asset, *manifest["models"].values()]
        total = sum(item["size"] for item in files)
        downloads = paths.VOICE_DIR / ".download"
        downloads.mkdir(parents=True, exist_ok=True)
        if shutil.disk_usage(downloads).free < total * 2:
            raise InstallError("disk_space")
        (paths.VOICE_DIR / MARKER).unlink(missing_ok=True)
        fetched = {}
        before = 0
        for item in files:
            self._set(phase="downloading", done=before, total=total)
            base = before
            fetched[item["file"]] = installer.download(
                item["urls"], downloads / item["file"], item["size"], self._open, self._cancel,
                lambda done, base=base: self._set(done=base + done))
            before += item["size"]
        self._set(phase="verifying")
        for item in files:
            if installer.sha256_of(fetched[item["file"]], self._cancel) != item["sha256"]:
                fetched[item["file"]].unlink(missing_ok=True)
                raise InstallError("checksum")
        self._set(phase="unpacking")
        staged = unpack_engine(fetched[asset["file"]], manifest, paths.VOICE_DIR / ".staging", self._cancel)
        final = engine_dir(manifest)
        shutil.rmtree(final, ignore_errors=True)
        os.replace(staged, final)
        models_dir().mkdir(parents=True, exist_ok=True)
        for model in manifest["models"].values():
            os.replace(fetched[model["file"]], models_dir() / model["file"])
        self._set(phase="testing")
        self._smoke(manifest)
        marker = paths.VOICE_DIR / (MARKER + ".tmp")
        marker.write_text(json.dumps({"fingerprint": fingerprint(manifest, key)}) + "\n", encoding="utf-8")
        os.replace(marker, paths.VOICE_DIR / MARKER)
        shutil.rmtree(downloads, ignore_errors=True)
        for child in paths.VOICE_DIR.iterdir():
            if child.is_dir() and child.name.startswith("engine-") and child != final:
                shutil.rmtree(child, ignore_errors=True)


class Recorder:
    """One microphone recording at a time: start, then stop (transcribe) or cancel."""

    def __init__(self, manifest: dict | None = None, popen=subprocess.Popen, run=subprocess.run,
                 which=shutil.which, platform: str | None = None):
        self._manifest = manifest
        self._popen = popen
        self._run = run
        self._which = which
        self._platform = platform
        self._lock = threading.Lock()
        self._process: subprocess.Popen | None = None
        self._timer: threading.Timer | None = None

    @property
    def wav(self) -> Path:
        return paths.VOICE_DIR / "recording.wav"

    def manifest(self) -> dict:
        if self._manifest is None:
            self._manifest = load_manifest()
        return self._manifest

    def recording(self) -> bool:
        with self._lock:
            return self._process is not None

    def start(self) -> None:
        manifest = self.manifest()
        if not is_installed(manifest, self._platform or runtime.platform_key()):
            raise VoiceError("not_installed")
        env = environment()
        recorder = self._which("pw-record", path=env["PATH"])
        if not recorder:
            raise VoiceError("no_recorder", "pw-record was not found")
        with self._lock:
            if self._process is not None:
                return
            paths.VOICE_DIR.mkdir(parents=True, exist_ok=True)
            self.wav.unlink(missing_ok=True)
            try:
                self._process = self._popen(
                    [recorder, "--rate", str(SAMPLE_RATE), "--channels", "1", "--format", "s16", str(self.wav)],
                    env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                    start_new_session=True)
            except OSError as error:
                raise VoiceError("record", str(error)) from error
            self._timer = threading.Timer(MAX_SECONDS, self._end_recording)
            self._timer.daemon = True
            self._timer.start()

    def _end_recording(self) -> None:
        """Ask pw-record to finish: SIGINT makes it write the WAV header's final sizes."""
        with self._lock:
            process = self._process
        if process is not None and process.poll() is None:
            process.send_signal(signal.SIGINT)

    def _take(self) -> subprocess.Popen | None:
        with self._lock:
            process, self._process = self._process, None
            if self._timer:
                self._timer.cancel()
                self._timer = None
        return process

    def stop(self) -> str:
        """End the recording and return what was said ("" for silence)."""
        process = self._take()
        if process is None:
            raise VoiceError("not_recording")
        try:
            if process.poll() is None:
                process.send_signal(signal.SIGINT)
            try:
                _, stderr = process.communicate(timeout=STOP_TIMEOUT)
            except subprocess.TimeoutExpired:
                process.kill()
                _, stderr = process.communicate()
            if not self._has_audio():
                detail = stderr.decode(errors="replace").strip()[-300:] if isinstance(stderr, bytes) else str(stderr or "")
                raise VoiceError("record", detail or "no audio was recorded")
            return transcribe(self.manifest(), self.wav, self._run)
        finally:
            self.wav.unlink(missing_ok=True)

    def preview(self) -> str:
        """What has been said so far, while still recording ("" before any speech).

        SenseVoice is not a streaming model, so this transcribes everything recorded
        up to now. The frontend asks again only after an answer, which keeps one
        preview running at a time.
        """
        if not self.recording():
            return ""
        snapshot = paths.VOICE_DIR / "preview.wav"
        try:
            if not copy_recorded(self.wav, snapshot):
                return ""
            return transcribe(self.manifest(), snapshot, self._run)
        finally:
            snapshot.unlink(missing_ok=True)

    def levels(self, bars: int = LEVEL_BARS) -> list[float]:
        """Loudness of the last `bars` tenths of a second, oldest first, each 0..1, for the waveform.

        Reads only the end of what pw-record has written so far, so it is cheap to ask often.
        """
        if not self.recording():
            return []
        window = SAMPLE_RATE // 10
        try:
            with open(self.wav, "rb") as recording:
                start = recording.read(4096).find(b"data", 12)
                if start < 0:
                    return [0.0] * bars
                begin = start + 8
                size = recording.seek(0, os.SEEK_END)
                offset = max(begin, size - bars * window * 2)
                offset -= (offset - begin) % 2
                recording.seek(offset)
                data = recording.read(size - offset)
        except OSError:
            return [0.0] * bars
        samples = array.array("h", data[:len(data) - len(data) % 2])
        if sys.byteorder != "little":
            samples.byteswap()
        heard = []
        for index in range(0, len(samples), window):
            chunk = samples[index:index + window]
            if chunk:
                peak = max(-min(chunk), max(chunk))
                heard.append(round(min(1.0, (peak / 32768) ** 0.5), 3))  # square root: quiet speech still shows
        return ([0.0] * bars + heard)[-bars:]

    def _has_audio(self) -> bool:
        try:
            with wave.open(str(self.wav), "rb") as recording:
                return recording.getnframes() > 0
        except (OSError, EOFError, wave.Error):
            return False

    def cancel(self) -> None:
        process = self._take()
        if process is not None:
            if process.poll() is None:
                process.kill()
            try:
                process.communicate(timeout=STOP_TIMEOUT)
            except (subprocess.TimeoutExpired, OSError):
                pass
        self.wav.unlink(missing_ok=True)
