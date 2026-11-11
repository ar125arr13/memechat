#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""تستهای آفلاین کانکتور saved_messages.py — بدون maxrubika، شبکه یا لاگین.

اجرا: python3 -m unittest discover -s r2-relay/maxrubika/tests -v
"""

import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from saved_messages import (  # noqa: E402
    SavedMessagesTransport, FixtureMessenger, PREFIX,
    SAVED_MESSAGES_CHAT, DEFAULT_SESSION_ENV, _as_messages,
)


class SavedMessagesTests(unittest.TestCase):
    def setUp(self):
        self.t = SavedMessagesTransport(None)

    def test_fixture_mode_is_offline_and_no_bot_token(self):
        d = self.t.describe()
        self.assertEqual(d["mode"], "fixture")
        self.assertEqual(d["chat"], "me")
        self.assertFalse(d["officialApi"])
        self.assertFalse(d["botTokenUsed"])
        self.assertFalse(d["vercelUsed"])
        self.assertFalse(d["deleteCalled"])

    def test_send_two_packets_and_read_back(self):
        texts = [PREFIX + "MCPK1.aaa.bbb", PREFIX + "MCPK1.ccc.ddd"]
        report = self.t.send(texts)
        self.assertTrue(report["ok"])
        self.assertEqual(report["sent"], 2)
        self.assertFalse(report["deleted"])
        self.assertEqual(report["destructiveOperations"], [])
        msgs = self.t.receive(100)
        self.assertEqual(len(msgs), 2)
        self.assertEqual([m["text"] for m in msgs], texts)

    def test_non_mcr1_text_is_rejected_without_deleting(self):
        report = self.t.send(["not-a-packet"])
        self.assertFalse(report["ok"])
        self.assertEqual(report["sent"], 0)
        self.assertFalse(report["deleted"])
        self.assertTrue(report["errors"])

    def test_send_file_uses_documented_method(self):
        report = self.t.send_file(b"ciphertext-bytes", caption=PREFIX + "manifest")
        self.assertTrue(report["ok"])
        self.assertEqual(len(self.t.fixture.sent_files), 1)

    def test_chat_must_be_me(self):
        with self.assertRaises(ValueError):
            self.t.fixture.send_message(chat="someone-else", text="x")

    def test_read_requires_guid_not_me(self):
        class NoGuid:
            guid = None
            def __enter__(self): return self
            def __exit__(self, *a): return False
        t = SavedMessagesTransport(lambda: NoGuid())
        with self.assertRaises(RuntimeError) as ctx:
            t.receive(10)
        self.assertIn("GUID_REQUIRED", str(ctx.exception))

    def test_as_messages_accepts_dict_and_list(self):
        self.assertEqual(len(_as_messages({"messages": [1, 2]})), 2)
        self.assertEqual(len(_as_messages([1, 2, 3])), 3)
        self.assertEqual(_as_messages(None), [])

    def test_from_env_without_session_stays_offline(self):
        old = os.environ.pop(DEFAULT_SESSION_ENV, None)
        try:
            t = SavedMessagesTransport.from_env()
            self.assertEqual(t.describe()["mode"], "fixture")
        finally:
            if old is not None:
                os.environ[DEFAULT_SESSION_ENV] = old

    def test_no_delete_method_called_in_source(self):
        src = Path(__file__).resolve().parents[1].joinpath("saved_messages.py").read_text("utf8")
        self.assertNotIn("delete_messages(", src)
        self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY", src)
        self.assertIn("send_message(chat=SAVED_MESSAGES_CHAT", src)
        self.assertIn("get_last_messages(", src)


if __name__ == "__main__":
    unittest.main(verbosity=2)
