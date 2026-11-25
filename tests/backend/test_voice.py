import hashlib
import io
import shutil
import subprocess
import tarfile
import unittest
import urllib.error
from pathlib import Path

import paths
import voice
from tests.backend.test_install import Response

TOP = "sherpa-onnx-v9-linux-x64"


def make_archive(names=("bin/recognize", "lib/libonnxruntime.so", "bin/other")):
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:bz2") as tar:
        for name in names:
            data = name.encode()
            info = tarfile.TarInfo(f"{TOP}/{name}")
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return buffer.getvalue()


def pin(name, data, urls=None):
    return {"file": name, "urls": urls or [f"https://example.test/{name}"], "size": len(data),
            "sha256": hashlib.sha256(data).hexdigest()}


class VoiceInstallTest(unittest.TestCase):
    def setUp(self):
        shutil.rmtree(paths.VOICE_DIR, ignore_errors=True)
        self.files = {"engine.tar.bz2": make_archive(), "model.onnx": b"model", "tokens.txt": b"tokens",
                      "vad.onnx": b"vad"}
        self.manifest = {
            "engine": "9", "binary": "recognize",
            "assets": {"linux-x64": pin("engine.tar.bz2", self.files["engine.tar.bz2"])},
            "models": {"model": pin("model.onnx", b"model", ["https://down.test/model.onnx", "https://mirror.test/model.onnx"]),
                       "tokens": pin("tokens.txt", b"tokens"), "vad": pin("vad.onnx", b"vad")},
        }
        self.requests = []

    def opener(self, request, timeout):
        self.requests.append(request.full_url)
        if request.full_url.startswith("https://down.test/"):
            raise urllib.error.URLError("offline")
        return Response(self.files[request.full_url.rsplit("/", 1)[1]])

    def install(self, smoke=None):
        job = voice.VoiceInstaller(self.manifest, "linux-x64", self.opener, smoke or (lambda manifest: None))
        job.run()
        return job.snapshot()

    def test_install_keeps_only_the_program_and_runtime_and_marks_it_last(self):
        state = self.install()
        self.assertEqual(state["phase"], "done")
        self.assertEqual(state["done"], state["total"])
        engine = voice.engine_dir(self.manifest)
        self.assertEqual(sorted(p.relative_to(engine).as_posix() for p in engine.rglob("*") if p.is_file()),
                         ["bin/recognize", "lib/libonnxruntime.so"])
        self.assertEqual((voice.models_dir() / "model.onnx").read_bytes(), b"model")
        self.assertTrue(voice.status(self.manifest, "x86_64")["installed"])
        self.assertFalse((paths.VOICE_DIR / ".download").exists())

    def test_a_failing_source_falls_back_to_the_mirror(self):
        self.assertEqual(self.install()["phase"], "done")
        self.assertIn("https://mirror.test/model.onnx", self.requests)

    def test_damaged_file_is_not_installed(self):
        self.files["tokens.txt"] = b"tokenX"
        state = self.install()
        self.assertEqual((state["phase"], state["error"]), ("error", "checksum"))
        self.assertFalse(voice.is_installed(self.manifest, "linux-x64"))

    def test_engine_that_cannot_load_the_model_is_not_installed(self):
        def broken(manifest):
            raise voice.InstallError("smoke")
        self.assertEqual(self.install(broken)["error"], "smoke")
        self.assertFalse(voice.is_installed(self.manifest, "linux-x64"))

    def test_a_changed_pin_needs_a_new_install(self):
        self.install()
        self.manifest["models"]["model"]["sha256"] = "0" * 64
        self.assertFalse(voice.is_installed(self.manifest, "linux-x64"))

    def test_unknown_cpu_is_unsupported(self):
        self.assertEqual(voice.status(self.manifest, "riscv64"),
                         {"supported": False, "installed": False, "download_size": None})


class OutputTest(unittest.TestCase):
    def test_segments_are_joined_without_spaces_between_cjk(self):
        stdout = "0.742 -- 5.568: 开饭时间早上9点。\n6.0 -- 7.5: 好的\n8.0 -- 9.0: Then English.\n10 -- 11: and more\n"
        self.assertEqual(voice.parse_output(stdout), "开饭时间早上9点。好的Then English. and more")

    def test_silence_gives_empty_text(self):
        self.assertEqual(voice.parse_output("Started!\n"), "")


