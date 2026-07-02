# 受講科目登録・閲覧システム

大学研究室向けの時間割共有Webアプリ。仕様の正は `docs/受講科目登録・閲覧システム_設計書.md`（挙動と食い違ったら必ずどちらかを直す）。

## 構成と方針

- `server/` — APIサーバ。**Node.js標準機能のみ・外部依存ゼロ**が方針。npmパッケージを追加しない（E2Eテスト用の `e2e/` だけは例外）
- `server/public/` — フロント5画面（素のHTML/CSS/JS）。テーマは設計書11.0（ウォームポップ）
- 起動: `cd server && node server.js`（開発は `PORT=3100`）。サンプルデータ: `node seed.js`

## コード編集後の検証ルール（必須）

コードを編集したら、コミットする前に必ず次の2つを実行すること:

1. **コードレビュー**: `code-reviewer` サブエージェント（`.claude/agents/code-reviewer.md`）を起動して変更をレビューさせる。深刻度の高い指摘は修正してから先へ進む
2. **ブラウザでの動作検証**: 変更した画面・機能を実際に操作して確認する
   - Playwright MCP が接続されていればそのブラウザツールで操作する
   - 未接続なら `cd e2e && npm install && node run.mjs` でE2Eテストを実行する（サーバが `PORT=3100` で起動している必要あり）
   - どちらも不可能な場合のみ、curl でのAPI検証＋構文チェックで代替し、その旨を報告する

構文チェック（軽量・随時）: `node --check server/*.js server/public/app.js`。HTMLのインラインscriptは抽出してチェック。

## 注意点

- 編集系APIには必ず認可チェック（`requireLogin`/`requireSelf`/`requireAdmin`）を入れる。閲覧系は認証不要が仕様
- フロントで氏名・科目名などユーザー入力を `innerHTML` に埋めるときはエスケープする
- SQLは必ずプレースホルダ（`?`）を使う
- ユーザー削除は物理削除で受講コマもCASCADEで消える設計。削除前の確認UIを省略しない
- DBファイル（`server/olab.db`）はコミットしない（.gitignore済み）
