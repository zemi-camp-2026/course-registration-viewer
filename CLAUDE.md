# 受講科目登録・閲覧システム

大学研究室向けの時間割共有Webアプリ。仕様の正は `docs/受講科目登録・閲覧システム_設計書.md`（挙動と食い違ったら必ずどちらかを直す）。

## 構成と方針

- `src/` — PHP バックエンド + フロントエンド。**chobi.net（共用ホスティング）にそのままアップロードする対象**
  - `src/public/` — フロント5画面（素のHTML/CSS/JS）。テーマは設計書11.0（ウォームポップ）
  - `src/routes/` — APIルートハンドラ（PHP）
  - `src/index.php` — エントリポイント（ルーター）
- Docker で開発: `docker compose up -d`（ポート 3000 で起動）
- サンプルデータ: `docker compose exec web php seed.php`（開発モードではユーザー0件時に自動投入）

## コード編集後の検証ルール（必須・修正点がなくなるまで反復）

コードを編集したら、コミットする前に必ず次のループを回すこと。**1周で終わらせず、指摘・失敗がゼロになるまで繰り返す**:

1. **コードレビュー**: `code-reviewer` サブエージェント（`.claude/agents/code-reviewer.md`）を起動して変更をレビューさせる
2. **ブラウザでの動作検証**: 変更した画面・機能を実際に操作して確認する
   - Playwright MCP が接続されていればそのブラウザツールで操作する
   - 未接続なら `cd e2e && node run.mjs` でE2Eテストを実行する（Docker が `localhost:3000` で起動している必要あり。初回だけ `npm install`）
   - どちらも不可能な場合のみ、curl でのAPI検証＋構文チェックで代替し、その旨を報告する
3. **判定**: レビューの指摘（軽微を除く）または動作検証の失敗が1つでもあれば、**それらを修正して 1 に戻る**
4. レビューが「指摘なし」かつ動作検証が全項目パスになったら、はじめてコミットする

- 修正が新たな問題を生むことがあるため、必ず「修正 → 再レビュー＋再検証」を回し切る。
- 各周回で「何を直したか・再検証の結果」を簡潔に記録し、最終的に何周で収束したかを報告する。
- 機能を追加・変更したら、対応するE2Eケースを `e2e/run.mjs` に追加してから収束判定する。

構文チェック（軽量・随時）: `docker compose exec web php -l src/*.php src/routes/*.php`

## 本番デプロイ（chobi.net）

### 初回セットアップ

1. `src/config.example.php` を `src/config.php` にコピーし、DB接続情報を書き換える
   - `DB_NAME` / `DB_USER`: chobi.net のアカウント名
   - `DB_PASS`: chobi.net のパスワード
   - `DB_HOST` は `localhost` のまま
   - `config.php` は `.gitignore` 済みなのでパスワードを直接書いてOK
2. FFFTP 等で `src/` の**中身**を chobi.net のルートにアップロード（`src/` フォルダ自体は作らない）
   - `.htaccess` も必須（FFFTP で「.ファイルの表示」をONにする。おそらくデフォルトで表示されている。）
   - リポジトリのルートにある`init.sql` も他ファイルと同じ階層に配置する（テーブル作成用）
3. ブラウザで `/seed.php` にアクセスしてテーブル作成＋初期データ投入
4. **投入後、`seed.php` と `init.sql` を chobi.net から削除する**（誰でもデータ全消去できてしまうため）

### デプロイ時の注意

- `seed.php` / `init.sql` を本番に置きっぱなしにしない（データ破壊のリスク）
- `config.php` はローカル専用。chobi.net にアップロードするがリポジトリには含めない
- `config.example.php` がテンプレート。他の開発者はこれをコピーして使う
- Docker 環境は環境変数で DB に接続するため、`config.php` のフォールバック値は開発に影響しない

### chobi.net の制約

- 容量 500MB / DB 10MB 目安
- 転送量: 1時間 50MB、週 1GB
- **180日間トップページ更新なしで規約違反**（Issue #13 で自動化予定）
- 商用利用禁止（大学研究室の内部ツールなので該当しない）
- 参考: [freeプラン](https://chobi.net/plan/order1.html) / [利用規約](https://chobi.net/plan/kiyaku.html) / [禁止事項](https://chobi.net/plan/ihan1.html)

## 注意点

- 編集系APIには必ず認可チェック（`requireLogin`/`requireSelf`/`requireAdmin`）を入れる。閲覧系は認証不要が仕様
- フロントで氏名・科目名などユーザー入力を `innerHTML` に埋めるときはエスケープする
- SQLは必ずプリペアドステートメント（PDO + `?` プレースホルダ）を使う
- ユーザー削除は物理削除で受講コマもCASCADEで消える設計。削除前の確認UIを省略しない
- `.env` / `config.php` はコミットしない（.gitignore済み）
