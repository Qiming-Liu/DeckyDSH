import hashlib
import io
import json
import shutil
import tempfile
import unittest
import urllib.error
import zipfile
from pathlib import Path

import api_key
import installer
import paths
import runtime
import plugin_settings as settings

PREFIX = runtime.WHEEL_RUNTIME_PREFIX
EXE = runtime.executable_name("linux-x64")


def make_wheel(extra=()):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, data, mode in [(PREFIX + EXE, b"#!/bin/sh\n", 0o755), (PREFIX + EXE + "-rg", b"rg", 0o755),
                                 (PREFIX + "linux-x64/downloads.json", b"{}", 0o644), *extra]:
            info = zipfile.ZipInfo(name)
            info.external_attr = (0o100000 | mode) << 16
            archive.writestr(info, data)
        archive.writestr("deepseek_harness_runtime/__init__.py", "")
    return buffer.getvalue()


class Response(io.BytesIO):
    def __init__(self, data, status=200):
        super().__init__(data)
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class InstallTest(unittest.TestCase):
    def setUp(self):
        shutil.rmtree(paths.DATA_DIR, ignore_errors=True)
        self.wheel = make_wheel()
        self.requests = []

    def manifest(self, wheel=None):
        wheel = wheel or self.wheel
        return {"dsh": "0.2.2-rc.2", "glibc": "2.28", "assets": {"linux-x64": {
            "file": "runtime.whl", "url": "https://example.test/runtime.whl", "size": len(wheel),
            "sha256": hashlib.sha256(wheel).hexdigest()}}}

    def opener(self, served=None):
        served = served if served is not None else self.wheel

        def open_url(request, timeout):
            self.requests.append(request.get_header("Range"))
            start = int(request.get_header("Range")[6:-1]) if request.get_header("Range") else 0
            return Response(served[start:], 206 if start else 200)
        return open_url

    def install(self, manifest=None, opener=None):
        job = installer.Installer(manifest or self.manifest(), "linux-x64", opener or self.opener(),
                                  smoke=lambda exe: "dsh 0.2.2-rc.2" if exe.is_file() else "")
        job.run()
        return job.snapshot()

    def test_install_unpacks_runtime_and_marks_it_last(self):
        self.assertEqual(self.install()["phase"], "done")
        root = paths.runtime_dir("0.2.2-rc.2")
        self.assertTrue((root / EXE).is_file() and (root / "linux-x64" / "downloads.json").is_file())
        self.assertTrue(runtime.is_installed("0.2.2-rc.2", self.manifest()["assets"]["linux-x64"]["sha256"]))
        self.assertFalse(any(paths.DOWNLOAD_DIR.iterdir()))
        self.assertFalse(paths.STAGING_DIR.exists())

    def test_damaged_download_is_deleted_and_nothing_installed(self):
        state = self.install(opener=self.opener(b"x" * len(self.wheel)))
        self.assertEqual((state["phase"], state["error"]), ("error", "checksum"))
        self.assertFalse(any(paths.DOWNLOAD_DIR.iterdir()))
        self.assertIsNone(runtime.read_marker("0.2.2-rc.2"))

    def test_partial_download_continues_with_a_range_request(self):
        paths.DOWNLOAD_DIR.mkdir(parents=True)
        (paths.DOWNLOAD_DIR / "runtime.whl.part").write_bytes(self.wheel[:100])
        self.assertEqual(self.install()["phase"], "done")
        self.assertEqual(self.requests, ["bytes=100-"])

    def test_network_failure_is_reported(self):
        def fail(request, timeout):
            raise urllib.error.URLError("offline")
        self.assertEqual(self.install(opener=fail)["error"], "network")

    def test_wheel_paths_outside_the_runtime_folder_are_refused(self):
        wheel = make_wheel([(PREFIX + "../escape", b"x", 0o644)])
        state = self.install(self.manifest(wheel), self.opener(wheel))
        self.assertEqual(state["error"], "extract")
        self.assertFalse((paths.RUNTIME_DIR / "escape").exists())

    def test_runtime_that_fails_to_start_is_not_installed(self):
        def broken(exe):
            raise installer.InstallError("smoke")
        job = installer.Installer(self.manifest(), "linux-x64", self.opener(), smoke=broken)
        job.run()
        self.assertEqual(job.snapshot()["error"], "smoke")
        self.assertIsNone(runtime.read_marker("0.2.2-rc.2"))


class ApiKeyTest(unittest.TestCase):
    def setUp(self):
        shutil.rmtree(paths.DSH_HOME, ignore_errors=True)

    def test_save_replaces_only_its_own_line(self):
        paths.DSH_HOME.mkdir(parents=True)
        api_key.env_file().write_text("OTHER=1\nDEEPSEEK_API_KEY=old\n", encoding="utf-8")
        api_key.save(" sk-new ")
        self.assertEqual(api_key.env_file().read_text(encoding="utf-8"), "OTHER=1\nDEEPSEEK_API_KEY=sk-new\n")
        self.assertTrue(api_key.has_key())

    def test_keys_that_could_break_the_env_file_are_refused(self):
        for bad in ("", "sk-a b", "sk-a\nX=1", 'sk-"x"'):
            with self.assertRaises(ValueError):
                api_key.save(bad)
        self.assertFalse(api_key.has_key())

    def test_check_reports_rejected_keys(self):
        def refuse(request, timeout):
            raise urllib.error.HTTPError(request.full_url, 401, "Unauthorized", {}, None)
        self.assertEqual(api_key.check("sk-x", refuse), "invalid")
        self.assertEqual(api_key.check("sk-x", lambda r, timeout: Response(json.dumps({"data": []}).encode())), "ok")


class SettingsTest(unittest.TestCase):
    def setUp(self):
        self.path = Path(tempfile.mkdtemp()) / "settings.json"
        self.workspace = str(Path(tempfile.mkdtemp()) / "workspace")

    def test_full_access_needs_the_risk_confirmation(self):
        with self.assertRaises(ValueError):
            settings.save({"default_permission": "danger-full-access", "workspace": self.workspace}, self.path)
        saved = settings.save({"default_permission": "danger-full-access", "risk_accepted": True,
                               "workspace": self.workspace}, self.path)
        self.assertEqual(settings.load(self.path)["default_permission"], saved["default_permission"])
        self.assertTrue(Path(self.workspace).is_dir())

    def test_the_old_default_workspace_moves_to_the_new_one(self):
        self.path.write_text(json.dumps({"workspace": str(paths.OLD_DEFAULT_WORKSPACE), "upload_session_log": True}),
                             encoding="utf-8")
        self.assertEqual(settings.load(self.path)["workspace"], str(paths.DEFAULT_WORKSPACE))
        self.assertTrue(settings.load(self.path)["live_voice_text"])
        self.assertNotIn("upload_session_log", settings.load(self.path))


if __name__ == "__main__":
    unittest.main()
