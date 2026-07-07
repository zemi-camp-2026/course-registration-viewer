<?php
// 学期 API（3エンドポイント）

$routes[] = [
    'method' => 'GET',
    'path'   => '/api/quarters',
    'handler' => function ($params, $query, $body) {
        $pdo  = getDB();
        $rows = $pdo->query('SELECT * FROM quarters ORDER BY year, quarter')->fetchAll();
        jsonResponse(200, ['quarters' => array_map('quarterJson', $rows)]);
    },
];

$routes[] = [
    'method' => 'POST',
    'path'   => '/api/quarters',
    'handler' => function ($params, $query, $body) {
        requireAdmin();
        $year       = $body['year'] ?? null;
        $quarter    = $body['quarter'] ?? null;
        $label      = $body['label'] ?? null;
        $startDate  = $body['start_date'] ?? null;
        $endDate    = $body['end_date'] ?? null;
        if (!$year || !$quarter || !$label) throw new HttpError(400, 'year, quarter, label は必須です');

        $pdo  = getDB();
        $stmt = $pdo->prepare('INSERT INTO quarters (year, quarter, label, start_date, end_date) VALUES (?, ?, ?, ?, ?)');
        $stmt->execute([$year, $quarter, $label, $startDate, $endDate]);
        $id = (int) $pdo->lastInsertId();

        $q = $pdo->prepare('SELECT * FROM quarters WHERE id = ?');
        $q->execute([$id]);
        jsonResponse(201, ['quarter' => quarterJson($q->fetch())]);
    },
];

$routes[] = [
    'method' => 'PATCH',
    'path'   => '/api/quarters/:id',
    'handler' => function ($params, $query, $body) {
        requireAdmin();
        $q = getQuarterOr404((int) $params['id']);

        if (!empty($body['is_active'])) {
            $pdo = getDB();
            $pdo->exec('UPDATE quarters SET is_active = 0');
            $stmt = $pdo->prepare('UPDATE quarters SET is_active = 1 WHERE id = ?');
            $stmt->execute([$q['id']]);
        }

        $pdo  = getDB();
        $stmt = $pdo->prepare('SELECT * FROM quarters WHERE id = ?');
        $stmt->execute([$q['id']]);
        jsonResponse(200, ['quarter' => quarterJson($stmt->fetch())]);
    },
];
