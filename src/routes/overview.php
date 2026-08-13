<?php
// 全体図 + 共通空きコマ検索 API（2エンドポイント / 認証不要）

$routes[] = [
    'method' => 'GET',
    'path'   => '/api/overview',
    'handler' => function ($params, $query, $body) {
        $quarterId = resolveQuarterId($query);
        $q    = getQuarterOr404($quarterId);
        $modeRaw = $query['mode'] ?? '';
        $mode = in_array($modeRaw, ['detail', 'subject'], true) ? $modeRaw : 'summary';

        // grades= が空で渡された場合は「全解除」= 何も表示しない（パラメータ無しなら全表示）
        $gradeFilter = null;
        if (array_key_exists('grades', $query)) {
            $gradeFilter = array_filter(explode(',', $query['grades']), fn($s) => $s !== '');
        }

        $pdo  = getDB();
        $stmt = $pdo->prepare(
            'SELECT e.day_of_week AS day, e.period, e.subject_name,
                    u.id AS user_id, u.name, u.role, u.grade
             FROM schedule_entries e
             JOIN users u ON u.id = e.user_id
             WHERE e.quarter_id = ? AND u.is_active = 1
             ORDER BY e.day_of_week, e.period, u.role DESC, u.grade, u.name'
        );
        $stmt->execute([$q['id']]);
        $rows = $stmt->fetchAll();

        $byCell = [];
        foreach ($rows as $r) {
            $label = gradeLabel($r);
            if ($gradeFilter !== null && !in_array($label, $gradeFilter, true)) continue;
            $key = $r['day'] . '-' . $r['period'];
            if (!isset($byCell[$key])) {
                $byCell[$key] = [
                    'day'     => (int) $r['day'],
                    'period'  => (int) $r['period'],
                    'grades'  => [],
                    'entries' => [],
                ];
            }
            $byCell[$key]['grades'][] = $label;
            $byCell[$key]['entries'][] = [
                'user_id'      => (int) $r['user_id'],
                'name'         => $r['name'],
                'grade'        => $label,
                'subject_name' => $r['subject_name'],
            ];
        }

        $cells = [];
        foreach ($byCell as $c) {
            $cell = [
                'day'    => $c['day'],
                'period' => $c['period'],
                'grades' => $c['grades'],
                'count'  => count($c['grades']),
            ];
            $cell['entries'] = $c['entries'];
            $cells[] = $cell;
        }

        jsonResponse(200, [
            'quarter' => quarterJson($q),
            'mode'    => $mode,
            'days'    => DAYS,
            'periods' => PERIODS,
            'cells'   => $cells,
        ]);
    },
];

$routes[] = [
    'method' => 'GET',
    'path'   => '/api/free',
    'handler' => function ($params, $query, $body) {
        $quarterId = resolveQuarterId($query);
        $q = getQuarterOr404($quarterId);
        if (empty($query['users'])) throw new HttpError(400, 'users パラメータ（例: users=1,2,3）が必要です');

        $userIds = array_filter(
            array_map('intval', explode(',', $query['users'])),
            fn($n) => $n > 0
        );
        if (empty($userIds)) throw new HttpError(400, 'users に有効なユーザーIDがありません');

        $placeholders = implode(',', array_fill(0, count($userIds), '?'));
        $pdo  = getDB();
        $stmt = $pdo->prepare(
            "SELECT e.day_of_week AS day, e.period, u.id AS user_id, u.name
             FROM schedule_entries e
             JOIN users u ON u.id = e.user_id
             WHERE e.quarter_id = ? AND e.user_id IN ($placeholders)"
        );
        $stmt->execute(array_merge([$q['id']], array_values($userIds)));
        $rows = $stmt->fetchAll();

        $busy = [];
        foreach ($rows as $r) {
            $key = $r['day'] . '-' . $r['period'];
            $busy[$key] = true;
        }

        $free = [];
        foreach (DAYS as $day) {
            foreach (PERIODS as $period) {
                if (!isset($busy["$day-$period"])) {
                    $free[] = ['day' => $day, 'period' => $period];
                }
            }
        }

        jsonResponse(200, [
            'quarter'    => quarterJson($q),
            'user_ids'   => array_values($userIds),
            'days'       => DAYS,
            'periods'    => PERIODS,
            'free_cells' => $free,
        ]);
    },
];
