// APIルート（設計書8章）
// 閲覧系: 認証不要 / 編集系: 認証必須かつ本人のみ（設計書4章・5章）
import { db, DAYS, PERIODS, gradeLabel } from './db.js';
import {
  login, logout, getCurrentUser, setPassword, resetPassword, verifyPassword,
  sessionCookie, clearSessionCookie, AUTH_PROVIDER,
} from './auth.js';

// ---- 共通ヘルパ -------------------------------------------------------------

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function publicUser(u) {
  return {
    id: u.id,
    student_number: u.student_number,
    name: u.name,
    role: u.role,
    grade: u.grade,
    grade_label: gradeLabel(u),
    is_admin: !!u.is_admin,
  };
}

function getQuarterOr404(qid) {
  const q = db.prepare('SELECT * FROM quarters WHERE id = ?').get(qid);
  if (!q) throw new HttpError(404, '指定された学期が見つかりません');
  return q;
}

function resolveQuarterId(query) {
  if (query.quarter) return Number(query.quarter);
  const active = db.prepare('SELECT id FROM quarters WHERE is_active = 1 LIMIT 1').get();
  if (!active) throw new HttpError(400, 'quarter パラメータがなく、アクティブな学期も設定されていません');
  return active.id;
}

function requireLogin(req) {
  const user = getCurrentUser(req);
  if (!user) throw new HttpError(401, 'ログインが必要です');
  return user;
}

function requireSelf(req, targetUserId) {
  const user = requireLogin(req);
  if (user.id !== Number(targetUserId)) {
    throw new HttpError(403, '他人の時間割は編集できません（編集は本人のみ）');
  }
  return user;
}

function requireAdmin(req) {
  const user = requireLogin(req);
  if (!user.is_admin) throw new HttpError(403, '管理者権限が必要です');
  return user;
}

function validateCell(day, period) {
  if (!DAYS.includes(Number(day)) || !PERIODS.includes(Number(period))) {
    throw new HttpError(400, `day は 1〜${DAYS.length}(月〜土)、period は 1〜${PERIODS.length} で指定してください`);
  }
}

function quarterJson(q) {
  return {
    id: q.id,
    year: q.year,
    quarter: q.quarter,
    label: q.label,
    start_date: q.start_date,
    end_date: q.end_date,
    is_active: !!q.is_active,
  };
}

// 個人の週間時間割（設計書7.1）
function userSchedule(userId, quarterId) {
  const entries = db
    .prepare('SELECT day_of_week AS day, period, subject_name FROM schedule_entries WHERE user_id = ? AND quarter_id = ? ORDER BY day, period')
    .all(userId, quarterId);
  return { days: DAYS, periods: PERIODS, entries };
}

// ---- ルート定義 -------------------------------------------------------------
// handler(req, { params, query, body }) => { status?, headers?, json }

