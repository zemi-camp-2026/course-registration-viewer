<?php
// 時間割 API（4エンドポイント）

// ---- 閲覧（認証不要 = スポット表示にも使用） ----

$routes[] = [
    'method' => 'GET',
    'path'   => '/api/users/:id/schedule',
    'handler' => function ($params, $query, $body) {
        $quarterId = resolveQuarterId($query);
        $q = getQuarterOr404($quarterId);
        $pdo  = getDB();
        $stmt = $pdo->prepare('SELECT * FROM users WHERE id = ? AND is_active = 1');
        $stmt->execute([$params['id']]);
        $u = $stmt->fetch();
        if (!$u) throw new HttpError(404, 'ユーザーが見つかりません');
        $schedule = userSchedule((int) $u['id'], (int) $q['id']);
        jsonResponse(200, array_merge(
            ['user' => publicUser($u), 'quarter' => quarterJson($q)],
            $schedule
        ));
    },
];

// ---- 編集（認証必須・本人のみ） ----

// 一括保存: entries を丸ごと置き換える
$routes[] = [
    'method' => 'PUT',
    'path'   => '/api/users/:id/schedule',
    'handler' => function ($params, $query, $body) {
        $user      = requireSelf((int) $params['id']);
        $quarterId = resolveQuarterId($query);
        getQuarterOr404($quarterId);
        $entries = $body['entries'] ?? null;
        if (!is_array($entries)) throw new HttpError(400, 'entries (配列) が必要です');
        foreach ($entries as $e) validateCell($e['day'], $e['period']);

        $pdo = getDB();
        $pdo->beginTransaction();
        try {
            $del = $pdo->prepare('DELETE FROM schedule_entries WHERE user_id = ? AND quarter_id = ?');
            $del->execute([(int) $user['id'], $quarterId]);

            $ins = $pdo->prepare(
                'INSERT IGNORE INTO schedule_entries (user_id, quarter_id, day_of_week, period, subject_name) VALUES (?, ?, ?, ?, ?)'
            );
            foreach ($entries as $e) {
                $ins->execute([(int) $user['id'], $quarterId, (int) $e['day'], (int) $e['period'], $e['subject_name'] ?? null]);
            }
            $pdo->commit();
        } catch (Exception $e) {
            $pdo->rollBack();
            throw $e;
        }
        jsonResponse(200, userSchedule((int) $user['id'], $quarterId));
    },
];

// コマ1つ登録/更新
$routes[] = [
    'method' => 'POST',
    'path'   => '/api/users/:id/schedule/cell',
    'handler' => function ($params, $query, $body) {
        $user      = requireSelf((int) $params['id']);
        $quarterId = resolveQuarterId($query);
        getQuarterOr404($quarterId);
        $day         = $body['day'] ?? null;
        $period      = $body['period'] ?? null;
        $subjectName = $body['subject_name'] ?? null;
        validateCell($day, $period);

        $pdo  = getDB();
        $stmt = $pdo->prepare(
            'INSERT INTO schedule_entries (user_id, quarter_id, day_of_week, period, subject_name)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE subject_name = VALUES(subject_name)'
        );
        $stmt->execute([(int) $user['id'], $quarterId, (int) $day, (int) $period, $subjectName]);
        jsonResponse(201, userSchedule((int) $user['id'], $quarterId));
    },
];

// コマ1つ削除
$routes[] = [
    'method' => 'DELETE',
    'path'   => '/api/users/:id/schedule/cell',
    'handler' => function ($params, $query, $body) {
        $user      = requireSelf((int) $params['id']);
        $quarterId = resolveQuarterId($query);
        $day    = $body['day'] ?? $query['day'] ?? null;
        $period = $body['period'] ?? $query['period'] ?? null;
        validateCell($day, $period);

        $pdo  = getDB();
        $stmt = $pdo->prepare(
            'DELETE FROM schedule_entries WHERE user_id = ? AND quarter_id = ? AND day_of_week = ? AND period = ?'
        );
        $stmt->execute([(int) $user['id'], $quarterId, (int) $day, (int) $period]);
        jsonResponse(200, userSchedule((int) $user['id'], $quarterId));
    },
];
