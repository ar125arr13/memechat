#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""MemeChat — کانکتور «پیامهای ذخیرهشدهٔ روبیکا» با MAXRubika.

این فایل فقط از متدهای مستند/تأییدشدهٔ پکیج استفاده میکند:
    Messenger(session)
    app.send_message(chat="me", text=...)          → Saved Messages
    app.send_file(chat="me", file=..., text=...)
    app.get_last_messages(chat=<guid>, limit=N)
    app.get_chat_messages(chat=<guid>, ...)
    app.guid                                       → GUID حساب خودتان

نکتهٔ مهم (از سورس پکیج تأیید شد): send_message مقدار "me" را داخل خودش
به self.guid تبدیل میکند، ولی get_last_messages/get_chat_messages از get_guid()
رد میشوند و get_guid("me") پشتیبانی نمیشود. پس خواندن برگشت حتماً با GUID
واقعی حساب انجام میگیرد، نه "me".

قوانین:
  - فقط «نام سشن» از env خوانده میشود (MC_MAXRUBIKA_SESSION). هیچ شماره،
    کد تأیید، auth، private_key یا توکنی داخل سورس/لاگ/چت/مخزن نیست.
  - لاگین اولیه (شماره + کد) یکبار روی دستگاه خودتان و بهصورت تعاملی انجام
    میشود؛ این فایل آن را نمیپرسد، ذخیره نمیکند و از چت نمیگیرد.
  - `send_outbox` / `send-outbox` فقط متنهای `MCR1.` (ciphertext فایلهای
    دیتابیس) را میفرستد؛ هیچ plaintextـای وارد پیام نمیشود.
  - `receive-to-file` متنهای برگشتی را برای تأیید SHA سمت Node ذخیره میکند.
  - صفر حذف: delete_messages / delete صدا زده نمیشود.
  - بدون ورسل، بدون دیپلوی، بدون API رسمی روبیکا، بدون توکن بات.

منابع:
  https://github.com/MEH2RAB/maxrubika
  https://meh2rab.github.io/maxrubika/client-messages-send/
  https://meh2rab.github.io/maxrubika/client-messages-fetch/
  https://meh2rab.github.io/maxrubika/ai/
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

SAVED_MESSAGES_CHAT = "me"
DEFAULT_SESSION_ENV = "MC_MAXRUBIKA_SESSION"
DEFAULT_LIMIT = 100
PREFIX = "MCR1."
OUTBOX_KIND = "memechat-db-files-saved-messages"


@dataclass
class TransportReport:
    ok: bool
    sent: int = 0
    received: int = 0
    mode: str = "fixture"
    official_api: bool = False
    bot_token_used: bool = False
    vercel_used: bool = False
    deleted: bool = False
    retained_in_primary: bool = True
    destructive_operations: list = field(default_factory=list)
    errors: list = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "ok": self.ok, "sent": self.sent, "received": self.received,
            "mode": self.mode, "officialApiUsed": self.official_api,
            "botTokenUsed": self.bot_token_used, "vercelUsed": self.vercel_used,
            "deleted": self.deleted, "retainedInPrimary": self.retained_in_primary,
            "destructiveOperations": list(self.destructive_operations),
            "errors": list(self.errors),
        }


class FixtureMessenger:
    """شبیهساز آفلاین؛ همان رابط چهار متد مستند را دارد، بدون لاگین و شبکه."""

    def __init__(self) -> None:
        self.guid = "u0" + "F" * 30          # GUID غیرواقعی، فقط برای تست
        self.sent_texts: list[str] = []
        self.sent_files: list[dict] = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def send_message(self, chat: str, text: str = None, **kwargs):
        if chat != SAVED_MESSAGES_CHAT:
            raise ValueError("FIXTURE_ONLY_ME_CHAT")
        if text is None:
            raise ValueError("TEXT_REQUIRED")
        self.sent_texts.append(text)
        return {"message_id": str(1000 + len(self.sent_texts)), "chat_guid": self.guid}

    def send_file(self, chat: str, file=None, text: str = None, **kwargs):
        if chat != SAVED_MESSAGES_CHAT:
            raise ValueError("FIXTURE_ONLY_ME_CHAT")
        self.sent_files.append({"size": len(file or b""), "text": text})
        if text:
            self.sent_texts.append(text)
        return {"message_id": str(2000 + len(self.sent_files)), "chat_guid": self.guid}

    def get_last_messages(self, chat: str, limit: int = DEFAULT_LIMIT):
        # فقط متنها برگردانده میشوند؛ همان شکلی که مستندات گفته (Data با messages/count)
        msgs = [
            {"message_id": str(3000 + i), "text": t, "author_guid": self.guid}
            for i, t in enumerate(self.sent_texts[-limit:])
        ]
        return {"messages": msgs, "count": len(msgs)}

    def get_chat_messages(self, chat: str, **kwargs):
        limit = kwargs.get("limit") or DEFAULT_LIMIT
        return self.get_last_messages(chat, limit=limit)


