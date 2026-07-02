// サンプルデータ投入（動作確認用）
// - CLIから: node seed.js   （既存データを消して入れ直す）
// - サーバ起動時に自動: 開発モードでユーザーが0件のとき server.js から populateSampleData() が呼ばれる
import { pathToFileURL } from 'node:url';
import { db, DAYS, PERIODS } from './db.js';

// サンプルデータで初期化する（既存データは消してから入れ直す）。
// DELETE→多数INSERT を1トランザクションにまとめ、途中失敗時は元に戻す（中途半端な状態を残さない）
export function populateSampleData() {
  db.exec('BEGIN');
  try {
    const result = buildSampleData();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function buildSampleData() {
  db.exec('DELETE FROM schedule_entries; DELETE FROM quarters; DELETE FROM users;');

// ---- 学期: 2026年度 1Q〜4Q（1Q をアクティブに） ----
const insQ = db.prepare('INSERT INTO quarters (year, quarter, label, is_active) VALUES (?, ?, ?, ?)');
const quarterLabels = ['前期前半(1Q)', '前期後半(2Q)', '後期前半(3Q)', '後期後半(4Q)'];
const quarterIds = quarterLabels.map((label, i) =>
  Number(insQ.run(2026, i + 1, `2026年度${label}`, i === 0 ? 1 : 0).lastInsertRowid)
);

// ---- ユーザー: 教員1 + M2×2 + M1×2 + B4×4 + B3×10 ----
const insU = db.prepare(
  'INSERT INTO users (student_number, name, role, grade, is_admin) VALUES (?, ?, ?, ?, ?)'
);
const users = [];
function addUser(studentNumber, name, role, grade, isAdmin = 0) {
  const id = Number(insU.run(studentNumber, name, role, grade, isAdmin).lastInsertRowid);
  users.push({ id, name, role, grade });
  return id;
}

addUser('T0001', '加藤教授', 'teacher', null, 1); // 教員 = 管理者を兼ねる
addUser('M2001', '佐藤 一郎', 'student', 'M2');
addUser('M2002', '鈴木 二郎', 'student', 'M2');
addUser('M1001', '高橋 三郎', 'student', 'M1');
addUser('M1002', '田中 四郎', 'student', 'M1');
for (let i = 1; i <= 4; i++) addUser(`B4${String(i).padStart(3, '0')}`, `B4学生${i}`, 'student', 'B4');
for (let i = 1; i <= 10; i++) addUser(`B3${String(i).padStart(3, '0')}`, `B3学生${i}`, 'student', 'B3');

// ---- 受講コマ: 学年ごとにそれっぽく登録（1Q中心、2Qにも少し） ----
const insE = db.prepare(
  'INSERT OR IGNORE INTO schedule_entries (user_id, quarter_id, day_of_week, period, subject_name) VALUES (?, ?, ?, ?, ?)'
);

const subjects = ['画像処理特論', '知能情報学', '信号処理', 'データ解析', '実験A', '実験B', 'ゼミ資料講読', '応用数学', 'プログラミング演習', '研究基礎'];
// 擬似乱数（毎回同じデータになるよう固定シード）
let seedVal = 42;
function rand() {
  seedVal = (seedVal * 1103515245 + 12345) % 2 ** 31;
  return seedVal / 2 ** 31;
}
function pick(arr) {
  return arr[Math.floor(rand() * arr.length)];
}

// 学年が下ほどコマ数が多い（画像の傾向: B3が最も埋まっている）
const countByGrade = { B3: 12, B4: 7, M1: 4, M2: 3 };

for (const u of users) {
  const isTeacher = u.role === 'teacher';
  const target = isTeacher ? 6 : countByGrade[u.grade];
  let placed = 0;
  let guard = 0;
  while (placed < target && guard++ < 200) {
    const day = pick(DAYS.slice(0, 5)); // 月〜金に配置（土は空けておく）
    const period = pick(PERIODS.slice(0, 4)); // 5限は空きがちに
    const info = insE.run(u.id, quarterIds[0], day, period, isTeacher ? '担当講義' : pick(subjects));
    if (info.changes > 0) placed++;
  }
  // 2Q にも半分くらい入れておく（クォーター切替の確認用）
  placed = 0;
  guard = 0;
  while (placed < Math.ceil(target / 2) && guard++ < 200) {
    const day = pick(DAYS.slice(0, 5));
    const period = pick(PERIODS.slice(0, 4));
    const info = insE.run(u.id, quarterIds[1], day, period, isTeacher ? '担当講義' : pick(subjects));
    if (info.changes > 0) placed++;
  }
}

  const nUsers = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const nEntries = db.prepare('SELECT COUNT(*) AS n FROM schedule_entries').get().n;
  return { users: nUsers, entries: nEntries };
}

// CLIとして直接実行されたときだけ投入してログを出す（import時には実行しない）。
// pathToFileURL でパスのスペース/Windows差異を吸収して比較する
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = populateSampleData();
  console.log(`投入完了: users=${r.users}, quarters=4, schedule_entries=${r.entries}`);
  console.log('仮ログイン用の学番例: B3001 / M1001 / T0001(教員・管理者)');
}
