// E2Eテスト: 実ブラウザ(Chromium headless)で主要フローを検証する
// 前提: サーバが BASE (既定 http://localhost:3000) で起動していること
// 実行: cd e2e && npm install && node run.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:3000';
const results = [];

async function step(name, fn) {
  try {
    await fn();
    results.push(['PASS', name]);
    console.log(`  ✅ ${name}`);
  } catch (err) {
    results.push(['FAIL', name]);
    console.log(`  ❌ ${name}\n     ${String(err.message).split('\n')[0]}`);
  }
}

const browser = await chromium.launch();
const page = await browser.newPage();
page.setDefaultTimeout(8000);

// 一意なテストユーザー（毎回作り直す）
const SNUM = `E2E${Date.now() % 1000000}`;

console.log(`E2Eテスト開始: ${BASE}`);

// ---- 画面1: 全体図 ----
await step('全体図が表示され学年バッジがある', async () => {
  await page.goto(BASE);
  await page.waitForSelector('table.timetable');
  const badges = await page.locator('table.timetable .badge').count();
  if (badges === 0) throw new Error('バッジが1つも無い');
});

await step('土曜にデータがなければ土曜列が非表示になる', async () => {
  const headers = await page.locator('table.timetable tr:first-child th').allTextContents();
  if (headers.includes('土')) throw new Error('土曜列が表示されている');
  if (!headers.includes('金')) throw new Error('金曜列が見つからない');
});

await step('学期タブで切替できる（ページ遷移なし）', async () => {
  const before = await page.textContent('#view-title');
  await page.click('.qtabs button:nth-child(2)'); // 2Q
  await page.waitForFunction(
    (prev) => document.querySelector('#view-title')?.textContent !== prev, before);
  await page.click('.qtabs button:nth-child(1)'); // 1Qへ戻す
  await page.waitForSelector('table.timetable');
});

await step('学年フィルタを全部外すと何も表示されない', async () => {
  for (const box of await page.locator('.gf').all()) await box.uncheck();
  await page.waitForFunction(() => document.querySelectorAll('table.timetable .badge').length === 0);
  for (const box of await page.locator('.gf').all()) await box.check(); // 戻す
  await page.waitForFunction(() => document.querySelectorAll('table.timetable .badge').length > 0);
});

await step('ハイライトONで空きコマが黄色くなる', async () => {
  await page.check('#highlight');
  await page.waitForSelector('table.timetable td.free.hl');
  await page.uncheck('#highlight');
});

await step('授業名モードで科目カードが表示される', async () => {
  await page.selectOption('#mode', 'subject');
  await page.waitForSelector('.subj-card');
  const labels = await page.locator('.subj-card .subject-label').count();
  if (labels === 0) throw new Error('科目名ラベルが表示されない');
  // バッジに氏名のtitle属性がある
  const title = await page.locator('.subj-badges .badge').first().getAttribute('title');
  if (!title) throw new Error('バッジにtitle属性がない');
});

await step('サマリ→詳細で氏名が表示される', async () => {
  await page.selectOption('#mode', 'summary');
  await page.waitForSelector('table.timetable');
  await page.selectOption('#mode', 'detail');
  await page.waitForSelector('.badge-detail');
  await page.selectOption('#mode', 'summary'); // デフォルトに戻す
});

await step('スポット表示で個人の時間割になる', async () => {
  const first = await page.locator('#spot option:nth-child(2)').getAttribute('value');
  await page.selectOption('#spot', first);
  await page.waitForFunction(() => document.querySelector('#view-title')?.textContent.includes('の時間割'));
  await page.selectOption('#spot', '');
});

