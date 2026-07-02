// 共通ヘルパ: API呼び出し / ヘッダー描画 / 素材差し替え / バッジ生成
const DAY_NAMES = { 1: '月', 2: '火', 3: '水', 4: '木', 5: '金', 6: '土' };
const GRADE_ORDER = { Prof: 0, M2: 1, M1: 2, B4: 3, B3: 4 };

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

// 仮素材（インラインSVG）。/assets/ に本物のPNGが置かれたら自動でそちらを使う。
const FLASK_SVG = `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M26 8h12M28 8v14L14 46a8 8 0 0 0 7 12h22a8 8 0 0 0 7-12L36 22V8"
    stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M21 40h22" stroke="#fff" stroke-width="4" stroke-linecap="round"/>
  <circle cx="28" cy="48" r="2.4" fill="#fff"/><circle cx="37" cy="50" r="1.8" fill="#fff"/>
</svg>`;
const SQUIGGLE_SVG = (color) => `<svg viewBox="0 0 200 30" xmlns="http://www.w3.org/2000/svg">
  <path d="M4 20 q 12 -14 24 0 t 24 0 t 24 0 t 24 0 t 24 0 t 24 0 t 24 0"
    stroke="${color}" stroke-width="3" fill="none" stroke-linecap="round"/>
  <circle cx="185" cy="8" r="2.5" fill="${color}"/><circle cx="193" cy="16" r="2" fill="${color}"/>
</svg>`;

function swapAssetIfExists(el, url) {
  const img = new Image();
  img.onload = () => { el.innerHTML = ''; el.style.background = `center / contain no-repeat url(${url})`; };
  img.src = url;
}

// ヘッダー・フッターを描画。active: 'home' | 'edit' | 'admin' | null
async function renderChrome(active) {
  const header = document.createElement('header');
  header.className = 'site-header';
  header.innerHTML = `
    <div class="logo">${FLASK_SVG}</div>
    <h1>受講科目登録・閲覧システム</h1>
    <div class="squiggle" style="display:flex;align-items:center">${SQUIGGLE_SVG('#ffffff')}</div>
    <nav id="site-nav"><a href="/">ホーム</a></nav>`;
  document.body.prepend(header);

  const footer = document.createElement('footer');
  footer.className = 'site-footer';
  footer.innerHTML = `
    <div class="squiggle" style="display:flex;align-items:center">${SQUIGGLE_SVG('#e8973a')}</div>
    <span>© Olab</span>
    <div class="squiggle flip" style="display:flex;align-items:center">${SQUIGGLE_SVG('#e8973a')}</div>`;
  document.body.append(footer);

  // 本物の素材があれば差し替え（ChatGPT抽出のPNGを /assets/ に置くだけで反映される）
  swapAssetIfExists(header.querySelector('.logo'), '/assets/logo-flask.png');
  swapAssetIfExists(header.querySelector('.squiggle'), '/assets/squiggle-header.png');
  for (const el of footer.querySelectorAll('.squiggle')) swapAssetIfExists(el, '/assets/squiggle-footer.png');

  // ログイン状態に応じてナビを組む
  const nav = header.querySelector('#site-nav');
  try {
    const me = await api('/api/auth/me');
    window.currentUser = me.user;
    window.passwordSet = me.password_set;
    if (me.user) {
      if (me.user.is_admin) nav.insertAdjacentHTML('beforeend', ` <a href="/admin.html">管理</a>`);
      nav.insertAdjacentHTML('beforeend',
        ` <a href="/profile.html" title="プロフィール">👤 ${me.user.name}</a> <a href="#" id="nav-logout">ログアウト</a>`);
      nav.querySelector('#nav-logout').addEventListener('click', async (e) => {
        e.preventDefault();
        await api('/api/auth/logout', { method: 'POST' });
        location.href = '/';
      });
    } else {
      nav.insertAdjacentHTML('beforeend', ` <a href="/login.html">ログイン</a>`);
    }
  } catch { /* 未ログイン扱い */ }
  return window.currentUser ?? null;
}

function badge(grade) {
  return `<span class="badge ${grade}">${grade === 'Prof' ? 'Prof' : grade}</span>`;
}

function sortGrades(grades) {
  return [...grades].sort((a, b) => (GRADE_ORDER[a] ?? 9) - (GRADE_ORDER[b] ?? 9));
}

// すべての password 入力に「目マーク」の表示切替を付ける
function initPwEyes() {
  for (const input of document.querySelectorAll('input[type="password"]')) {
    if (input.closest('.pw-wrap')) continue;
    const wrap = document.createElement('span');
    wrap.className = 'pw-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    const eye = document.createElement('button');
    eye.type = 'button';
    eye.className = 'pw-eye';
    eye.textContent = '👁';
    eye.title = 'パスワードを表示';
    eye.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      eye.textContent = show ? '🙈' : '👁';
    });
    wrap.appendChild(eye);
  }
}

// 学期タブを描画して選択変更コールバックを返す
async function renderQuarterTabs(container, onChange) {
  const { quarters } = await api('/api/quarters');
  let selected = quarters.find((q) => q.is_active) ?? quarters[0];
  const box = document.createElement('div');
  box.className = 'panel qtabs';
  function draw() {
    box.innerHTML = '';
    for (const q of quarters) {
      const b = document.createElement('button');
      b.textContent = `${q.quarter}Q`;
      b.title = q.label;
      if (q.id === selected.id) b.classList.add('active');
      b.addEventListener('click', () => { selected = q; draw(); onChange(q); });
      box.appendChild(b);
    }
  }
  draw();
  container.appendChild(box);
  return { get selected() { return selected; } };
}
