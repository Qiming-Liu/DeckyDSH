import logging
import tempfile
import unittest
from pathlib import Path

import plugin_log


class PluginLogTest(unittest.TestCase):
    def setUp(self):
        self.folder = Path(tempfile.mkdtemp(prefix="dsh-log-"))
        self.logger = logging.getLogger(f"dsh-log-test-{id(self)}")
        self.log = plugin_log.PluginLog(self.folder / "logs", "DeckyDSH")
        self.log.attach(self.logger)
        self.addCleanup(self.log.detach)

    def test_api_key_and_home_never_reach_the_file(self):
        self.logger.info("saving sk-0123456789abcdef for /home/deck/DeckyDSH-workspace")
        self.logger.warning("check failed: api_key=abc123")
        text = self.log.path.read_text(encoding="utf-8")
        self.assertNotIn("0123456789abcdef", text)
        self.assertNotIn("abc123", text)
        self.assertNotIn("/home/deck", text)
        self.assertEqual([entry["level"] for entry in self.log.read()], ["INFO", "WARNING"])

    def test_export_and_clear(self):
        self.logger.info("first line")
        home = self.folder / "home"
        (home / "Downloads").mkdir(parents=True)
        exported = self.log.export(home, home / "Downloads")
        self.assertTrue(exported.startswith("~/Downloads/DeckyDSH-log-"))
        self.assertIn("first line", (home / exported[2:]).read_text(encoding="utf-8"))
        self.log.clear()
        self.assertEqual(self.log.read(), [])
        self.logger.info("after clear")
        self.assertEqual([entry["message"] for entry in self.log.read()], ["after clear"])


if __name__ == "__main__":
    unittest.main()
