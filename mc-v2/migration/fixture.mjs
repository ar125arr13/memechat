/* MemeChat v2 — migration/fixture.mjs
 * دادهٔ ساختگی برای تست «کپی کامل و قابل بازیابی». هیچ دادهٔ واقعی کاربری اینجا نیست.
 * شکل رکوردها دقیقاً همان شکلی است که در mimchat_staging_messages / mimchat_users
 * دیده شد: id, topic, from_id, sender_username, text, file, reactions, seen_by, ts ...
 */
/* همان فهرست راستیآزماییشدهٔ ۴۴ جدول زنده (همگام با backup.mjs) */
const LIVE_TABLES = [
  "conversation_members", "conversations", "messages", "profile",
  "mimchat_assets", "mimchat_bans", "mimchat_boosts", "mimchat_bot_handlers",
  "mimchat_bot_runs", "mimchat_bot_scripts", "mimchat_bots",
  "mimchat_challenge_teams", "mimchat_challenge_weeks", "mimchat_code",
  "mimchat_email_verifications", "mimchat_gift_log", "mimchat_gifts", "mimchat_media",
  "mimchat_nft", "mimchat_nft_owned", "mimchat_nft_transfers", "mimchat_nfts",
  "mimchat_pins", "mimchat_premium_icons", "mimchat_publish_comments",
  "mimchat_publish_saves", "mimchat_publishes", "mimchat_rate_limits",
  "mimchat_room_members", "mimchat_rooms", "mimchat_schema_version", "mimchat_sessions",
  "mimchat_settings", "mimchat_spam_reports", "mimchat_staging_messages",
  "mimchat_staging_outbox", "mimchat_sticker_owns", "mimchat_stickers", "mimchat_stories",
  "mimchat_story_views", "mimchat_tickets", "mimchat_typing", "mimchat_users",
  "mimchat_verifications",
];

export function makeFixture() {
  const users = [
    { id: "u-1001", username: "sepehr", display_name: "سپهر", email: "private@example.invalid", password_hash: "NEVER-PUBLISH", role: "admin", avatar: "", bio: "نمونه", theme: "kowa", blue_tick: true },
    { id: "u-1002", username: "nazi", display_name: "نازی", email: "private2@example.invalid", password_hash: "NEVER-PUBLISH", role: "user", avatar: "", bio: "", theme: "kowa" },
    { id: "u-1003", username: "owner", display_name: "مالک", email: "private3@example.invalid", password_hash: "NEVER-PUBLISH", role: "owner", avatar: "", bio: "", theme: "kowa" },
  ];
  const rooms = [
    { id: "public", room_type: "group", name: "میمچت عمومی", topic: "chat-mcc-kowa-v1", creator_username: "system" },
    { id: "pv-u1001-u1002", room_type: "pv", name: "پیوی", topic: "pv-u1001-u1002", creator_username: "sepehr" },
  ];
  const messages = [];
  for (let i = 1; i <= 137; i++) {
    const topic = i % 3 === 0 ? "pv-u1001-u1002" : "chat-mcc-kowa-v1";
    messages.push({
      id: "m-" + String(i).padStart(5, "0"), topic, from_id: i % 2 ? "u-1001" : "u-1002",
      sender_username: i % 2 ? "sepehr" : "nazi", sender_name: i % 2 ? "سپهر" : "نازی",
      text: "پیام قدیمی شمارهٔ " + i + " — باید دقیقاً همینجور بماند",
      meme: null, reply: i % 11 === 0 ? { id: "m-00001", text: "پاسخ" } : null,
      file: i % 17 === 0 ? { name: "old.png", type: "image/png", data: "data:image/png;base64,AAAA" } : null,
      reactions: i % 5 === 0 ? { "👍": ["u-1001"] } : {}, seen_by: ["u-1002"],
      edited: false, ts: 1700000000000 + i * 1000, sync_status: "confirmed",
    });
  }
  const settings = [{ user_id: "u-1001", theme: "kowa", priv_msg: true }, { user_id: "u-1002", theme: "kowa", priv_msg: false }];
  const stories = [{ id: "s-1", user_id: "u-1001", kind: "text", text: "استوری قدیمی", ts: 1700000000000 }];
  const sessions = [{ id: "sess-1", user_id: "u-1001" }, { id: "sess-2", user_id: "u-1002" }];
  const media = [{ id: "media-1", user_id: "u-1001", name: "old.png" }];
  /* چهار جدول قدیمی هم نمونه دارند تا تست ثابت کند هیچکدام جا نمیمانند */
  const legacy = {
    conversations: [{ id: "legacy-c1", topic: "legacy-topic", title: "گفتگوی خیلی قدیمی" }],
    conversation_members: [{ conversation_id: "legacy-c1", user_id: "u-1001" }],
    messages: [{ id: "legacy-m1", conversation_id: "legacy-c1", from_id: "u-1001", text: "پیام خیلی قدیمی", ts: 1600000000000 }],
    profile: [{ id: "p-1", user_id: "u-1001", username: "sepehr", display_name: "سپهر" }],
  };
  const tables = {
    mimchat_users: users, mimchat_rooms: rooms, mimchat_staging_messages: messages,
    mimchat_settings: settings, mimchat_stories: stories, mimchat_sessions: sessions,
    mimchat_media: media, ...legacy,
  };
  /* همان ۴۴ جدول زنده؛ بقیه خالیاند ولی در manifest و هشها میآیند */
  for (const t of LIVE_TABLES) if (!(t in tables)) tables[t] = [];
  return { tables, createdAt: "2026-11-09T00:00:00.000Z", source: "fixture" };
}
