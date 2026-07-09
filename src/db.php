<?php
// DB層: MySQL (PDO) 接続 + ブートストラップ

require_once __DIR__ . '/config.php';

// グリッドの定義（設計書2.1: 月〜土 × 1〜5限）
const DAYS = [1, 2, 3, 4, 5, 6];
const PERIODS = [1, 2, 3, 4, 5];

/**
 * PDO シングルトン
 */
function getDB(): PDO {
    static $pdo = null;
    if ($pdo !== null) return $pdo;

    $dsn = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4';
    $pdo = new PDO($dsn, DB_USER, DB_PASS, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);
    return $pdo;
}

/**
 * 学年ラベル: 教員は 'Prof' として扱う（既存システムの表示を踏襲）
 */
function gradeLabel(array $user): string {
    return $user['role'] === 'teacher' ? 'Prof' : ($user['grade'] ?? '?');
}

/**
 * ブートストラップ: 学期が1つもなければ現在の年度の1Q〜4Qを自動作成する
 */
function bootstrapQuarters(): void {
    $pdo = getDB();
    $n = (int) $pdo->query('SELECT COUNT(*) FROM quarters')->fetchColumn();
    if ($n > 0) return;

    $month     = (int) date('n');
    $year      = (int) date('Y');
    $fiscalYear = $month >= 4 ? $year : $year - 1;

    if ($month >= 4 && $month <= 6)       $currentQ = 1;
    elseif ($month >= 7 && $month <= 9)   $currentQ = 2;
    elseif ($month >= 10)                 $currentQ = 3;
    else                                  $currentQ = 4;

    $labels = ['前期前半(1Q)', '前期後半(2Q)', '後期前半(3Q)', '後期後半(4Q)'];
    $stmt = $pdo->prepare('INSERT INTO quarters (year, quarter, label, is_active) VALUES (?, ?, ?, ?)');
    foreach ($labels as $i => $label) {
        $stmt->execute([$fiscalYear, $i + 1, "{$fiscalYear}年度{$label}", ($i + 1) === $currentQ ? 1 : 0]);
    }
}

bootstrapQuarters();
