# ローカル開発環境の構築手順

## 前提

- Docker Desktop がインストール済みであること
- Node.js 18 以上（E2Eテスト実行時のみ必要）

## 起動手順

```bash
# 1. リポジトリをクローン
git clone <リポジトリURL>
cd course-registration-viewer

# 2. Docker で起動（初回はイメージのビルドあり）
docker compose up -d

# 3. ブラウザで確認
# http://localhost:3100 にアクセス
```

初回起動時、開発モード（`OLAB_ENV=development`）ではユーザーが 0 件のときにサンプルデータが自動投入される。

## コンテナ構成

| サービス | イメージ | ポート | 説明 |
|----------|----------|--------|------|
| web | php:8.2-apache（カスタム） | 3100:80 | PHP + Apache。`src/` をマウント |
| db | mysql:8.0 | 3306:3306 | MySQL。`init.sql` で初期化 |

## サンプルデータ

開発モードでは初回アクセス時に自動投入される。手動で再投入する場合:

```bash
docker compose exec web php seed.php
```

投入されるデータ:
- 教員 1 名（T0001 / 加藤教授 / 管理者）
- M2 × 2、M1 × 2、B4 × 4、B3 × 10
- 2026年度 1Q〜4Q（1Q がアクティブ）
- 各ユーザーに受講コマを自動生成

仮ログイン用の学番: `B3001`（学生）/ `T0001`（教員・管理者）
パスワード未設定のため、学番のみでログインし、その後パスワードを設定する。

## よく使うコマンド

```bash
# コンテナの起動・停止
docker compose up -d
docker compose down

# ログ確認
docker compose logs -f web

# PHP構文チェック
docker compose exec web php -l index.php
docker compose exec web php -l routes/auth.php

# MySQLに接続
docker compose exec db mysql -u olab -polab_dev_pass olab

# DBリセット（テーブル再作成 + サンプルデータ再投入）
docker compose down -v
docker compose up -d
```

## E2Eテスト

```bash
# Docker が起動した状態で:
cd e2e
npm install          # 初回のみ
node run.mjs
```

14件のテストケースが実行される。すべて PASS すれば正常。

## ディレクトリ構成

```
course-registration-viewer/
├── docker-compose.yml      # Docker 構成
├── docker/Dockerfile        # PHP + Apache イメージ
├── init.sql                 # MySQL スキーマ
├── src/                     # ← chobi.net にアップロードする対象
│   ├── .htaccess            # URL リライト
│   ├── index.php            # エントリポイント（ルーター）
│   ├── config.php           # DB接続・管理者設定
│   ├── db.php               # PDO接続
│   ├── auth.php             # 認証
│   ├── helpers.php          # 共通ユーティリティ
│   ├── seed.php             # サンプルデータ
│   ├── routes/              # APIルートハンドラ
│   │   ├── auth.php
│   │   ├── quarters.php
│   │   ├── users.php
│   │   ├── schedule.php
│   │   └── overview.php
│   └── public/              # フロントエンド
│       ├── index.html       # 全体図
│       ├── login.html       # ログイン・登録
│       ├── edit.html        # 時間割編集
│       ├── admin.html       # 管理画面
│       ├── profile.html     # プロフィール
│       ├── app.js           # 共通JS
│       └── style.css        # スタイル
├── e2e/                     # E2Eテスト
├── docs/                    # ドキュメント
└── CLAUDE.md                # AI開発支援設定
```

## トラブルシューティング

### ポート 3100 が既に使われている
`docker-compose.yml` の `ports` を変更する（例: `3200:80`）。E2Eテストには `BASE=http://localhost:3200 node run.mjs` で URL を渡す。

### DB接続エラー
MySQL コンテナの起動完了を待ってからアクセスする。`docker compose logs db` でステータスを確認。初回は healthcheck が通るまで数秒かかる。

### `docker-credential-desktop` エラー（Windows）
Docker Desktop の PATH が通っていない場合に発生する。Docker Desktop を再起動するか、`C:\Program Files\Docker\Docker\resources\bin` を PATH に追加する。