class FakeProcess:
    def __init__(self, wav, frames=1600):
        self.wav, self.frames, self.signals, self.running = wav, frames, [], True

    def poll(self):
        return None if self.running else 0

    def send_signal(self, sig):
        self.signals.append(sig)
        if self.frames:
            voice.write_silence(self.wav, self.frames / voice.SAMPLE_RATE)
        self.running = False

    def kill(self):
        self.running = False

    def communicate(self, timeout=None):
        return b"", b"no microphone" if not self.frames else b""


class RecorderTest(unittest.TestCase):
    def setUp(self):
        shutil.rmtree(paths.VOICE_DIR, ignore_errors=True)
        self.manifest = {"engine": "9", "binary": "recognize", "assets": {"linux-x64": pin("e", b"e")},
                         "models": {"model": pin("m", b"m"), "tokens": pin("t", b"t"), "vad": pin("v", b"v")}}
        paths.VOICE_DIR.mkdir(parents=True)
        (paths.VOICE_DIR / voice.MARKER).write_text(
            '{"fingerprint": "%s"}' % voice.fingerprint(self.manifest, "linux-x64"), encoding="utf-8")
        self.commands = []
        self.frames = 1600

    def popen(self, argv, **kwargs):
        self.commands.append(argv)
        self.process = FakeProcess(paths.VOICE_DIR / "recording.wav", self.frames)
        return self.process

    def fake_run(self, argv, **kwargs):
        self.commands.append(argv)
        return subprocess.CompletedProcess(argv, 0, "0.1 -- 0.9: 你好\n", "")

    def recorder(self):
        return voice.Recorder(self.manifest, self.popen, self.fake_run, lambda name, path: f"/usr/bin/{name}", "linux-x64")

    def test_record_then_stop_transcribes_and_deletes_the_recording(self):
        recorder = self.recorder()
        recorder.start()
        self.assertTrue(recorder.recording())
        self.assertEqual(recorder.stop(), "你好")
        self.assertFalse(recorder.recording())
        self.assertEqual(self.commands[0][:7], ["/usr/bin/pw-record", "--rate", "16000", "--channels", "1", "--format", "s16"])
        self.assertEqual(Path(self.commands[1][0]).parts[-2:], ("bin", "recognize"))
        self.assertFalse(recorder.wav.exists())

    def test_no_audio_is_a_record_error(self):
        self.frames = 0
        recorder = self.recorder()
        recorder.start()
        with self.assertRaises(voice.VoiceError) as caught:
            recorder.stop()
        self.assertEqual(caught.exception.code, "record")
        self.assertEqual(len(self.commands), 1)

    def test_recording_needs_the_install(self):
        (paths.VOICE_DIR / voice.MARKER).unlink()
        with self.assertRaises(voice.VoiceError) as caught:
            self.recorder().start()
        self.assertEqual(caught.exception.code, "not_installed")

    def test_preview_reads_an_unfinished_recording(self):
        recorder = self.recorder()
        recorder.start()
        # pw-record has not written the final sizes yet: the header says no samples.
        recorder.wav.write_bytes(b"RIFF\0\0\0\0WAVEfmt " + bytes(20) + b"data\0\0\0\0" + bytes(16000 * 2))
        self.assertEqual(recorder.preview(), "你好")
        snapshot = self.commands[-1][-1]
        self.assertTrue(snapshot.endswith("preview.wav"))
        self.assertFalse((paths.VOICE_DIR / "preview.wav").exists())
        recorder.cancel()

    def test_preview_waits_for_enough_audio_and_needs_a_recording(self):
        recorder = self.recorder()
        self.assertEqual(recorder.preview(), "")
        recorder.start()
        recorder.wav.write_bytes(b"RIFF\0\0\0\0WAVEfmt " + bytes(20) + b"data\0\0\0\0" + bytes(100))
        self.assertEqual(recorder.preview(), "")
        self.assertEqual(len(self.commands), 1)
        recorder.cancel()

    def test_cancel_drops_the_recording(self):
        recorder = self.recorder()
        recorder.start()
        recorder.cancel()
        self.assertFalse(recorder.recording())
        with self.assertRaises(voice.VoiceError):
            recorder.stop()


if __name__ == "__main__":
    unittest.main()
