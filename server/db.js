// DB層: SQLite (Node.js 標準の node:sqlite を使用、外部依存なし)
// スキーマは設計書6章に対応: users / quarters / schedule_entries
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DB_PATH = process.env.OLAB_DB ?? join(dirname(fileURLToPath(import.meta.url)), 'olab.db');

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    student_number TEXT NOT NULL UNIQUE,
    name           TEXT NOT NULL,
    role           TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'teacher')),
    grade          TEXT,              -- M2/M1/B4/B3 など。教員は NULL (表示は 'Prof')
    is_admin       INTEGER NOT NULL DEFAULT 0,
    password_hash  TEXT,              -- 独自認証に切り替えた際に使用。スタブ認証では未使用
    is_active      INTEGER NOT NULL DEFAULT 1,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS quarters (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    year       INTEGER NOT NULL,
    quarter    INTEGER NOT NULL CHECK (quarter BETWEEN 1 AND 4),
    label      TEXT NOT NULL,
    start_date TEXT,
    end_date   TEXT,
    is_active  INTEGER NOT NULL DEFAULT 0,
    UNIQUE (year, quarter)
  );

  CREATE TABLE IF NOT EXISTS schedule_entries (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    quarter_id   INTEGER NOT NULL REFERENCES quarters(id) ON DELETE CASCADE,
    day_of_week  INTEGER NOT NULL CHECK (day_of_week BETWEEN 1 AND 6),  -- 1=月 .. 6=土
    period       INTEGER NOT NULL CHECK (period BETWEEN 1 AND 5),       -- 1〜5限
    subject_name TEXT,               -- 詳細表示用。未入力可
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, quarter_id, day_of_week, period)
  );

  CREATE INDEX IF NOT EXISTS idx_entries_quarter ON schedule_entries (quarter_id);
  CREATE INDEX IF NOT EXISTS idx_entries_user_quarter ON schedule_entries (user_id, quarter_id);
`);

// グリッドの定義（設計書2.1: 月〜土 × 1〜5限）
export const DAYS = [1, 2, 3, 4, 5, 6];
export const PERIODS = [1, 2, 3, 4, 5];

// 学年ラベル: 教員は 'Prof' として扱う（既存システムの表示を踏襲）
export function gradeLabel(user) {
  return user.role === 'teacher' ? 'Prof' : (user.grade ?? '?');
}