def _as_messages(result: Any) -> list:
    """خروجی Data یا dict را به لیست پیامها تبدیل میکند (دفاعی، بدون حدس متد)."""
    data = result.to_dict() if hasattr(result, "to_dict") else result
    if isinstance(data, dict):
        return list(data.get("messages") or [])
    if isinstance(data, list):
        return data
    return []


class SavedMessagesTransport:
    """ترانسپورت قابلتزریق برای SavedMessagesDriver سمت Node.

    messenger_factory=None → حالت آفلاین (FixtureMessenger)
    messenger_factory=<callable> → حالت واقعی؛ باید شیء Messenger بسازد.
    """

    def __init__(self, messenger_factory: Optional[Callable] = None) -> None:
        self.messenger_factory = messenger_factory
        self.fixture = FixtureMessenger() if messenger_factory is None else None
        self.mode = "fixture" if messenger_factory is None else "real"
        self.last_guid: Optional[str] = None
        self.last_report: Optional[TransportReport] = None

    def _app(self):
        if self.fixture is not None:
            return self.fixture
        return self.messenger_factory()

    @staticmethod
    def from_env():
        """حالت واقعی: فقط نام سشن از env. اگر نبود، آفلاین میماند."""
        session_name = os.environ.get(DEFAULT_SESSION_ENV, "").strip()
        if not session_name:
            return SavedMessagesTransport(None)

        def factory():
            # واردات تنبل؛ پکیج فقط وقتی لازم است import میشود.
            from maxrubika import Messenger  # type: ignore
            return Messenger(session_name)

        return SavedMessagesTransport(factory)

    def describe(self) -> dict:
        return {
            "mode": self.mode,
            "chat": SAVED_MESSAGES_CHAT,
            "library": "maxrubika",
            "officialApi": False,
            "botTokenUsed": False,
            "vercelUsed": False,
            "frontendSecrets": False,
            "sessionFromEnvOnly": self.mode == "real",
            "deleteCalled": False,
        }

    def send(self, texts: list[str]) -> dict:
        report = TransportReport(ok=True, mode=self.mode)
        app = self._app()
        try:
            with app as client:
                self.last_guid = getattr(client, "guid", None) or self.last_guid
                for text in texts:
                    try:
                        if not isinstance(text, str) or not text.startswith(PREFIX):
                            raise ValueError("NOT_MCR1_TEXT")
                        client.send_message(chat=SAVED_MESSAGES_CHAT, text=text)
                        report.sent += 1
                    except Exception as exc:                 # مستندات: همیشه try/except
                        report.ok = False
                        report.errors.append(type(exc).__name__)
        except Exception as exc:
            report.ok = False
            report.errors.append(type(exc).__name__)
        self.last_report = report
        return report.as_dict()

    def receive(self, limit: int = DEFAULT_LIMIT) -> list:
        app = self._app()
        guid = getattr(app, "guid", None) or self.last_guid
        if not guid:
            # خواندن با "me" در این نسخه پشتیبانی نمیشود؛ صادقانه اعلام میکنیم.
            raise RuntimeError("SAVED_MESSAGES_GUID_REQUIRED: get_guid('me') unsupported")
        try:
            with app as client:
                resolved = getattr(client, "guid", None) or guid
                result = client.get_last_messages(chat=resolved, limit=min(max(limit, 1), 1000))
                return _as_messages(result)
        except Exception as exc:
            raise RuntimeError(f"SAVED_MESSAGES_READ_FAILED: {type(exc).__name__}") from exc

    def send_file(self, data: bytes, caption: str = None) -> dict:
        """ارسال فایل رمزشدهٔ واقعی به Saved Messages (متد مستند send_file)."""
        report = TransportReport(ok=True, mode=self.mode)
        app = self._app()
        try:
            with app as client:
                client.send_file(chat=SAVED_MESSAGES_CHAT, file=data, text=caption)
                report.sent = 1
        except Exception as exc:
            report.ok = False
            report.errors.append(type(exc).__name__)
        self.last_report = report
        return report.as_dict()

    @staticmethod
    def validate_outbox(outbox: Any) -> list[str]:
        """فقط متنهای MCR1 (ciphertext) را میپذیرد؛ هیچ فیلد اضافهای لازم نیست."""
        if not isinstance(outbox, dict) or outbox.get("kind") != OUTBOX_KIND:
            raise ValueError("OUTBOX_KIND_MISMATCH")
        texts = outbox.get("texts")
        if not isinstance(texts, list) or not texts:
            raise ValueError("OUTBOX_TEXTS_REQUIRED")
        for t in texts:
            if not isinstance(t, str) or not t.startswith(PREFIX):
                raise ValueError("NOT_MCR1_TEXT")
        return list(texts)

    def send_outbox(self, outbox: Any) -> dict:
        """ارسال outbox فایلهای دیتابیس (همان خطهای رمزشده) به Saved Messages.

        هیچ شماره، OTP، رمز عبور یا توکنی از چت/سورس گرفته نمیشود؛ فقط نام
        سشن از env. در حالت fixture کاملاً آفلاین است.
        """
        texts = self.validate_outbox(outbox)
        return self.send(texts)

    def send_outbox_file(self, path: str) -> dict:
        with open(path, "r", encoding="utf-8") as fh:
            outbox = json.load(fh)
        return self.send_outbox(outbox)

    def receive_to_file(self, path: str, limit: int = DEFAULT_LIMIT) -> dict:
        """متنهای برگشتی Saved Messages را برای تأیید سمت Node ذخیره میکند."""
        messages = self.receive(limit)
        payload = {
            "kind": OUTBOX_KIND,
            "mode": self.mode,
            "messages": [{"text": m.get("text") if isinstance(m, dict) else m}
                         for m in messages],
        }
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
        return {"ok": True, "written": len(payload["messages"]),
                "mode": self.mode, "deleted": False,
                "destructiveOperations": []}

    def roundtrip_outbox(self, outbox_path: str, received_path: str,
                         limit: int = 1000) -> dict:
        """ارسال outbox و خواندن دوبارهٔ همان پیامها، در **یک** نمونه ترانسپورت.

        در حالت fixture لازم است چون حافظهٔ نمونه بین دو فرآیند نمیماند؛
        در حالت واقعی، پیامها روی حساب روبیکا ذخیره میشوند و جدا هم قابل
        خواندناند. خروجی `received_path` ورودی `verify --received` سمت Node است.
        """
        sent = self.send_outbox_file(outbox_path)
        received = self.receive_to_file(received_path, limit)
        return {
            "ok": bool(sent.get("ok")) and bool(received.get("ok")),
            "mode": self.mode,
            "sent": sent.get("sent", 0),
            "received": received.get("written", 0),
            "deleted": False,
            "destructiveOperations": [],
        }

    def status(self) -> dict:
        return {**self.describe(), "lastGuidPresent": bool(self.last_guid),
                "lastReport": self.last_report.as_dict() if self.last_report else None}