// ---- 画面2: 新規登録 → 画面3: コマ登録 ----
await step('新規登録できてそのまま入力画面へ', async () => {
  await page.click('#go-edit');
  await page.waitForURL('**/login.html');
  await page.click('#show-register');
  await page.fill('#r-snum', SNUM);
  await page.fill('#r-name', 'E2Eテスト太郎');
  await page.selectOption('#r-grade', 'B3');
  await page.fill('#r-pw', 'e2epass123');
  await page.fill('#r-pw2', 'e2epass123');
  await page.click('#register-btn');
  await page.waitForURL('**/edit.html');
  await page.waitForSelector('table.timetable');
});

await step('セルに科目名を入力して一括保存できる', async () => {
  // 月1限のinputに科目名を入力
  const input = page.locator('table.timetable tr:nth-child(2) td:first-of-type .cell-input');
  await input.fill('E2E科目');
  // 保存ボタンが有効になっていることを確認
  await page.waitForFunction(() => !document.getElementById('save-btn').disabled);
  await page.click('#save-btn');
  // 保存後、値が保持されていることを確認
  await page.waitForFunction(() => document.getElementById('save-status')?.textContent.includes('保存しました'));
  const val = await input.inputValue();
  if (val !== 'E2E科目') throw new Error(`保存後の値が違う: ${val}`);
});

await step('セルを空にして保存するとコマが削除される', async () => {
  const input = page.locator('table.timetable tr:nth-child(2) td:first-of-type .cell-input');
  await input.fill('');
  await page.click('#save-btn');
  await page.waitForFunction(() => document.getElementById('save-status')?.textContent.includes('保存しました'));
  const val = await input.inputValue();
  if (val !== '') throw new Error(`削除後の値が空でない: ${val}`);
});

await step('科目サジェストのドロップダウンが表示される', async () => {
  // まず科目を登録して、サジェスト候補があるようにする
  const input = page.locator('table.timetable tr:nth-child(2) td:first-of-type .cell-input');
  await input.fill('サジェスト確認用');
  await page.click('#save-btn');
  await page.waitForFunction(() => document.getElementById('save-status')?.textContent.includes('保存しました'));
  // 同じセルをクリアしてフォーカスするとドロップダウンが出る
  await input.fill('');
  await input.focus();
  await page.waitForSelector('.suggest-dropdown.open');
  const items = await page.locator('.suggest-dropdown.open .suggest-item').count();
  if (items === 0) throw new Error('サジェスト候補が表示されない');
  // 後片付け: セルを空にして保存
  await input.fill('');
  await page.click('#save-btn');
  await page.waitForFunction(() => document.getElementById('save-status')?.textContent.includes('保存しました'));
});

await step('他ユーザーを選択するとプレビューが表示される', async () => {
  // コピー元セレクトに他ユーザーが表示されていることを確認
  const options = await page.locator('#copy-src option').count();
  if (options < 2) throw new Error('コピー元の選択肢が少ない');
  // 自分が含まれていないことを確認
  const selfOption = await page.locator(`#copy-src option:text-is("${SNUM}")`).count();
  if (selfOption > 0) throw new Error('自分がコピー元に含まれている');
  // ユーザーを選択するとプレビューモードになる
  const firstValue = await page.locator('#copy-src option:nth-child(2)').getAttribute('value');
  await page.selectOption('#copy-src', firstValue);
  await page.waitForSelector('#grid.previewing');
  // セルにプレビューデータが表示される
  await page.waitForFunction(() => {
    const inputs = document.querySelectorAll('.cell-input');
    return [...inputs].some((i) => i.value !== '');
  });
  // 取り消しボタンとコピーボタンが表示される
  await page.waitForSelector('#preview-cancel:visible');
  await page.waitForSelector('#preview-apply:visible');
  // 取り消しでプレビューが解除されセルが元に戻る
  await page.click('#preview-cancel');
  await page.waitForFunction(() => !document.getElementById('grid').classList.contains('previewing'));
  const allEmpty = await page.evaluate(() =>
    [...document.querySelectorAll('.cell-input')].every((i) => i.value === ''));
  if (!allEmpty) throw new Error('取り消し後にセルが空に戻っていない');
});

