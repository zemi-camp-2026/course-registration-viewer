# course-registration-viewer

2026年ゼミ合宿での「受講科目登録・閲覧システム」開発用リポジトリ

研究室メンバーの受講科目（時間割）を登録・共有するWebアプリ。全体図で「誰がどのコマに授業で埋まっているか」を学年バッジ（B3/B4/M1/M2/Prof）で一覧でき、ミーティングの日程調整に使える。

## 動かし方（3ステップ）

**必要なもの: [Docker Desktop](https://www.docker.com/products/docker-desktop/) だけ**

```bash
git clone https://github.com/zemi-camp-2026/course-registration-viewer.git
cd course-registration-viewer
docker compose up -d
```

→ ブラウザで **http://localhost:3100** を開く。

初回はDockerイメージのビルドとMySQLの起動に少し時間がかかる。`docker compose logs -f web` でログを確認できる。

**開発モードでは、起動しただけでサンプルデータ（19人分のユーザーと時間割）が自動で入る**ので、cloneしてすぐ画面を触れる。学番だけでログインできる（初回ログイン扱い）:
- `T0001` … 教員（**管理者権限つき**。管理画面・年度更新を試せる）
- `B3001`〜`B3010`, `B4001`〜`B4004`, `M1001`〜`M1002`, `M2001`〜`M2002` … 学生

DBはDockerボリュームに保存されるのでコンテナを停止しても消えない。**最初からやり直したいときは `docker compose down -v` してから `docker compose up -d`**。

サンプルデータだけ入れ直したいときは:
```bash
docker compose exec web php seed.php
```

終了するときは:
```bash
docker compose down
```

## 班員がテストするときの手順

Docker を起動したら（サンプルデータが自動で入っている状態で）、ブラウザで一通り触って確認する:

1. **全体図（トップ）**: ログイン不要。学期タブ（1Q〜4Q）の切替、学年フィルタ、ハイライト（空きコマ）、サマリ/詳細切替、スポット表示（個人の時間割）を触る
2. **新規登録 → 時間割入力**: 「時間割登録・編集」→「はじめての方: 新規登録」から学番・氏名・学年・パスワードでアカウント作成 → 空きコマをクリックして科目を登録、登録済みコマをクリックで編集・削除
3. **初回ログイン体験**: いったんログアウトし、サンプルの `B3001` で**学番だけ**ログイン → パスワード設定を求められる → 設定 → 以降は学番＋パスワード。パスワード欄の👁で表示切替、「パスワードを忘れた場合」でリセットも試せる
4. **プロフィール**: ヘッダーの「👤名前」から自分の学番・氏名・学年・パスワードを変更
5. **管理者機能**: `T0001` でログインするとヘッダーに「管理」が出る → メンバー追加・削除、年度更新ウィザードを試せる

## 教員登録と管理者権限は別物（重要）

- **「教員」として新規登録** … 誰でもできる。時間割上で赤い「Prof」バッジで表示されるだけ（学年を持たない）。**これだけでは管理者にならない**
- **管理者権限（管理画面・メンバー削除・年度更新）** … [src/config.php](src/config.php) の `ADMIN_STUDENT_NUMBERS` に学番が載っている人だけに付く

つまり管理者にしたい人は、その学番を config.php に書き足す（登録時・ログイン時に自動で権限が付く）。サンプルでは `T0001` が管理者に設定済み。実運用では実際の教員の学番に書き換えること。

```php
// src/config.php
const ADMIN_STUDENT_NUMBERS = [
    'T1234', // 〇〇先生
];
```

## 自動テスト（E2E）

主要フローを実ブラウザ（Chromium）で自動検証するテストが `e2e/` にある。

```bash
# Docker が起動した状態で:
cd e2e

# 初回だけ: テスト用パッケージとブラウザを入れる
npm install && npx playwright install chromium

# テスト実行（14項目）
node run.mjs
```

全体図・フィルタ・学期切替・新規登録・コマ登録/削除・プロフィール変更・再ログイン・不正パスワード拒否・管理画面の権限ガードを検証する。コードを変更したらこれを回して全項目パスを確認する（詳しい開発ルールは [CLAUDE.md](CLAUDE.md)）。

## 本番運用のとき（chobi.net）

`src/` ディレクトリの中身をそのまま chobi.net の公開ディレクトリに FTP アップロードする。

1. chobi.net の phpMyAdmin で [init.sql](init.sql) を実行してテーブルを作成
2. `src/config.php` の DB 接続情報を chobi.net の値に書き換える（`DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASS`）
3. `ADMIN_STUDENT_NUMBERS` を実際の教員の学番に変更
4. `src/` 以下を FTP でアップロード

`OLAB_ENV` 環境変数が未設定（= production）のため、サンプルデータは投入されず**空の状態から始まる**。学期（1Q〜4Q）は初回アクセス時に自動作成される。各メンバーはログイン画面から新規登録する。

## 構成

| パス | 内容 |
|------|------|
| [docs/受講科目登録・閲覧システム_設計書.md](docs/受講科目登録・閲覧システム_設計書.md) | 設計書（要件・DB設計・API仕様・画面仕様・全決定事項の経緯） |
| [docs/TECH_DECISION.md](docs/TECH_DECISION.md) | 技術選定の記録（なぜ PHP + MySQL なのか、主要な設計判断） |
| [docs/LOCAL_DEV.md](docs/LOCAL_DEV.md) | ローカル開発環境の詳細手順・トラブルシューティング |
| [src/](src/) | PHP バックエンド + フロントエンド（chobi.net にそのままアップロードする対象） |
| [src/routes/](src/routes/) | API ルートハンドラ（認証・ユーザー・時間割・全体図 等 21エンドポイント） |
| [src/public/](src/public/) | フロント5画面（全体図・ログイン/新規登録・時間割入力・管理・プロフィール） |
| [docker-compose.yml](docker-compose.yml) | Docker 構成（PHP 8.2 Apache + MySQL 8.0） |
| [init.sql](init.sql) | MySQL スキーマ定義（テーブル3つ） |
| [e2e/](e2e/) | E2E テスト（Playwright） |

詳しい API 仕様や認証の仕組みは設計書を参照。
