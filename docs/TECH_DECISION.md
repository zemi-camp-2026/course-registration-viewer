# 技術選定の記録

## 背景

本システムは大学研究室の共用サーバ **chobi.net**（PHP + MySQL 共用ホスティング）にデプロイする前提で開発している。Node.js や SQLite は利用できないため、以下の技術スタックを採用した。

## 技術スタック

| レイヤ | 採用技術 | 理由 |
|--------|----------|------|
| バックエンド | PHP 8.2 | chobi.net が PHP をサポート。フレームワークなし（単一エントリポイント方式） |
| データベース | MySQL 8.0 | chobi.net が MySQL をサポート。InnoDB + utf8mb4 |
| フロントエンド | 素の HTML/CSS/JS | ビルドツール不要。`src/public/` をそのまま配信 |
| 開発環境 | Docker Compose | PHP + MySQL をローカルで再現（ポート 3100） |
| E2Eテスト | Playwright（Node.js） | ヘッドレスブラウザで全画面フローを自動検証 |

## 主要な設計判断

### ルーティング: `.htaccess` + 単一エントリポイント

- すべての `/api/*` リクエストを `src/index.php` にルーティング
- 静的ファイル（HTML/CSS/JS）は `src/public/` から直接配信
- フレームワークを使わず `matchPath()` ヘルパで自前ルーティング
- 理由: 外部ライブラリ依存ゼロ。chobi.net に FTP アップロードするだけでデプロイ可能

### 認証: PHP セッション

- `session_start()` + `$_SESSION` による標準的なセッション管理
- Cookie: `HttpOnly`, `SameSite=Lax`, 有効期限 30 日
- JWT ではなくサーバサイドセッションを選択（共用ホスティングでシンプル）

### パスワード: bcrypt

- `password_hash()` / `password_verify()` で bcrypt ハッシュ
- 初回ログイン時はパスワード未設定（`password_hash = NULL`）で学番のみでログイン可能
- ログイン後にパスワード設定を強制

### SQL: PDO + プリペアドステートメント

- すべてのクエリで `?` プレースホルダを使用
- SQL インジェクション対策として `PDO::ATTR_EMULATE_PREPARES = false` を設定

### HTTP メソッド

- PATCH / DELETE を使用するが、共用ホスティングでブロックされる可能性に備え `X-HTTP-Method-Override` ヘッダに対応
- フロントエンドの `app.js` の `api()` 関数が自動的にこのヘッダを付与

### 管理者判定

- `src/config.php` の `ADMIN_STUDENT_NUMBERS` 配列で管理者の学番を列挙
- ログイン時に `is_admin` フラグを自動同期
- DB に管理者テーブルを持たず設定ファイルで一元管理（教員交代時はこのリストを書き換えるだけ）

## デプロイ方法

1. `src/` ディレクトリの中身をそのまま chobi.net の公開ディレクトリに FTP アップロード
2. `src/config.php` の DB 接続情報を chobi.net の値に書き換える
3. chobi.net の phpMyAdmin で `init.sql` を実行してテーブルを作成
4. `OLAB_ENV` は設定しない（デフォルトで `production` になり、サンプルデータは投入されない）