export const routes = [
  // ---------- 認証 ----------
  {
    method: 'POST', path: '/api/auth/login',
    handler(req, { body }) {
      const { student_number, password } = body ?? {};
      if (!student_number) throw new HttpError(400, 'student_number は必須です');
      const result = login(String(student_number), password ?? '');
      if (!result) throw new HttpError(401, 'ログインに失敗しました（学番またはパスワードを確認してください）');
      return {
        headers: { 'Set-Cookie': sessionCookie(result.token) },
        json: {
          user: publicUser(result.user),
          // false のときフロントはパスワード設定フォームへ誘導する（初回ログイン）
          password_set: result.user.password_hash != null,
          auth_provider: AUTH_PROVIDER,
        },
      };
    },
  },
  {
    // ログイン中の本人がパスワードを設定・変更する（設計書4章: 初回ログイン後に必須）
    // すでに設定済みの場合（＝変更）は current_password の照合を要求する
    method: 'POST', path: '/api/auth/set-password',
    handler(req, { body }) {
      const user = requireLogin(req);
      const password = body?.password;
      if (typeof password !== 'string' || password.length < 6) {
        throw new HttpError(400, 'パスワードは6文字以上で指定してください');
      }
      if (user.password_hash != null && !verifyPassword(body?.current_password ?? '', user.password_hash)) {
        throw new HttpError(401, '現在のパスワードが違います');
      }
      setPassword(user.id, password);
      return { json: { ok: true, password_set: true } };
    },
  },
  {
    // パスワードを忘れた場合のセルフリセット（ログイン画面から）。
    // 未設定状態に戻し、本人が学番のみで入り直して再設定する（初回ログインと同じ状態）。
    method: 'POST', path: '/api/auth/forgot-password',
    handler(req, { body }) {
      const sn = body?.student_number;
      if (!sn) throw new HttpError(400, 'student_number は必須です');
      const u = db.prepare('SELECT * FROM users WHERE student_number = ? AND is_active = 1').get(String(sn));
      if (!u) throw new HttpError(404, 'その学番は登録されていません');
      resetPassword(u.id);
      return { json: { ok: true } };
    },
  },
  {
    method: 'POST', path: '/api/auth/logout',
    handler(req) {
      logout(req);
      return { headers: { 'Set-Cookie': clearSessionCookie() }, json: { ok: true } };
    },
  },
  {
    method: 'GET', path: '/api/auth/me',
    handler(req) {
      const user = getCurrentUser(req);
      return {
        json: {
          user: user ? publicUser(user) : null,
          password_set: user ? user.password_hash != null : null,
          auth_provider: AUTH_PROVIDER,
        },
      };
    },
  },

  // ---------- 学期 ----------
  {
    method: 'GET', path: '/api/quarters',
    handler() {
      const rows = db.prepare('SELECT * FROM quarters ORDER BY year, quarter').all();
      return { json: { quarters: rows.map(quarterJson) } };
    },
  },
  {
    method: 'POST', path: '/api/quarters',
    handler(req, { body }) {
      requireAdmin(req);
      const { year, quarter, label, start_date, end_date } = body ?? {};
      if (!year || !quarter || !label) throw new HttpError(400, 'year, quarter, label は必須です');
      const info = db
        .prepare('INSERT INTO quarters (year, quarter, label, start_date, end_date) VALUES (?, ?, ?, ?, ?)')
        .run(year, quarter, label, start_date ?? null, end_date ?? null);
      const q = db.prepare('SELECT * FROM quarters WHERE id = ?').get(info.lastInsertRowid);
      return { status: 201, json: { quarter: quarterJson(q) } };
    },
  },
  {
    method: 'PATCH', path: '/api/quarters/:id',
    handler(req, { params, body }) {
      requireAdmin(req);
      const q = getQuarterOr404(params.id);
      if (body?.is_active) {
        db.exec('UPDATE quarters SET is_active = 0');
        db.prepare('UPDATE quarters SET is_active = 1 WHERE id = ?').run(q.id);
      }
      return { json: { quarter: quarterJson(db.prepare('SELECT * FROM quarters WHERE id = ?').get(q.id)) } };
    },
  },

  // ---------- ユーザー ----------
  {
    method: 'GET', path: '/api/users',
    handler(req, { query }) {
      let rows = db.prepare('SELECT * FROM users WHERE is_active = 1 ORDER BY role DESC, grade, name').all();
      if (query.grade) {
        const wanted = String(query.grade).split(',');
        rows = rows.filter((u) => wanted.includes(gradeLabel(u)));
      }
      return { json: { users: rows.map(publicUser) } };
    },
  },
  {
    method: 'GET', path: '/api/users/:id',
    handler(req, { params }) {
      const u = db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(params.id);
      if (!u) throw new HttpError(404, 'ユーザーが見つかりません');
      // entry_count は削除前の確認ダイアログ「コマ○件も一緒に消えます」に使う（設計書7.5）
      const { n } = db.prepare('SELECT COUNT(*) AS n FROM schedule_entries WHERE user_id = ?').get(u.id);
      return { json: { user: publicUser(u), entry_count: n } };
    },
  },

  // ---------- ユーザー管理（管理者のみ / 設計書7.5） ----------
  {
    method: 'POST', path: '/api/users',
    handler(req, { body }) {
      requireAdmin(req);
      const { student_number, name, grade, role } = body ?? {};
      if (!student_number || !name) throw new HttpError(400, 'student_number と name は必須です');
      const userRole = role === 'teacher' ? 'teacher' : 'student';
      if (userRole === 'student' && !grade) throw new HttpError(400, '学生には grade (B3/B4/M1/M2 など) が必須です');
      let info;
      try {
        info = db
          .prepare('INSERT INTO users (student_number, name, role, grade) VALUES (?, ?, ?, ?)')
          .run(String(student_number), String(name), userRole, userRole === 'teacher' ? null : String(grade));
      } catch (err) {
        if (String(err.message).includes('UNIQUE')) throw new HttpError(409, `学番 ${student_number} は登録済みです`);
        throw err;
      }
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
      return { status: 201, json: { user: publicUser(u) } };
    },
  },
  {
    // 本人（自分のプロフィール: 学番・氏名・学年）または管理者が編集できる
    method: 'PATCH', path: '/api/users/:id',
    handler(req, { params, body }) {
      const actor = requireLogin(req);
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(params.id);
      if (!u) throw new HttpError(404, 'ユーザーが見つかりません');
      const isSelf = actor.id === u.id;
      if (!isSelf && !actor.is_admin) throw new HttpError(403, '自分の情報のみ編集できます');
      if ((body?.is_active !== undefined || body?.is_admin !== undefined) && !actor.is_admin) {
        throw new HttpError(403, 'この項目は管理者のみ変更できます');
      }
      const name = body?.name ?? u.name;
      const grade = body?.grade !== undefined ? body.grade : u.grade;
      const studentNumber = body?.student_number ?? u.student_number;
      const isActive = body?.is_active !== undefined ? (body.is_active ? 1 : 0) : u.is_active;
      const isAdmin = body?.is_admin !== undefined ? (body.is_admin ? 1 : 0) : u.is_admin;
      try {
        db.prepare(
          "UPDATE users SET name = ?, grade = ?, student_number = ?, is_active = ?, is_admin = ?, updated_at = datetime('now') WHERE id = ?"
        ).run(name, grade, String(studentNumber), isActive, isAdmin, u.id);
      } catch (err) {
        if (String(err.message).includes('UNIQUE')) throw new HttpError(409, `学番 ${studentNumber} は既に使われています`);
        throw err;
      }
      return { json: { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)) } };
    },
  },
  {
    // 物理削除。受講コマも ON DELETE CASCADE で全学期分消える（設計書7.5、取り消し不可）
    method: 'DELETE', path: '/api/users/:id',
    handler(req, { params }) {
      const admin = requireAdmin(req);
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(params.id);
      if (!u) throw new HttpError(404, 'ユーザーが見つかりません');
      if (u.id === admin.id) throw new HttpError(400, '自分自身は削除できません（別の管理者に依頼してください）');
      const { n } = db.prepare('SELECT COUNT(*) AS n FROM schedule_entries WHERE user_id = ?').get(u.id);
      db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
      return { json: { ok: true, deleted_user: u.name, deleted_entries: n } };
    },
  },
  // ---------- 年度更新（管理者のみ / 設計書7.5(b)） ----------
  {
    // 卒業生削除・進級・新入生追加・新年度クォーター作成をトランザクションで一括適用
    method: 'POST', path: '/api/admin/year-rollover',
    handler(req, { body }) {
      const admin = requireAdmin(req);
      const { new_year, delete_user_ids = [], promotions = [], new_members = [] } = body ?? {};
      if (!Number.isInteger(new_year)) throw new HttpError(400, 'new_year (整数の年度) は必須です');
      if (delete_user_ids.some((id) => Number(id) === admin.id)) {
        throw new HttpError(400, '自分自身は削除できません');
      }

      db.exec('BEGIN');
      try {
        // 1. 卒業生の削除（コマはCASCADEで消える）
        const delStmt = db.prepare('DELETE FROM users WHERE id = ?');
        let deleted = 0;
        for (const id of delete_user_ids) deleted += delStmt.run(Number(id)).changes;

        // 2. 在校生の進級
        const promoteStmt = db.prepare(
          "UPDATE users SET grade = ?, updated_at = datetime('now') WHERE id = ? AND role = 'student'"
        );
        let promoted = 0;
        for (const p of promotions) {
          if (!p?.user_id || !p?.new_grade) throw new HttpError(400, 'promotions は {user_id, new_grade} の配列で指定してください');
          promoted += promoteStmt.run(String(p.new_grade), Number(p.user_id)).changes;
        }

        // 3. 新入生の追加（パスワード未設定で作成 = 初回は学番のみでログイン可能）
        const addStmt = db.prepare('INSERT INTO users (student_number, name, role, grade) VALUES (?, ?, ?, ?)');
        let added = 0;
        for (const m of new_members) {
          if (!m?.student_number || !m?.name || !m?.grade) {
            throw new HttpError(400, 'new_members は {student_number, name, grade} の配列で指定してください');
          }
          try {
            addStmt.run(String(m.student_number), String(m.name), 'student', String(m.grade));
          } catch (err) {
            if (String(err.message).includes('UNIQUE')) throw new HttpError(409, `学番 ${m.student_number} は登録済みです`);
            throw err;
          }
          added++;
        }

        // 4. 新年度のクォーターを作成し、新1Qをアクティブに
        const labels = ['前期前半(1Q)', '前期後半(2Q)', '後期前半(3Q)', '後期後半(4Q)'];
        const insQ = db.prepare('INSERT OR IGNORE INTO quarters (year, quarter, label) VALUES (?, ?, ?)');
        labels.forEach((label, i) => insQ.run(new_year, i + 1, `${new_year}年度${label}`));
        db.exec('UPDATE quarters SET is_active = 0');
        db.prepare('UPDATE quarters SET is_active = 1 WHERE year = ? AND quarter = 1').run(new_year);

        db.exec('COMMIT');
        return {
          json: {
            ok: true,
            deleted_users: deleted,
            promoted_users: promoted,
            added_users: added,
            new_year,
          },
        };
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
  },

  // ---------- 個人の時間割（閲覧: 認証不要 = スポット表示にも使用） ----------
  {
    method: 'GET', path: '/api/users/:id/schedule',
    handler(req, { params, query }) {
      const quarterId = resolveQuarterId(query);
      const q = getQuarterOr404(quarterId);
      const u = db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(params.id);
      if (!u) throw new HttpError(404, 'ユーザーが見つかりません');
      return { json: { user: publicUser(u), quarter: quarterJson(q), ...userSchedule(u.id, q.id) } };
    },
  },

  // ---------- 個人の時間割（編集: 認証必須・本人のみ） ----------
  {
    // 一括保存: entries を丸ごと置き換える（画面3の「保存」ボタン用）
    method: 'PUT', path: '/api/users/:id/schedule',
    handler(req, { params, query, body }) {
      const user = requireSelf(req, params.id);
      const quarterId = resolveQuarterId(query);
      getQuarterOr404(quarterId);
      const entries = body?.entries;
      if (!Array.isArray(entries)) throw new HttpError(400, 'entries (配列) が必要です');
      for (const e of entries) validateCell(e.day, e.period);

      db.exec('BEGIN');
      try {
        db.prepare('DELETE FROM schedule_entries WHERE user_id = ? AND quarter_id = ?').run(user.id, quarterId);
        const ins = db.prepare(
          'INSERT OR IGNORE INTO schedule_entries (user_id, quarter_id, day_of_week, period, subject_name) VALUES (?, ?, ?, ?, ?)'
        );
        for (const e of entries) ins.run(user.id, quarterId, e.day, e.period, e.subject_name ?? null);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      return { json: userSchedule(user.id, quarterId) };
    },
  },
  {
    // コマ1つ登録/更新（クリックでのトグルON・科目名変更）
    method: 'POST', path: '/api/users/:id/schedule/cell',
    handler(req, { params, query, body }) {
      const user = requireSelf(req, params.id);
      const quarterId = resolveQuarterId(query);
      getQuarterOr404(quarterId);
      const { day, period, subject_name } = body ?? {};
      validateCell(day, period);
      db.prepare(`
        INSERT INTO schedule_entries (user_id, quarter_id, day_of_week, period, subject_name)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (user_id, quarter_id, day_of_week, period)
        DO UPDATE SET subject_name = excluded.subject_name, updated_at = datetime('now')
      `).run(user.id, quarterId, day, period, subject_name ?? null);
      return { status: 201, json: userSchedule(user.id, quarterId) };
    },
  },
  {
    // コマ1つ削除（クリックでのトグルOFF）
    method: 'DELETE', path: '/api/users/:id/schedule/cell',
    handler(req, { params, query, body }) {
      const user = requireSelf(req, params.id);
      const quarterId = resolveQuarterId(query);
      const day = body?.day ?? query.day;
      const period = body?.period ?? query.period;
      validateCell(day, period);
      db.prepare(
        'DELETE FROM schedule_entries WHERE user_id = ? AND quarter_id = ? AND day_of_week = ? AND period = ?'
      ).run(user.id, quarterId, day, period);
      return { json: userSchedule(user.id, quarterId) };
    },
  },

  // ---------- 全体図（設計書7.2 / 認証不要） ----------
  {
    method: 'GET', path: '/api/overview',
    handler(req, { query }) {
      const quarterId = resolveQuarterId(query);
      const q = getQuarterOr404(quarterId);
      const mode = query.mode === 'detail' ? 'detail' : 'summary';
      // grades= が空で渡された場合は「全解除」= 何も表示しない（パラメータ無しなら全表示）
      const gradeFilter = query.grades !== undefined
        ? String(query.grades).split(',').filter(Boolean)
        : null;

      const rows = db.prepare(`
        SELECT e.day_of_week AS day, e.period, e.subject_name, u.id AS user_id, u.name, u.role, u.grade
        FROM schedule_entries e JOIN users u ON u.id = e.user_id
        WHERE e.quarter_id = ? AND u.is_active = 1
        ORDER BY e.day_of_week, e.period, u.role DESC, u.grade, u.name
      `).all(q.id);

      const byCell = new Map();
      for (const r of rows) {
        const label = gradeLabel(r);
        if (gradeFilter && !gradeFilter.includes(label)) continue;
        const key = `${r.day}-${r.period}`;
        if (!byCell.has(key)) byCell.set(key, { day: r.day, period: r.period, grades: [], entries: [] });
        const cell = byCell.get(key);
        cell.grades.push(label);
        if (mode === 'detail') {
          cell.entries.push({ user_id: r.user_id, name: r.name, grade: label, subject_name: r.subject_name });
        }
      }

      const cells = [...byCell.values()].map((c) => ({
        day: c.day,
        period: c.period,
        grades: c.grades,
        count: c.grades.length,
        ...(mode === 'detail' ? { entries: c.entries } : {}),
      }));

      return { json: { quarter: quarterJson(q), mode, days: DAYS, periods: PERIODS, cells } };
    },
  },

  // ---------- 共通空きコマ検索（設計書7.3 / 認証不要） ----------
  {
    method: 'GET', path: '/api/free',
    handler(req, { query }) {
      const quarterId = resolveQuarterId(query);
      const q = getQuarterOr404(quarterId);
      if (!query.users) throw new HttpError(400, 'users パラメータ（例: users=1,2,3）が必要です');
      const userIds = String(query.users).split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
      if (userIds.length === 0) throw new HttpError(400, 'users に有効なユーザーIDがありません');

      const placeholders = userIds.map(() => '?').join(',');
      const rows = db.prepare(`
        SELECT e.day_of_week AS day, e.period, u.id AS user_id, u.name
        FROM schedule_entries e JOIN users u ON u.id = e.user_id
        WHERE e.quarter_id = ? AND e.user_id IN (${placeholders})
      `).all(q.id, ...userIds);

      const busy = new Map();
      for (const r of rows) {
        const key = `${r.day}-${r.period}`;
        if (!busy.has(key)) busy.set(key, []);
        busy.get(key).push({ user_id: r.user_id, name: r.name });
      }

      const free = [];
      for (const day of DAYS) {
        for (const period of PERIODS) {
          if (!busy.has(`${day}-${period}`)) free.push({ day, period });
        }
      }
      return { json: { quarter: quarterJson(q), user_ids: userIds, days: DAYS, periods: PERIODS, free_cells: free } };
    },
  },
];

export { HttpError };
