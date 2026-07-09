<?php
// ユーザー API（5エンドポイント + 年度更新）

// ---- 閲覧系（認証不要） ----

$routes[] = [
    'method' => 'GET',
    'path'   => '/api/users',
    'handler' => function ($params, $query, $body) {
        $pdo  = getDB();
        $rows = $pdo->query('SELECT * FROM users WHERE is_active = 1 ORDER BY role DESC, grade, name')->fetchAll();
        if (!empty($query['grade'])) {
            $wanted = explode(',', $query['grade']);
            $rows = array_values(array_filter($rows, fn($u) => in_array(gradeLabel($u), $wanted, true)));
        }
        jsonResponse(200, ['users' => array_map('publicUser', $rows)]);
    },
];

$routes[] = [
    'method' => 'GET',
    'path'   => '/api/users/:id',
    'handler' => function ($params, $query, $body) {
        $pdo  = getDB();
        $stmt = $pdo->prepare('SELECT * FROM users WHERE id = ? AND is_active = 1');
        $stmt->execute([$params['id']]);
        $u = $stmt->fetch();
        if (!$u) throw new HttpError(404, 'ユーザーが見つかりません');

        $cnt = $pdo->prepare('SELECT COUNT(*) AS n FROM schedule_entries WHERE user_id = ?');
        $cnt->execute([$u['id']]);
        jsonResponse(200, ['user' => publicUser($u), 'entry_count' => (int) $cnt->fetch()['n']]);
    },
];

// ---- 管理系（管理者のみ / 設計書7.5） ----

$routes[] = [
    'method' => 'POST',
    'path'   => '/api/users',
    'handler' => function ($params, $query, $body) {
        requireAdmin();
        $studentNumber = $body['student_number'] ?? null;
        $name          = $body['name'] ?? null;
        $grade         = $body['grade'] ?? null;
        $role          = ($body['role'] ?? '') === 'teacher' ? 'teacher' : 'student';

        if (!$studentNumber || !$name) throw new HttpError(400, 'student_number と name は必須です');
        if ($role === 'student') validateGrade($grade);

        $pdo = getDB();
        try {
            $stmt = $pdo->prepare('INSERT INTO users (student_number, name, role, grade) VALUES (?, ?, ?, ?)');
            $stmt->execute([(string) $studentNumber, (string) $name, $role, $role === 'teacher' ? null : $grade]);
        } catch (PDOException $e) {
            if (str_contains($e->getMessage(), 'Duplicate')) {
                throw new HttpError(409, "学番 {$studentNumber} は登録済みです");
            }
            throw $e;
        }

        $id   = (int) $pdo->lastInsertId();
        $stmt = $pdo->prepare('SELECT * FROM users WHERE id = ?');
        $stmt->execute([$id]);
        jsonResponse(201, ['user' => publicUser($stmt->fetch())]);
    },
];

$routes[] = [
    'method' => 'PATCH',
    'path'   => '/api/users/:id',
    'handler' => function ($params, $query, $body) {
        $actor = requireLogin();
        $pdo   = getDB();
        $stmt  = $pdo->prepare('SELECT * FROM users WHERE id = ?');
        $stmt->execute([$params['id']]);
        $u = $stmt->fetch();
        if (!$u) throw new HttpError(404, 'ユーザーが見つかりません');

        $isSelf = (int) $actor['id'] === (int) $u['id'];
        if (!$isSelf && !$actor['is_admin']) throw new HttpError(403, '自分の情報のみ編集できます');

        if ((isset($body['is_active']) || isset($body['is_admin'])) && !$actor['is_admin']) {
            throw new HttpError(403, 'この項目は管理者のみ変更できます');
        }

        $name          = $body['name'] ?? $u['name'];
        $grade         = $u['grade'];
        if (isset($body['grade']) && $u['role'] === 'student') $grade = validateGrade($body['grade']);
        $studentNumber = $body['student_number'] ?? $u['student_number'];
        $isActive      = isset($body['is_active']) ? ($body['is_active'] ? 1 : 0) : $u['is_active'];
        $isAdmin       = isset($body['is_admin']) ? ($body['is_admin'] ? 1 : 0) : $u['is_admin'];

        try {
            $stmt = $pdo->prepare(
                'UPDATE users SET name = ?, grade = ?, student_number = ?, is_active = ?, is_admin = ? WHERE id = ?'
            );
            $stmt->execute([$name, $grade, (string) $studentNumber, $isActive, $isAdmin, $u['id']]);
        } catch (PDOException $e) {
            if (str_contains($e->getMessage(), 'Duplicate')) {
                throw new HttpError(409, "学番 {$studentNumber} は既に使われています");
            }
            throw $e;
        }

        $stmt = $pdo->prepare('SELECT * FROM users WHERE id = ?');
        $stmt->execute([$u['id']]);
        jsonResponse(200, ['user' => publicUser($stmt->fetch())]);
    },
];

