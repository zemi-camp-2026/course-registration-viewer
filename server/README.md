# 受講科目登録・閲覧システム APIサーバ

設計書は [../docs/受講科目登録・閲覧システム_設計書.md](../docs/受講科目登録・閲覧システム_設計書.md)。

**Node.js 22.5以上のみで動作（外部パッケージ不要・npm install不要）**。DBはSQLite（`olab.db`が自動生成される）。

## 起動方法

```bash
cd server
node seed.js        # サンプルデータ投入（初回や、データをリセットしたいとき）
node server.js      # サーバ起動（既定ポート3000。 PORT=3100 node server.js で変更可）
```

ブラウザで `http://localhost:3000`（動作確認用の仮ページ）。

## 認証（本番方式を実装済み・設計書4章）

既存システム踏襲のフロー:
1. 管理者がメンバー登録（パスワード未設定）
2. 本人は**初回、学番のみでログイン可**（レスポンスに `password_set: false`）
3. `POST /api/auth/set-password` で本人がパスワード設定（**scryptハッシュでDB保存**。平文保存はしない）
4. 以降は学番＋パスワード必須。未登録の学番は常に拒否
5. 忘れたら本人がログイン画面から `POST /api/auth/forgot-password` でセルフリセット（未設定状態に戻る）
6. ログイン後はプロフィール画面（profile.html）で学番・氏名・学年・パスワードを本人が変更できる

シード済みの学番例: `B3001` `M1001` `T0001`(教員・管理者)。全員パスワード未設定＝初回ログイン状態から始まる。
開発でパスワード検証を完全に切りたい場合のみ `OLAB_AUTH=stub node server.js`。

## ファイル構成

| ファイル | 役割 |
|---------|------|
| `server.js` | HTTPサーバ・ルーティング・静的配信 |
| `routes.js` | APIエンドポイント（設計書8章） |
| `auth.js` | 認証の抽象化レイヤ（スタブ⇄本番を差し替え可能） |
| `db.js` | SQLiteスキーマ（設計書6章） |
| `seed.js` | サンプルデータ投入 |
| `public/` | フロントの置き場所（現状は動作確認用の仮ページ） |

## 主要API（詳細は設計書8章）

- 閲覧（ログイン不要）: `GET /api/overview?quarter=&mode=summary|detail&grades=` / `GET /api/quarters` / `GET /api/users` / `GET /api/users/:id/schedule?quarter=` / `GET /api/free?quarter=&users=1,2,3`
- 認証: `POST /api/auth/login` / `POST /api/auth/set-password`（変更時は current_password 必須） / `POST /api/auth/forgot-password`（セルフリセット） / `POST /api/auth/logout` / `GET /api/auth/me`
- 編集（要ログイン・本人のみ）: `POST|DELETE /api/users/:id/schedule/cell?quarter=` / `PUT /api/users/:id/schedule?quarter=` / `PATCH /api/users/:id`（本人のプロフィール編集。管理者は全員分可）
- 管理（要adminロール）: `POST|DELETE /api/users(/:id)`（削除は物理削除・コマもCASCADEで消える） / `POST /api/admin/year-rollover`（卒業生削除・進級・新入生追加・新年度クォーター作成を一括実行）
