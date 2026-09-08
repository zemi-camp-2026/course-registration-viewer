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

// ---- おすすめゼミ時間の提案（認証不要 / users パラメータで対象を指定可） ----

$routes[] = [
    'method' => 'GET',
    'path'   => '/api/recommend',
    'handler' => function ($params, $query, $body) {
        $quarterId = resolveQuarterId($query);
        $q = getQuarterOr404($quarterId);

        $pdo = getDB();

        // users パラメータがあればその人だけ、なければ全アクティブユーザー
        if (!empty($query['users'])) {
            $requestedIds = array_filter(
                array_map('intval', explode(',', $query['users'])),
                fn($n) => $n > 0
            );
            if (empty($requestedIds)) throw new HttpError(400, 'users に有効なユーザーIDがありません');
            $ph = implode(',', array_fill(0, count($requestedIds), '?'));
            $users = $pdo->prepare("SELECT id, name FROM users WHERE is_active = 1 AND id IN ($ph)");
            $users->execute(array_values($requestedIds));
            $users = $users->fetchAll();
        } else {
            $users = $pdo->query('SELECT id, name FROM users WHERE is_active = 1')->fetchAll();
        }
        $userIds = array_column($users, 'id');
        $userNames = [];
        foreach ($users as $u) $userNames[(int) $u['id']] = $u['name'];
        $total = count($userIds);

        if ($total === 0) {
            jsonResponse(200, ['recommendations' => []]);
            return;
        }

        // 全エントリーを取得
        $stmt = $pdo->prepare(
            'SELECT e.day_of_week AS day, e.period, e.user_id
             FROM schedule_entries e
             WHERE e.quarter_id = ? AND e.user_id IN ('
            . implode(',', array_fill(0, $total, '?'))
            . ')'
        );
        $stmt->execute(array_merge([$q['id']], array_map('intval', $userIds)));
        $rows = $stmt->fetchAll();

        // セルごとのビジーユーザーを集計
        $busyByCell = [];   // "day-period" => [user_id => true]
        $busyByDay  = [];   // day => [user_id => true]  （その曜日に授業がある人）
        $busyByUser = [];   // "user_id-day" => [period => true]  （隣接判定用）
        foreach ($rows as $r) {
            $key = $r['day'] . '-' . $r['period'];
            $busyByCell[$key][(int) $r['user_id']] = true;
            $busyByDay[(int) $r['day']][(int) $r['user_id']] = true;
            $busyByUser[$r['user_id'] . '-' . $r['day']][(int) $r['period']] = true;
        }

        // 各コマをスコアリング
        // 配点: 空き人数 70% + 曜日通学 15% + 隣接授業 15%  →  0〜100 に正規化
        //       時限ペナルティで最大 -5（1限・5限）
        $candidates = [];
        foreach (DAYS as $day) {
            foreach (PERIODS as $period) {
                $key = "$day-$period";
                $busyUsers = $busyByCell[$key] ?? [];
                $freeCount = $total - count($busyUsers);

                // (1) 空き人数スコア（0〜70）: ratio^2 で欠員ペナルティを強調
                //     全員空き=70, 1人欠(20人中)=63.2, 2人欠=56.7 (線形だと66.5,63.0)
                $freeRatio = ($total > 0) ? ($freeCount / $total) : 0;
                $scoreFree = ($freeRatio ** 2) * 70;

                // (2) 曜日通学ボーナス（0〜15）: 参加可能な人のうち、その曜日に授業がある人の割合
                $dayBusy = $busyByDay[$day] ?? [];
                $dayFreeAttendees = 0;
                foreach ($userIds as $uid) {
                    if (!isset($busyUsers[(int) $uid]) && isset($dayBusy[(int) $uid])) {
                        $dayFreeAttendees++;
                    }
                }
                $scoreDayAttend = ($freeCount > 0) ? ($dayFreeAttendees / $freeCount) * 15 : 0;

                // (3) 授業間隔スコア（-30〜+15）: 同じ日の最寄り授業との距離で加減点
                //     隣接(1コマ)=+1, 2コマ離れ=0, 3コマ=-1, 4コマ=-2
                //     その日に授業がない人は0（中立）
                $proximitySum = 0;
                foreach ($userIds as $uid) {
                    if (isset($busyUsers[(int) $uid])) continue;
                    $uPeriods = $busyByUser["$uid-$day"] ?? [];
                    if (empty($uPeriods)) continue; // その日授業なし → 中立
                    $minDist = PHP_INT_MAX;
                    foreach (array_keys($uPeriods) as $p) {
                        $d = abs($period - $p);
                        if ($d < $minDist) $minDist = $d;
                    }
                    // 隣接=+1, 2離れ=0, 3離れ=-1, 4離れ=-2
                    $proximitySum += 2 - $minDist;
                }
                $scoreAdj = ($freeCount > 0) ? ($proximitySum / $freeCount) * 15 : 0;

                $score = $scoreFree + $scoreDayAttend + $scoreAdj;

                // 時限ペナルティ: 1限・5限は減点（端の時限は避けたい）
                if ($period === 1 || $period === 5) $score -= 5;

                // 不参加者リスト
                $absent = [];
                foreach ($userIds as $uid) {
                    if (isset($busyUsers[(int) $uid])) {
                        $absent[] = $userNames[(int) $uid];
                    }
                }

                $candidates[] = [
                    'day'        => $day,
                    'period'     => $period,
                    'score'      => round(max($score, 0), 1),
                    'score_detail' => [
                        'free'     => round($scoreFree, 1),
                        'day'      => round($scoreDayAttend, 1),
                        'adjacent' => round($scoreAdj, 1),
                        'penalty'  => ($period === 1 || $period === 5) ? -5 : 0,
                    ],
                    'free_count' => $freeCount,
                    'total'      => $total,
                    'absent'     => $absent,
                ];
            }
        }

        // スコア降順でソートし上位5件
        usort($candidates, fn($a, $b) => $b['score'] <=> $a['score']);
        $top = array_slice($candidates, 0, 5);

        jsonResponse(200, ['recommendations' => $top]);
    },
];
