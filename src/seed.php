<?php
// サンプルデータ投入（動作確認用）
// CLI: php seed.php
// サーバ起動時: 開発モードでユーザーが0件のとき index.php から populateSampleData() が呼ばれる

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/db.php';

function populateSampleData(): array {
    $pdo = getDB();
    $pdo->beginTransaction();
    try {
        $result = buildSampleData($pdo);
        $pdo->commit();
        return $result;
    } catch (Exception $e) {
        $pdo->rollBack();
        throw $e;
    }
}

function buildSampleData(PDO $pdo): array {
    $pdo->exec('DELETE FROM schedule_entries');
    $pdo->exec('DELETE FROM quarters');
    $pdo->exec('DELETE FROM users');

    // ---- 学期: 2026年度 1Q〜4Q（1Q をアクティブに） ----
    $insQ = $pdo->prepare('INSERT INTO quarters (year, quarter, label, is_active) VALUES (?, ?, ?, ?)');
    $quarterLabels = ['前期前半(1Q)', '前期後半(2Q)', '後期前半(3Q)', '後期後半(4Q)'];
    $quarterIds = [];
    foreach ($quarterLabels as $i => $label) {
        $insQ->execute([2026, $i + 1, "2026年度{$label}", $i === 0 ? 1 : 0]);
        $quarterIds[] = (int) $pdo->lastInsertId();
    }

    // ---- ユーザー: 教員1 + M2×2 + M1×2 + B4×4 + B3×10 ----
    $insU = $pdo->prepare('INSERT INTO users (student_number, name, role, grade, is_admin) VALUES (?, ?, ?, ?, ?)');
    $users = [];

    $addUser = function($snum, $name, $role, $grade, $isAdmin = 0) use ($pdo, $insU, &$users) {
        $insU->execute([$snum, $name, $role, $grade, $isAdmin]);
        $id = (int) $pdo->lastInsertId();
        $users[] = ['id' => $id, 'name' => $name, 'role' => $role, 'grade' => $grade];
        return $id;
    };

    $addUser('T0001', '加藤教授', 'teacher', null, 1);
    $addUser('M2001', '佐藤 一郎', 'student', 'M2');
    $addUser('M2002', '鈴木 二郎', 'student', 'M2');
    $addUser('M1001', '高橋 三郎', 'student', 'M1');
    $addUser('M1002', '田中 四郎', 'student', 'M1');
    for ($i = 1; $i <= 4; $i++) $addUser('B4' . str_pad($i, 3, '0', STR_PAD_LEFT), "B4学生{$i}", 'student', 'B4');
    for ($i = 1; $i <= 10; $i++) $addUser('B3' . str_pad($i, 3, '0', STR_PAD_LEFT), "B3学生{$i}", 'student', 'B3');

    // ---- 受講コマ ----
    $insE = $pdo->prepare(
        'INSERT IGNORE INTO schedule_entries (user_id, quarter_id, day_of_week, period, subject_name) VALUES (?, ?, ?, ?, ?)'
    );

    $subjects = ['画像処理特論', '知能情報学', '信号処理', 'データ解析', '実験A', '実験B', 'ゼミ資料講読', '応用数学', 'プログラミング演習', '研究基礎'];
    $seedVal = 42;
    $rand = function() use (&$seedVal) {
        $seedVal = ($seedVal * 1103515245 + 12345) % (2 ** 31);
        return $seedVal / (2 ** 31);
    };
    $pick = function(array $arr) use ($rand) {
        return $arr[(int) floor($rand() * count($arr))];
    };

    $countByGrade = ['B3' => 12, 'B4' => 7, 'M1' => 4, 'M2' => 3];
    $days = array_slice(DAYS, 0, 5);     // 月〜金
    $periods = array_slice(PERIODS, 0, 4); // 1〜4限

    foreach ($users as $u) {
        $isTeacher = $u['role'] === 'teacher';
        $target = $isTeacher ? 6 : ($countByGrade[$u['grade']] ?? 5);

        // 1Q
        $placed = 0;
        $guard = 0;
        while ($placed < $target && $guard++ < 200) {
            $day    = $pick($days);
            $period = $pick($periods);
            $insE->execute([$u['id'], $quarterIds[0], $day, $period, $isTeacher ? '担当講義' : $pick($subjects)]);
            if ($insE->rowCount() > 0) $placed++;
        }

        // 2Q（半分くらい）
        $placed = 0;
        $guard = 0;
        $half = (int) ceil($target / 2);
        while ($placed < $half && $guard++ < 200) {
            $day    = $pick($days);
            $period = $pick($periods);
            $insE->execute([$u['id'], $quarterIds[1], $day, $period, $isTeacher ? '担当講義' : $pick($subjects)]);
            if ($insE->rowCount() > 0) $placed++;
        }
    }

    $nUsers   = (int) $pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
    $nEntries = (int) $pdo->query('SELECT COUNT(*) FROM schedule_entries')->fetchColumn();
    return ['users' => $nUsers, 'entries' => $nEntries];
}

// CLIとして直接実行されたとき
if (php_sapi_name() === 'cli' && realpath($argv[0] ?? '') === realpath(__FILE__)) {
    $r = populateSampleData();
    echo "投入完了: users={$r['users']}, quarters=4, schedule_entries={$r['entries']}\n";
    echo "仮ログイン用の学番例: B3001 / M1001 / T0001(教員・管理者)\n";
}
