import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_SETTINGS } from "./defaults.mjs";
import initialSettings from './initial-settings.json' with { type: 'json' };

export class Store {
  constructor(filename) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT, line_user_id TEXT NOT NULL UNIQUE, display_name TEXT,
        status TEXT NOT NULL DEFAULT 'unhandled', category TEXT NOT NULL DEFAULT 'unknown',
        assigned_to TEXT, auto_reply_count INTEGER NOT NULL DEFAULT 0,
        last_message_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id INTEGER NOT NULL, line_message_id TEXT UNIQUE,
        direction TEXT NOT NULL, sender TEXT NOT NULL, body TEXT, classification TEXT, action TEXT,
        delivery_status TEXT NOT NULL DEFAULT 'saved', created_at TEXT NOT NULL,
        FOREIGN KEY(conversation_id) REFERENCES conversations(id)
      );
      CREATE TABLE IF NOT EXISTS webhook_events (event_id TEXT PRIMARY KEY, received_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL);
    `);
    const current = this.db.prepare("SELECT id FROM settings WHERE id = 1").get();
    if (!current) this.db.prepare("INSERT INTO settings (id, json, updated_at) VALUES (1, ?, ?)").run(JSON.stringify({...DEFAULT_SETTINGS,...initialSettings}), new Date().toISOString());
  }

  getSettings() {
    const saved = JSON.parse(this.db.prepare("SELECT json FROM settings WHERE id = 1").get().json);
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      officeHours: { ...DEFAULT_SETTINGS.officeHours, ...(saved.officeHours || {}) },
      categories: { ...DEFAULT_SETTINGS.categories, ...(saved.categories || {}) }
    };
  }

  saveSettings(settings) {
    this.db.prepare("UPDATE settings SET json = ?, updated_at = ? WHERE id = 1").run(JSON.stringify(settings), new Date().toISOString());
    this.audit("settings_updated", "回答条件を更新");
  }

  claimWebhook(eventId) {
    if (!eventId) return true;
    try {
      this.db.prepare("INSERT INTO webhook_events (event_id, received_at) VALUES (?, ?)").run(eventId, new Date().toISOString());
      return true;
    } catch {
      return false;
    }
  }

  upsertConversation(lineUserId, displayName = null) {
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO conversations (line_user_id, display_name, last_message_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(line_user_id) DO UPDATE SET
      display_name = COALESCE(excluded.display_name, display_name), last_message_at = excluded.last_message_at, updated_at = excluded.updated_at`)
      .run(lineUserId, displayName, now, now, now);
    return this.db.prepare("SELECT * FROM conversations WHERE line_user_id = ?").get(lineUserId);
  }

  addMessage(conversationId, { lineMessageId = null, direction, sender, body, classification = null, action = null, deliveryStatus = "saved" }) {
    const result = this.db.prepare(`INSERT OR IGNORE INTO messages
      (conversation_id, line_message_id, direction, sender, body, classification, action, delivery_status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(conversationId, lineMessageId, direction, sender, body, classification, action, deliveryStatus, new Date().toISOString());
    return result.changes === 1 ? Number(result.lastInsertRowid) : 0;
  }

  markUnsent(lineMessageId) {
    this.db.prepare("UPDATE messages SET body = NULL, delivery_status = 'unsent' WHERE line_message_id = ?").run(lineMessageId);
  }

  updateConversation(id, patch) {
    const allowed = ["status", "category", "assigned_to", "auto_reply_count"];
    const entries = Object.entries(patch).filter(([key]) => allowed.includes(key));
    if (!entries.length) return;
    const sql = `UPDATE conversations SET ${entries.map(([key]) => `${key} = ?`).join(", ")}, updated_at = ? WHERE id = ?`;
    this.db.prepare(sql).run(...entries.map(([, value]) => value), new Date().toISOString(), id);
  }

  listConversations(status = "all", search = "") {
    const where = [];
    const params = [];
    if (status !== "all") { where.push("c.status = ?"); params.push(status); }
    if (search) { where.push("(COALESCE(c.display_name, '') LIKE ? OR COALESCE(m.body, '') LIKE ?)"); params.push(`%${search}%`, `%${search}%`); }
    return this.db.prepare(`SELECT c.*, (SELECT body FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) AS latest_body,
      (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) AS message_count
      FROM conversations c LEFT JOIN messages m ON m.conversation_id = c.id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""} GROUP BY c.id ORDER BY c.last_message_at DESC LIMIT 500`).all(...params);
  }

  getConversation(id) {
    const conversation = this.db.prepare("SELECT * FROM conversations WHERE id = ?").get(id);
    if (!conversation) return null;
    const messages = this.db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY id").all(id);
    return { ...conversation, messages };
  }

  audit(action, detail = "") {
    this.db.prepare("INSERT INTO audit_logs (action, detail, created_at) VALUES (?, ?, ?)").run(action, detail, new Date().toISOString());
  }

  dashboardCounts() {
    const rows = this.db.prepare("SELECT status, COUNT(*) AS count FROM conversations GROUP BY status").all();
    return Object.fromEntries(rows.map((row) => [row.status, row.count]));
  }
}
