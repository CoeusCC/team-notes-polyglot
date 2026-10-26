<?php
declare(strict_types=1);

require __DIR__ . '/../src/Domain.php';
require __DIR__ . '/../src/Store.php';
require __DIR__ . '/../src/Http.php';

$dbPath = getenv('DB_PATH') ?: '/tmp/team-notes-php.sqlite';
$schema = __DIR__ . '/../../../spec/schema.sql';
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

try {
    handle(new Store($dbPath, $schema), $_SERVER['REQUEST_METHOD'] ?? 'GET', $path);
} catch (HttpError $e) {
    sendProblem($e);
} catch (Throwable $e) {
    error_log((string) $e);
    sendProblem(new HttpError(500, 'Internal error'));
}