await step('プレビューからコピーを確定して保存できる', async () => {
  // 再度プレビュー
  const firstValue = await page.locator('#copy-src option:nth-child(2)').getAttribute('value');
  await page.selectOption('#copy-src', firstValue);
  await page.waitForSelector('#grid.previewing');
  // コピーを確定
  await page.click('#preview-apply');
  await page.waitForFunction(() => !document.getElementById('grid').classList.contains('previewing'));
  // 少なくとも1つのセルに値が入っていること
  const hasValues = await page.evaluate(() =>
    [...document.querySelectorAll('.cell-input')].some((i) => i.value !== ''));
  if (!hasValues) throw new Error('コピー確定後にセルが空');
  // 保存できること
  await page.click('#save-btn');
  await page.waitForFunction(() => document.getElementById('save-status')?.textContent.includes('保存しました'));
  // 後片付け: 全セルを空にして保存
  await page.evaluate(() => {
    document.querySelectorAll('.cell-input').forEach((i) => { i.value = ''; i.dispatchEvent(new Event('input')); });
  });
  await page.click('#save-btn');
  await page.waitForFunction(() => document.getElementById('save-status')?.textContent.includes('保存しました'));
});

// ---- 画面5: プロフィール ----
await step('プロフィールで氏名を変更できる', async () => {
  await page.goto(`${BASE}/profile.html`);
  await page.fill('#p-name', 'E2Eテスト改名');
  await page.click('#p-save');
  await page.waitForSelector('.ok-msg:not(:empty)');
});

// ---- ログアウト → 学番＋パスワードで再ログイン ----
await step('ログアウト後、学番+パスワードで再ログインできる', async () => {
  await page.click('#nav-logout');
  await page.waitForURL(`${BASE}/`);
  await page.goto(`${BASE}/login.html`);
  await page.fill('#snum', SNUM);
  await page.fill('#pw', 'e2epass123');
  await page.click('#login-btn');
  await page.waitForURL('**/edit.html');
});

await step('間違ったパスワードは弾かれる', async () => {
  await page.click('#nav-logout');
  await page.goto(`${BASE}/login.html`);
  await page.fill('#snum', SNUM);
  await page.fill('#pw', 'wrongpass');
  await page.click('#login-btn');
  await page.waitForFunction(() => document.querySelector('#login-err')?.textContent.length > 0);
});

// ---- 管理画面（一般ユーザーは入れない） ----
await step('一般ユーザーは管理画面に入れずトップへ戻される', async () => {
  await page.fill('#pw', 'e2epass123');
  await page.click('#login-btn');
  await page.waitForURL('**/edit.html');
  await page.goto(`${BASE}/admin.html`);
  await page.waitForURL(`${BASE}/`); // リダイレクトされる
});

// ---- 後片付け: テストユーザーをAPIで削除（管理者権限が要るためT0001を使用） ----
await step('後片付け（テストユーザー削除）', async () => {
  // T0001はconfig記載の管理者。seed直後はパスワード未設定なので学番のみで入れる。
  // 既にパスワードが設定されていた場合はforgotでリセットしてから入る。
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  let res = await p.request.post(`${BASE}/api/auth/login`, { data: { student_number: 'T0001' } });
  if (!res.ok()) {
    await p.request.post(`${BASE}/api/auth/forgot-password`, { data: { student_number: 'T0001' } });
    res = await p.request.post(`${BASE}/api/auth/login`, { data: { student_number: 'T0001' } });
  }
  const users = await (await p.request.get(`${BASE}/api/users`)).json();
  const target = users.users.find((u) => u.student_number === SNUM);
  if (target) await p.request.delete(`${BASE}/api/users/${target.id}`);
  await ctx.close();
});

await browser.close();

const fails = results.filter(([s]) => s === 'FAIL').length;
console.log(`\n結果: ${results.length - fails}/${results.length} 件成功`);
process.exit(fails ? 1 : 0);
