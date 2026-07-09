<?php
// 認証系 API（6エンドポイント）

$routes[] = [
    'method' => 'POST',
    'path'   => '/api/auth/login',
    'handler' => function ($params, $query, $body) {
        $studentNumber = $body['student_number'] ?? null;
        if (!$studentNumber) throw new HttpError(400, 'student_number は必須です');
        $user = loginUser((string) $studentNumber, $body['password'] ?? '');
        if (!$user) throw new HttpError(401, 'ログインに失敗しました（学番またはパスワードを確認してください）');
        jsonResponse(200, [
            'user'          => publicUser($user),
            'password_set'  => $user['password_hash'] !== null,
            'auth_provider' => 'password',
        ]);
    },
];

$routes[] = [
    'method' => 'POST',
    'path'   => '/api/auth/set-password',
    'handler' => function ($params, $query, $body) {
        $user     = requireLogin();
        $password = $body['password'] ?? null;
        if (!is_string($password) || mb_strlen($password) < 6) {
            throw new HttpError(400, 'パスワードは6文字以上で指定してください');
        }
        // すでに設定済みなら現在のパスワードの照合を要求する
        if ($user['password_hash'] !== null) {
            $current = $body['current_password'] ?? '';
            if (!password_verify($current, $user['password_hash'])) {
                throw new HttpError(401, '現在のパスワードが違います');
            }
        }
        setUserPassword((int) $user['id'], $password);
        jsonResponse(200, ['ok' => true, 'password_set' => true]);
    },
];

$routes[] = [
    'method' => 'POST',
    'path'   => '/api/auth/register',
    'handler' => function ($params, $query, $body) {
        $studentNumber = $body['student_number'] ?? null;
        $name          = $body['name'] ?? null;
        $grade         = $body['grade'] ?? null;
        $role          = ($body['role'] ?? '') === 'teacher' ? 'teacher' : 'student';
        $password      = $body['password'] ?? null;

        if (!$studentNumber || !$name) throw new HttpError(400, '学番と氏名は必須です');
        if ($role === 'student') validateGrade($grade);
        if (!is_string($password) || mb_strlen($password) < 6) {
            throw new HttpError(400, 'パスワードは6文字以上で指定してください');
        }

        try {
            $user = registerUser(
                (string) $studentNumber,
                (string) $name,
                $role,
                $role === 'teacher' ? null : $grade,
                $password
            );
        } catch (PDOException $e) {
            if (str_contains($e->getMessage(), 'Duplicate')) {
                throw new HttpError(409, "学番 {$studentNumber} は登録済みです。ログインしてください");
            }
            throw $e;
        }

        jsonResponse(201, [
            'user'          => publicUser($user),
            'password_set'  => true,
            'auth_provider' => 'password',
        ]);
    },
];

$routes[] = [
    'method' => 'POST',
    'path'   => '/api/auth/forgot-password',
    'handler' => function ($params, $query, $body) {
        $sn = $body['student_number'] ?? null;
        if (!$sn) throw new HttpError(400, 'student_number は必須です');
        $pdo  = getDB();
        $stmt = $pdo->prepare('SELECT * FROM users WHERE student_number = ? AND is_active = 1');
        $stmt->execute([(string) $sn]);
        $u = $stmt->fetch();
        if (!$u) throw new HttpError(404, 'その学番は登録されていません');
        resetUserPassword((int) $u['id']);
        jsonResponse(200, ['ok' => true]);
    },
];

$routes[] = [
    'method' => 'POST',
    'path'   => '/api/auth/logout',
    'handler' => function ($params, $query, $body) {
        logoutUser();
        jsonResponse(200, ['ok' => true]);
    },
];

$routes[] = [
    'method' => 'GET',
    'path'   => '/api/auth/me',
    'handler' => function ($params, $query, $body) {
        $user = getCurrentUser();
        jsonResponse(200, [
            'user'          => $user ? publicUser($user) : null,
            'password_set'  => $user ? ($user['password_hash'] !== null) : null,
            'auth_provider' => 'password',
        ]);
    },
];
