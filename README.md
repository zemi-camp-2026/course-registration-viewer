# course-registration-viewer

2026年ゼミ合宿での「受講科目登録・閲覧システム」開発用リポジトリ

研究室メンバーの受講科目（時間割）を登録・共有するWebアプリ。全体図で「誰がどのコマに授業で埋まっているか」を学年バッジ（B3/B4/M1/M2/Prof）で一覧でき、ミーティングの日程調整に使える。

## 動かし方（3ステップ）

**必要なもの: Node.js 22.5以上だけ**（`npm install` 不要。外部パッケージゼロ）

```bash
git clone https://github.com/zemi-camp-2026/course-registration-viewer.git
cd course-registration-viewer/server
node server.js
```

→ ブラウザで **http://localhost:3000** を開く。ポートを変えたいときは `PORT=3100 node server.js`。

**開発モードでは、起動しただけでサンプルデータ（19人分のユーザーと時間割）が自動で入る**ので、cloneしてすぐ画面を触れる。学番だけでログインできる（初回ログイン扱い）:
- `T0001` … 教員（**管理者権限つき**。管理画面・年度更新を試せる）
- `B3001`〜`B3010`, `B4001`〜, `M1001`〜, `M2001`〜 … 学生

DB（`server/olab.db`）はコミット対象外なので、各自の手元のデータは他人と混ざらない。壊れたら消して再起動すれば作り直される。

サンプルを消して入れ直したいときは `rm server/olab.db*` して再起動、または `node seed.js`。

## 本番運用のとき

サーバに置いて実運用するときは、環境変数 **`OLAB_ENV=production`** を付けて起動する:
```bash
OLAB_ENV=production node server.js
```
これでサンプルデータは投入されず、**空の状態から始まる**（各自がログイン画面から新規登録）。学期（1Q〜4Q）は本番でも自動作成される。

## 新規登録の流れ（本番と同じ）
「時間割登録・編集」→「はじめての方: 新規登録」から、学番・氏名・学年・パスワードでアカウントを作れる。

## 管理者権限の付与

[server/config.js](server/config.js) の `ADMIN_STUDENT_NUMBERS` に学番を追加してサーバを再起動すると、その学番のユーザーに管理者権限（メンバー管理・年度更新）が付く。

## 構成

| パス | 内容 |
|------|------|
| [docs/受講科目登録・閲覧システム_設計書.md](docs/受講科目登録・閲覧システム_設計書.md) | 設計書（要件・DB設計・API仕様・画面仕様・全決定事項の経緯） |
| [server/](server/README.md) | APIサーバ本体（Node.js標準機能のみ + SQLite） |
| [server/public/](server/public/) | フロント5画面（全体図・ログイン/新規登録・時間割入力・管理・プロフィール） |

詳しいAPI仕様や認証の仕組みは [server/README.md](server/README.md) と設計書を参照。
