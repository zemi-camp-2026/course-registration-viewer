// 認証層（設計書4章: 抽象化レイヤ）
//
// 本体ロジックはこのファイルの公開APIだけに依存する。
// 認証フロー（確定済み・既存システム踏襲）:
//   1. 管理者がメンバー登録（パスワード未設定 = password_hash が NULL）
//   2. 本人は初回、学番だけでログインできる（未設定の間のみ）
//   3. ログイン後にパスワードを設定（scryptハッシュでDB保存。平文保存はしない）
//   4. 以降は学番＋パスワードで認証
// 未登録の学番ではログインできない。
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db } from './db.js';
import { ADMIN_STUDENT_NUMBERS } from './config.js';

// stub = 開発用（パスワードを一切見ない）。既定は本番方式 'password'。
const AUTH_PROVIDER = process.env.OLAB_AUTH ?? 'password';

const SESSION_COOKIE = 'olab_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30日

// セッションはインメモリ（50人弱規模なら十分。サーバ再起動で全員ログアウトするだけ）
const sessions = new Map(); // token -> { userId, expiresAt }

function parseCookies(req) {
  const header = req.headers.cookie ?? '';
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// ---- パスワードハッシュ（Node標準 scrypt / 外部ライブラリ不要） -------------

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, expected] = String(stored).split(':');
  if (!salt || !expected) return false;
  const actual = scryptSync(password, salt, 64);
  const expectedBuf = Buffer.from(expected, 'hex');
  return actual.length === expectedBuf.length && timingSafeEqual(actual, expectedBuf);
}

// ---- 認証プロバイダ実装 ----------------------------------------------------

function findActiveUser(studentNumber) {
  return db
    .prepare('SELECT * FROM users WHERE student_number = ? AND is_active = 1')
    .get(studentNumber) ?? null;
}

const providers = {
  // 本番方式: パスワード未設定なら学番のみで成功（初回ログイン）、設定済みなら照合。
  password: {
    authenticate(studentNumber, password) {
      const user = findActiveUser(studentNumber);
      if (!user) return null; // 未登録の学番は拒否
      if (user.password_hash == null) return user; // 初回ログイン（未設定）
      return verifyPassword(password ?? '', user.password_hash) ? user : null;
    },
  },

  // 開発用スタブ: 学番が存在すれば常に成功。
  stub: {
    authenticate(studentNumber, _password) {
      return findActiveUser(studentNumber);
    },
  },
};

// ---- 公開API（本体ロジックはここだけを使う）--------------------------------

// config.js の管理者リストと is_admin フラグを同期する（ログイン・登録のたびに反映）
function syncAdminFlag(user) {
  const shouldBeAdmin = ADMIN_STUDENT_NUMBERS.includes(user.student_number) ? 1 : 0;
  if (user.is_admin !== shouldBeAdmin) {
    db.prepare("UPDATE users SET is_admin = ?, updated_at = datetime('now') WHERE id = ?")
      .run(shouldBeAdmin, user.id);
    user.is_admin = shouldBeAdmin;
  }
  return user;
}

// セッションを発行して Cookie 用トークンを返す
export function createSession(user) {
  const token = randomBytes(32).toString('hex');
  sessions.set(token, { userId: user.id, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

// ログイン: 成功したら { user, token } を返す。失敗は null。
export function login(studentNumber, password) {
  const user = providers[AUTH_PROVIDER].authenticate(studentNumber, password);
  if (!user) return null;
  syncAdminFlag(user);
  return { user, token: createSession(user) };
}

// 新規登録（セルフサインアップ）: ユーザー作成＋パスワード設定＋ログインまで行う。
// 学番が config.js の管理者リストにあれば管理者権限を自動付与。
export function register({ studentNumber, name, role, grade, password }) {
  const info = db.prepare(
    'INSERT INTO users (student_number, name, role, grade, password_hash, is_admin) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    studentNumber, name, role, grade,
    hashPassword(password),
    ADMIN_STUDENT_NUMBERS.includes(studentNumber) ? 1 : 0
  );
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  return { user, token: createSession(user) };
}

// パスワード設定・変更（本人がログイン済みであることは呼び出し側で保証する）
export function setPassword(userId, password) {
  db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
    .run(hashPassword(password), userId);
}

// パスワードリセット: 未設定状態に戻す（管理者用。本人が次回学番のみで入って再設定）
export function resetPassword(userId) {
  db.prepare("UPDATE users SET password_hash = NULL, updated_at = datetime('now') WHERE id = ?")
    .run(userId);
}

export function logout(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) sessions.delete(token);
}

// 現在のログインユーザーを返す（未ログインなら null）。閲覧系はこれが null でも動く。
export function getCurrentUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(session.userId) ?? null;
}

export function sessionCookie(token) {
  // HttpOnly + SameSite=Lax（設計書4章）。HTTPS運用にしたら Secure を追加する。
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export { AUTH_PROVIDER };