def main() -> None:
    """رابط خطفرمان ساده: python saved_messages.py <status|send|receive|help>"""
    import sys

    cmd = sys.argv[1] if len(sys.argv) > 1 else "help"
    t = SavedMessagesTransport.from_env()
    if cmd == "status":
        print(json.dumps(t.status(), ensure_ascii=False, indent=2))
    elif cmd == "send":
        payload = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {"texts": []}
        print(json.dumps(t.send(payload.get("texts", [])), ensure_ascii=False, indent=2))
    elif cmd == "receive":
        limit = int(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_LIMIT
        print(json.dumps({"messages": t.receive(limit)}, ensure_ascii=False, indent=2))
    elif cmd == "send-outbox":
        if len(sys.argv) < 3:
            print("OUTBOX_FILE_REQUIRED")
            return
        print(json.dumps(t.send_outbox_file(sys.argv[2]), ensure_ascii=False, indent=2))
    elif cmd == "receive-to-file":
        if len(sys.argv) < 3:
            print("OUTPUT_FILE_REQUIRED")
            return
        limit = int(sys.argv[3]) if len(sys.argv) > 3 else 1000
        print(json.dumps(t.receive_to_file(sys.argv[2], limit), ensure_ascii=False, indent=2))
    elif cmd == "roundtrip-outbox":
        if len(sys.argv) < 4:
            print("OUTBOX_AND_RECEIVED_FILES_REQUIRED")
            return
        print(json.dumps(t.roundtrip_outbox(sys.argv[2], sys.argv[3]),
                         ensure_ascii=False, indent=2))
    else:
        print("MemeChat Saved Messages: status | send '<json>' | receive [limit]")
        print("  send-outbox <outbox.json> | receive-to-file <received.json> [limit]")
        print("  roundtrip-outbox <outbox.json> <received.json> | help")
        print("متغیر محیطی:", DEFAULT_SESSION_ENV, "(فقط نام سشن؛ بدون هیچ راز)")


if __name__ == "__main__":
    main()
