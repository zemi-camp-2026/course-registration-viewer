<?php
// 共通ヘルパ: レスポンス送信 / ルート照合 / 認可チェック / バリデーション

/**
 * HTTP エラー例外
 */
class HttpError extends RuntimeException {
    public int $status;
    public function __construct(int $status, string $message) {
        parent::__construct($message);
        $this->status = $status;
    }
}

/**
 * JSON レスポンスを送信して終了
 */
function jsonResponse(int $status, $data): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

/**
 * パスパターン照合（:id 等のパラメータ抽出）
 * @return array|null マッチすればパラメータ連想配列、しなければ null
 */
function matchPath(string $pattern, string $actual): ?array {
    $p = explode('/', trim($pattern, '/'));
    $a = explode('/', trim($actual, '/'));
    if (count($p) !== count($a)) return null;
    $params = [];
    for ($i = 0; $i < count($p); $i++) {
        if (str_starts_with($p[$i], ':')) {
            $params[substr($p[$i], 1)] = urldecode($a[$i]);
        } elseif ($p[$i] !== $a[$i]) {
            return null;
        }
    }
    return $params;
}

/**
 * ユーザー情報から公開用の連想配列を作成（パスワードハッシュ等を除外）
 */
function publicUser(array $u): array {
    return [
        'id'             => (int) $u['id'],
        'student_number' => $u['student_number'],
        'name'           => $u['name'],
        'role'           => $u['role'],
        'grade'          => $u['grade'],
        'grade_label'    => gradeLabel($u),
        'is_admin'       => (bool) $u['is_admin'],
    ];
}

/**
 * ログイン必須チェック
 */
function requireLogin(): array {
    $user = getCurrentUser();
    if (!$user) throw new HttpError(401, 'ログインが必要です');
    return $user;
}

/**
 * 本人チェック（編集は本人のみ）
 */
function requireSelf(int $targetUserId): array {
    $user = requireLogin();
    if ((int) $user['id'] !== $targetUserId) {
        throw new HttpError(403, '他人の時間割は編集できません（編集は本人のみ）');
    }
    return $user;
}

/**
 * 管理者チェック
 */
function requireAdmin(): array {
    $user = requireLogin();
    if (!$user['is_admin']) throw new HttpError(403, '管理者権限が必要です');
    return $user;
}

// ---- バリデーション ----

const VALID_GRADES = ['B3', 'B4', 'M1', 'M2'];

function validateGrade(string $grade): string {
    if (!in_array($grade, VALID_GRADES, true)) {
        throw new HttpError(400, '学年は ' . implode('/', VALID_GRADES) . ' のいずれかで指定してください');
    }
    return $grade;
}

function validateCell($day, $period): void {
    $d = (int) $day;
    $p = (int) $period;
    if (!in_array($d, DAYS, true) || !in_array($p, PERIODS, true)) {
        throw new HttpError(400, 'day は 1〜6(月〜土)、period は 1〜5 で指定してください');
    }
}

/**
 * クォーターID解決: クエリ指定があればそれ、なければアクティブな学期
 */
function resolveQuarterId(array $query): int {
    if (!empty($query['quarter'])) return (int) $query['quarter'];
    $pdo = getDB();
    $row = $pdo->query('SELECT id FROM quarters WHERE is_active = 1 LIMIT 1')->fetch();
    if (!$row) throw new HttpError(400, 'quarter パラメータがなく、アクティブな学期も設定されていません');
    return (int) $row['id'];
}

/**
 * クォーター取得（404チェック付き）
 */
function getQuarterOr404(int $qid): array {
    $pdo = getDB();
    $stmt = $pdo->prepare('SELECT * FROM quarters WHERE id = ?');
    $stmt->execute([$qid]);
    $q = $stmt->fetch();
    if (!$q) throw new HttpError(404, '指定された学期が見つかりません');
    return $q;
}

/**
 * クォーター情報を公開用に整形
 */
function quarterJson(array $q): array {
    return [
        'id'         => (int) $q['id'],
        'year'       => (int) $q['year'],
        'quarter'    => (int) $q['quarter'],
        'label'      => $q['label'],
        'start_date' => $q['start_date'],
        'end_date'   => $q['end_date'],
        'is_active'  => (bool) $q['is_active'],
    ];
}

/**
 * 個人の週間時間割を取得
 */
function userSchedule(int $userId, int $quarterId): array {
    $pdo = getDB();
    $stmt = $pdo->prepare(
        'SELECT day_of_week AS day, period, subject_name FROM schedule_entries WHERE user_id = ? AND quarter_id = ? ORDER BY day_of_week, period'
    );
    $stmt->execute([$userId, $quarterId]);
    $entries = $stmt->fetchAll();
    // day, period を int にキャスト
    foreach ($entries as &$e) {
        $e['day']    = (int) $e['day'];
        $e['period'] = (int) $e['period'];
    }
    return ['days' => DAYS, 'periods' => PERIODS, 'entries' => $entries];
}
