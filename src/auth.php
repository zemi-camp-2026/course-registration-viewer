<?php
// 認証層（設計書4章）
//
// 認証フロー（確定済み・既存システム踏襲）:
//   1. 管理者がメンバー登録（パスワード未設定 = password_hash が NULL）
//   2. 本人は初回、学番だけでログインできる（未設定の間のみ）
//   3. ログイン後にパスワードを設定（bcryptハッシュでDB保存。平文保存はしない）
//   4. 以降は学番＋パスワードで認証
// 未登録の学番ではログインできない。

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/db.php';

/**
 * config.js の管理者リストと is_admin フラグを同期する
 */
function syncAdminFlag(array &$user): void {
    $shouldBeAdmin = in_array($user['student_number'], ADMIN_STUDENT_NUMBERS, true) ? 1 : 0;
    if ((int) $user['is_admin'] !== $shouldBeAdmin) {
        $pdo = getDB();
        $stmt = $pdo->prepare('UPDATE users SET is_admin = ? WHERE id = ?');
        $stmt->execute([$shouldBeAdmin, $user['id']]);
        $user['is_admin'] = $shouldBeAdmin;
    }
}

/**
 * 現在のログインユーザーを返す（未ログインなら null）
 */
function getCurrentUser(): ?array {
    if (empty($_SESSION['user_id'])) return null;
    $pdo = getDB();
    $stmt = $pdo->prepare('SELECT * FROM users WHERE id = ? AND is_active = 1');
    $stmt->execute([$_SESSION['user_id']]);
    $user = $stmt->fetch();
    return $user ?: null;
}

/**
 * ログイン: 成功すればユーザー配列を返す。失敗は null。
 */
function loginUser(string $studentNumber, string $password): ?array {
    $pdo = getDB();
    $stmt = $pdo->prepare('SELECT * FROM users WHERE student_number = ? AND is_active = 1');
    $stmt->execute([$studentNumber]);
    $user = $stmt->fetch();
    if (!$user) return null;

    // パスワード未設定 = 初回ログイン（学番のみ）
    if ($user['password_hash'] === null) {
        syncAdminFlag($user);
        $_SESSION['user_id'] = $user['id'];
        return $user;
    }

    // パスワード照合
    if (!password_verify($password, $user['password_hash'])) return null;
    syncAdminFlag($user);
    $_SESSION['user_id'] = $user['id'];
    return $user;
}

/**
 * 新規登録（セルフサインアップ）: ユーザー作成 + パスワード設定 + ログインまで行う
 */
function registerUser(string $studentNumber, string $name, string $role, ?string $grade, string $password): array {
    $pdo = getDB();
    $hash = password_hash($password, PASSWORD_BCRYPT);
    $isAdmin = in_array($studentNumber, ADMIN_STUDENT_NUMBERS, true) ? 1 : 0;

    $stmt = $pdo->prepare(
        'INSERT INTO users (student_number, name, role, grade, password_hash, is_admin) VALUES (?, ?, ?, ?, ?, ?)'
    );
    $stmt->execute([$studentNumber, $name, $role, $grade, $hash, $isAdmin]);

    $userId = (int) $pdo->lastInsertId();
    $stmt = $pdo->prepare('SELECT * FROM users WHERE id = ?');
    $stmt->execute([$userId]);
    $user = $stmt->fetch();
    $_SESSION['user_id'] = $user['id'];
    return $user;
}

/**
 * パスワード設定・変更
 */
function setUserPassword(int $userId, string $password): void {
    $pdo = getDB();
    $hash = password_hash($password, PASSWORD_BCRYPT);
    $stmt = $pdo->prepare('UPDATE users SET password_hash = ? WHERE id = ?');
    $stmt->execute([$hash, $userId]);
}

/**
 * パスワードリセット: 未設定状態に戻す
 */
function resetUserPassword(int $userId): void {
    $pdo = getDB();
    $stmt = $pdo->prepare('UPDATE users SET password_hash = NULL WHERE id = ?');
    $stmt->execute([$userId]);
}

/**
 * ログアウト
 */
function logoutUser(): void {
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000,
            $params['path'], $params['domain'],
            $params['secure'], $params['httponly']
        );
    }
    session_destroy();
}
