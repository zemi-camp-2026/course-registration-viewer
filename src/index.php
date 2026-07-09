<?php
// エントリポイント: すべての /api/* リクエストをここでルーティングする

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/helpers.php';

// ---- セッション設定 ----
ini_set('session.gc_maxlifetime', 30 * 24 * 3600); // 30日
session_name('olab_session');
session_set_cookie_params([
    'lifetime' => 30 * 24 * 3600,
    'path'     => '/',
    'httponly'  => true,
    'samesite'  => 'Lax',
]);
session_start();

// ---- リクエスト解析 ----
$method = $_SERVER['REQUEST_METHOD'];

// PATCH/DELETE をサポートしない共用ホスティング向けのメソッドオーバーライド
if ($method === 'POST' && !empty($_SERVER['HTTP_X_HTTP_METHOD_OVERRIDE'])) {
    $override = strtoupper($_SERVER['HTTP_X_HTTP_METHOD_OVERRIDE']);
    if (in_array($override, ['PATCH', 'PUT', 'DELETE'], true)) {
        $method = $override;
    }
}

$uri   = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$query = $_GET;
$body  = null;

if (in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true)) {
    $raw = file_get_contents('php://input');
    if ($raw !== '' && $raw !== false) {
        $body = json_decode($raw, true);
        if (json_last_error() !== JSON_ERROR_NONE) {
            jsonResponse(400, ['error' => 'リクエストボディが JSON として解釈できません']);
        }
    }
}

// ---- 開発モード: ユーザーが0件ならサンプルデータを自動投入 ----
if (OLAB_ENV === 'development') {
    $n = (int) getDB()->query('SELECT COUNT(*) FROM users')->fetchColumn();
    if ($n === 0) {
        require_once __DIR__ . '/seed.php';
        populateSampleData();
    }
}

// ---- ルート登録 ----
$routes = [];
require_once __DIR__ . '/routes/auth.php';
require_once __DIR__ . '/routes/quarters.php';
require_once __DIR__ . '/routes/users.php';
require_once __DIR__ . '/routes/schedule.php';
require_once __DIR__ . '/routes/overview.php';

// ---- ルート照合・ディスパッチ ----
foreach ($routes as $route) {
    if ($route['method'] !== $method) continue;
    $params = matchPath($route['path'], $uri);
    if ($params === null) continue;
    try {
        ($route['handler'])($params, $query, $body);
    } catch (HttpError $e) {
        jsonResponse($e->status, ['error' => $e->getMessage()]);
    } catch (Exception $e) {
        error_log($e->getMessage() . "\n" . $e->getTraceAsString());
        jsonResponse(500, ['error' => 'internal server error']);
    }
    exit;
}

jsonResponse(404, ['error' => "no route: $method $uri"]);
