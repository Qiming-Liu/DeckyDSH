import json
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request

import key_handoff


def post(url, body):
    data = json.dumps(body).encode()
    request = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, json.load(error)


def get(url):
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            return response.status, response.read().decode()
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode()


class KeyHandoffTest(unittest.TestCase):
    def setUp(self):
        self.saved, self.checked, self.notified = [], [], []
        self.result = "ok"

        def check(key):
            self.checked.append(key)
            return self.result

        self.handoff = key_handoff.KeyHandoff(
            check=check, save=self.saved.append, on_saved=lambda: self.notified.append(True),
            address=lambda: "127.0.0.1", ports=range(18765, 18785))
        self.addCleanup(self.handoff.stop)

    def start(self, language="zh-CN"):
        state = self.handoff.start(language)
        self.assertEqual(state["phase"], "waiting")
        parts = urllib.parse.urlsplit(state["url"])
        return f"{parts.scheme}://{parts.netloc}", urllib.parse.parse_qs(parts.query)["t"][0], state["url"]

    def test_phone_page_needs_the_token(self):
        base, token, url = self.start()
        status, page = get(url)
        self.assertEqual(status, 200)
        self.assertIn("发送到掌机", page)
        self.assertNotIn(token, page)
        self.assertEqual(get(base + "/?t=wrong")[0], 403)
        self.assertEqual(get(base + "/")[0], 403)

    def test_good_key_is_checked_saved_and_closes_the_server(self):
        base, token, _ = self.start()
        self.assertEqual(post(base + "/key", {"token": token, "key": "  sk-good  "}), (200, {"result": "ok"}))
        self.assertEqual(self.checked, ["sk-good"])
        self.assertEqual(self.saved, ["sk-good"])
        self.assertEqual(self.notified, [True])
        self.assertEqual(self.handoff.snapshot(), {"phase": "saved", "url": None})
        for _ in range(50):
            try:
                urllib.request.urlopen(base + "/", timeout=0.5)
            except urllib.error.HTTPError:
                time.sleep(0.05)
                continue
            except OSError:
                break
        else:
            self.fail("server still answering after the key was saved")

    def test_refused_key_is_not_saved_and_the_phone_can_retry(self):
        base, token, _ = self.start()
        self.result = "invalid"
        self.assertEqual(post(base + "/key", {"token": token, "key": "sk-bad"}), (200, {"result": "invalid"}))
        self.assertEqual(self.saved, [])
        self.assertEqual(self.handoff.snapshot()["phase"], "waiting")
        self.result = "ok"
        self.assertEqual(post(base + "/key", {"token": token, "key": "sk-good"}), (200, {"result": "ok"}))
        self.assertEqual(self.saved, ["sk-good"])

    def test_wrong_token_never_reaches_the_check(self):
        base, _, _ = self.start()
        self.assertEqual(post(base + "/key", {"token": "guess", "key": "sk-x"}), (403, {"result": "expired"}))
        self.assertEqual(self.checked, [])

    def test_too_many_wrong_tokens_close_the_server(self):
        base, token, _ = self.start()
        for _ in range(key_handoff.MAX_BAD_TOKENS):
            get(base + "/?t=guess")
        self.assertEqual(self.handoff.snapshot(), {"phase": "off", "url": None})

    def test_stop_ends_the_link(self):
        _, _, url = self.start()
        self.handoff.stop()
        self.assertEqual(self.handoff.snapshot(), {"phase": "off", "url": None})

    def test_no_network_is_reported(self):
        handoff = key_handoff.KeyHandoff(address=lambda: None)
        self.assertEqual(handoff.start("en"), {"phase": "unavailable", "url": None})

    def test_pages_cover_every_language(self):
        for language in ("en", "zh-CN", "zh-TW"):
            self.assertIn(f'lang="{language}"', key_handoff.render_page(language))
        self.assertIn('lang="en"', key_handoff.render_page("fr"))


if __name__ == "__main__":
    unittest.main()
