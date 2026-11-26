import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import paths
import uninstall_cleanup

SH = shutil.which("sh")


class UninstallCleanupTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        self.plugin = self.root / "plugins" / "DeckyDSH"
        self.runtime, self.voice, self.dsh = (self.root / "data" / name for name in ("runtime", "voice", "dsh"))
        for folder in (self.plugin, self.runtime, self.voice, self.dsh):
            folder.mkdir(parents=True)
        (self.dsh / ".env").write_text("DEEPSEEK_API_KEY=sk-test\n")

    def run_check(self):
        argv = uninstall_cleanup.command(self.plugin, [self.runtime, self.voice], delay=0, shell=SH)
        subprocess.run(argv, check=True, timeout=10)

    def test_only_the_downloads_are_cleaned_never_the_key(self):
        self.assertEqual(uninstall_cleanup.downloads(), [paths.RUNTIME_DIR, paths.VOICE_DIR])
        self.assertNotIn(paths.DSH_HOME, uninstall_cleanup.downloads())

    @unittest.skipUnless(SH, "needs a POSIX shell")
    def test_reinstall_keeps_the_downloads(self):
        self.run_check()
        self.assertTrue(self.runtime.exists())
        self.assertTrue(self.voice.exists())

    @unittest.skipUnless(SH, "needs a POSIX shell")
    def test_uninstall_deletes_the_downloads_and_keeps_the_key(self):
        shutil.rmtree(self.plugin)
        self.run_check()
        self.assertFalse(self.runtime.exists())
        self.assertFalse(self.voice.exists())
        self.assertEqual((self.dsh / ".env").read_text(), "DEEPSEEK_API_KEY=sk-test\n")

    def test_missing_shell_is_not_an_error(self):
        self.assertFalse(uninstall_cleanup.schedule(self.plugin, [self.runtime], shell=str(self.root / "no-sh")))
        self.assertTrue(self.runtime.exists())


if __name__ == "__main__":
    unittest.main()
