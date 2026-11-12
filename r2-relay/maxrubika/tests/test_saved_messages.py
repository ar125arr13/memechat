#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""تستهای آفلاین کانکتور saved_messages.py — بدون maxrubika، شبکه یا لاگین.

اجرا: python3 -m unittest discover -s r2-relay/maxrubika/tests -v
"""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from saved_messages import (  # noqa: E402
    SavedMessagesTransport, FixtureMessenger, PREFIX, OUTBOX_KIND,
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

    def test_validate_outbox_accepts_only_ciphertext_texts(self):
        good = {"kind": OUTBOX_KIND, "texts": [PREFIX + "MCPK1.aaa.bbb"]}
        self.assertEqual(self.t.validate_outbox(good), good["texts"])
        for bad in [
            {"kind": "something-else", "texts": [PREFIX + "MCPK1.aaa.bbb"]},
            {"kind": OUTBOX_KIND, "texts": []},
            {"kind": OUTBOX_KIND, "texts": ["plaintext"]},
            {"kind": OUTBOX_KIND, "texts": [PREFIX + "MCPK1.aaa.bbb", 123]},
        ]:
            with self.assertRaises(ValueError):
                self.t.validate_outbox(bad)

    def test_send_outbox_and_roundtrip_in_one_transport(self):
        texts = [PREFIX + "MCPK1.aaa.bbb", PREFIX + "MCPK1.ccc.ddd"]
        outbox = {"kind": OUTBOX_KIND, "texts": texts}
        with tempfile.TemporaryDirectory() as d:
            outbox_path = str(Path(d) / "outbox.json")
            received_path = str(Path(d) / "received.json")
            Path(outbox_path).write_text(json.dumps(outbox), "utf8")
            report = self.t.roundtrip_outbox(outbox_path, received_path)
            self.assertTrue(report["ok"])
            self.assertEqual(report["sent"], 2)
            self.assertEqual(report["received"], 2)
            self.assertFalse(report["deleted"])
            self.assertEqual(report["destructiveOperations"], [])
            data = json.loads(Path(received_path).read_text("utf8"))
            self.assertEqual(data["kind"], OUTBOX_KIND)
            self.assertEqual([m["text"] for m in data["messages"]], texts)

    def test_send_outbox_rejects_bad_file_without_sending(self):
        with tempfile.TemporaryDirectory() as d:
            p = str(Path(d) / "bad.json")
            Path(p).write_text(json.dumps({"kind": OUTBOX_KIND, "texts": ["oops"]}), "utf8")
            with self.assertRaises(ValueError):
                self.t.send_outbox_file(p)
            self.assertEqual(self.t.fixture.sent_texts, [])

    def test_receive_to_file_writes_offline_messages(self):
        self.t.send([PREFIX + "MCPK1.aaa.bbb"])
        with tempfile.TemporaryDirectory() as d:
            p = str(Path(d) / "received.json")
            report = self.t.receive_to_file(p, 10)
            self.assertTrue(report["ok"])
            self.assertEqual(report["written"], 1)
            data = json.loads(Path(p).read_text("utf8"))
            self.assertEqual(data["mode"], "fixture")
            self.assertEqual(data["messages"][0]["text"], PREFIX + "MCPK1.aaa.bbb")

    def test_no_phone_otp_prompt_in_connector_source(self):
        src = Path(__file__).resolve().parents[1].joinpath("saved_messages.py").read_text("utf8")
        self.assertNotIn("input(", src)
        self.assertIn(DEFAULT_SESSION_ENV, src)
        self.assertIn("send_outbox", src)
        self.assertIn("roundtrip_outbox", src)


if __name__ == "__main__":
    unittest.main(verbosity=2)
