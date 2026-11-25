import json
import tempfile
import unittest
from pathlib import Path

import main  # noqa: F401  The plugin entry point must import without Decky.
import runtime

MANIFEST = {
    "dsh": "0.2.2-rc.2",
    "glibc": "2.28",
    "assets": {
        "linux-x64": {"file": "x64.whl", "url": "https://example.test/x64.whl", "size": 97_000_000, "sha256": "a" * 64},
        "linux-arm64": {"file": "arm.whl", "url": "https://example.test/arm.whl", "size": 99_000_000, "sha256": "b" * 64},
    },
}


class RuntimeStatusTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())

    def check(self, machine="x86_64", glibc=(2, 39)):
        return runtime.status(MANIFEST, machine, glibc, self.root)

    def mark_installed(self, sha256):
        (self.root / runtime.INSTALLED_MARKER).write_text(json.dumps({"sha256": sha256}), encoding="utf-8")

    def test_supported_device_needs_setup_until_installed(self):
        status = self.check()
        self.assertEqual((status["platform"], status["supported"], status["installed"]), ("linux-x64", True, False))
        self.assertEqual(status["download_size"], 97_000_000)
        self.mark_installed("a" * 64)
        self.assertTrue(self.check()["installed"])

    def test_install_of_another_build_does_not_count(self):
        self.mark_installed("c" * 64)
        self.assertFalse(self.check()["installed"])

    def test_arm_devices_get_the_arm_runtime(self):
        self.mark_installed("b" * 64)
        status = self.check(machine="aarch64")
        self.assertEqual((status["platform"], status["installed"]), ("linux-arm64", True))

    def test_unsupported_cpu_and_old_glibc_are_reported(self):
        self.assertEqual(self.check(machine="riscv64")["reason"], "unsupported_cpu")
        status = self.check(glibc=(2, 27))
        self.assertEqual((status["supported"], status["reason"], status["glibc"]), (False, "old_glibc", "2.27"))

    def test_shipped_manifest_covers_both_platforms(self):
        manifest = runtime.load_manifest()
        self.assertEqual(set(manifest["assets"]), {"linux-x64", "linux-arm64"})
        for asset in manifest["assets"].values():
            self.assertTrue(asset["url"].startswith("https://"))
            self.assertRegex(asset["sha256"], r"^[0-9a-f]{64}$")


if __name__ == "__main__":
    unittest.main()