$routes[] = [
    'method' => 'DELETE',
    'path'   => '/api/users/:id',
    'handler' => function ($params, $query, $body) {
        $admin = requireAdmin();
        $pdo   = getDB();
        $stmt  = $pdo->prepare('SELECT * FROM users WHERE id = ?');
        $stmt->execute([$params['id']]);
        $u = $stmt->fetch();
        if (!$u) throw new HttpError(404, 'ユーザーが見つかりません');
        if ((int) $u['id'] === (int) $admin['id']) throw new HttpError(400, '自分自身は削除できません（別の管理者に依頼してください）');

        $cnt = $pdo->prepare('SELECT COUNT(*) AS n FROM schedule_entries WHERE user_id = ?');
        $cnt->execute([$u['id']]);
        $n = (int) $cnt->fetch()['n'];

        $del = $pdo->prepare('DELETE FROM users WHERE id = ?');
        $del->execute([$u['id']]);
        jsonResponse(200, ['ok' => true, 'deleted_user' => $u['name'], 'deleted_entries' => $n]);
    },
];

// ---- 年度更新（管理者のみ / 設計書7.5(b)） ----

$routes[] = [
    'method' => 'POST',
    'path'   => '/api/admin/year-rollover',
    'handler' => function ($params, $query, $body) {
        $admin         = requireAdmin();
        $newYear       = $body['new_year'] ?? null;
        $deleteUserIds = $body['delete_user_ids'] ?? [];
        $promotions    = $body['promotions'] ?? [];
        $newMembers    = $body['new_members'] ?? [];

        if (!is_int($newYear)) throw new HttpError(400, 'new_year (整数の年度) は必須です');
        if (in_array((int) $admin['id'], array_map('intval', $deleteUserIds), true)) {
            throw new HttpError(400, '自分自身は削除できません');
        }

        $pdo = getDB();
        $pdo->beginTransaction();
        try {
            // 1. 卒業生の削除（コマはCASCADEで消える）
            $delStmt = $pdo->prepare('DELETE FROM users WHERE id = ?');
            $deleted = 0;
            foreach ($deleteUserIds as $id) {
                $delStmt->execute([(int) $id]);
                $deleted += $delStmt->rowCount();
            }

            // 2. 在校生の進級
            $promoteStmt = $pdo->prepare("UPDATE users SET grade = ? WHERE id = ? AND role = 'student'");
            $promoted = 0;
            foreach ($promotions as $p) {
                if (empty($p['user_id']) || empty($p['new_grade'])) {
                    throw new HttpError(400, 'promotions は {user_id, new_grade} の配列で指定してください');
                }
                validateGrade($p['new_grade']);
                $promoteStmt->execute([$p['new_grade'], (int) $p['user_id']]);
                $promoted += $promoteStmt->rowCount();
            }

            // 3. 新入生の追加
            $addStmt = $pdo->prepare('INSERT INTO users (student_number, name, role, grade) VALUES (?, ?, ?, ?)');
            $added = 0;
            foreach ($newMembers as $m) {
                if (empty($m['student_number']) || empty($m['name']) || empty($m['grade'])) {
                    throw new HttpError(400, 'new_members は {student_number, name, grade} の配列で指定してください');
                }
                try {
                    $addStmt->execute([(string) $m['student_number'], (string) $m['name'], 'student', (string) $m['grade']]);
                } catch (PDOException $e) {
                    if (str_contains($e->getMessage(), 'Duplicate')) {
                        throw new HttpError(409, "学番 {$m['student_number']} は登録済みです");
                    }
                    throw $e;
                }
                $added++;
            }

            // 4. 新年度のクォーターを作成し、新1Qをアクティブに
            $labels = ['前期前半(1Q)', '前期後半(2Q)', '後期前半(3Q)', '後期後半(4Q)'];
            $insQ = $pdo->prepare('INSERT IGNORE INTO quarters (year, quarter, label) VALUES (?, ?, ?)');
            foreach ($labels as $i => $label) {
                $insQ->execute([$newYear, $i + 1, "{$newYear}年度{$label}"]);
            }
            $pdo->exec('UPDATE quarters SET is_active = 0');
            $stmt = $pdo->prepare('UPDATE quarters SET is_active = 1 WHERE year = ? AND quarter = 1');
            $stmt->execute([$newYear]);

            $pdo->commit();
            jsonResponse(200, [
                'ok'             => true,
                'deleted_users'  => $deleted,
                'promoted_users' => $promoted,
                'added_users'    => $added,
                'new_year'       => $newYear,
            ]);
        } catch (Exception $e) {
            $pdo->rollBack();
            throw $e;
        }
    },
];
