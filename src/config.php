<?php
// 運用設定
//
// ★管理者権限を与える学番（教員など）をここに列挙する。
// この学番でログイン/新規登録すると自動的に管理者権限（メンバー管理・年度更新）が付く。
// 教員が変わったらこのリストを書き換えるだけでよい。

const ADMIN_STUDENT_NUMBERS = [
    'T0001', // 例: 加藤教授（サンプルデータ）。実運用の学番に書き換えること
];

// DB接続情報: Docker では環境変数から取得、chobi.net では直接記述する
define('DB_HOST', getenv('DB_HOST') ?: 'localhost');
define('DB_NAME', getenv('DB_NAME') ?: 'olab');
define('DB_USER', getenv('DB_USER') ?: 'olab');
define('DB_PASS', getenv('DB_PASS') ?: '');

// 実行環境: 'development' ならサンプルデータ自動投入
define('OLAB_ENV', getenv('OLAB_ENV') ?: 'production');
