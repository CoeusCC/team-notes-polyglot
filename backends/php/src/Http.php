<?php
declare(strict_types=1);

// HTTP adapter: parse the request, enforce precedence, call domain + store, write the response.

final class HttpError extends Exception
{
    public function __construct(public int $status, string $detail, public array $extra = [], public array $headers = [])
    {
        parent::__construct($detail);
    }
}

function sendJson(int $status, mixed $payload, array $headers = [], string $contentType = 'application/json'): void
{
    http_response_code($status);
    header('Content-Type: ' . $contentType);
    foreach ($headers as $k => $v) {
        header("$k: $v");
    }
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
}

function sendProblem(HttpError $e): void
{
    $titles = [400 => 'Bad Request', 401 => 'Unauthorized', 403 => 'Forbidden', 404 => 'Not Found', 409 => 'Conflict', 412 => 'Precondition Failed',
        413 => 'Payload Too Large', 415 => 'Unsupported Media Type', 422 => 'Unprocessable Content',
        428 => 'Precondition Required', 500 => 'Internal Server Error'];
    $title = $titles[$e->status] ?? 'Error';
    $body = ['type' => 'https://teamnotes.example/problems/' . strtolower(str_replace(' ', '-', $title)),
        'title' => $title, 'status' => $e->status, 'detail' => $e->getMessage()] + $e->extra;
    $headers = $e->headers;
    if ($e->status === 401) {
        $headers['WWW-Authenticate'] = 'Bearer';
    }
    sendJson($e->status, $body, $headers, 'application/problem+json');
}

function noteJson(array $r): array
{
    $n = ['id' => $r['id'], 'teamId' => $r['team_id'], 'authorId' => $r['author_id'], 'title' => $r['title'],
        'body' => $r['body'], 'version' => (int) $r['version'], 'createdAt' => $r['created_at'], 'updatedAt' => $r['updated_at']];
    if ($r['deleted_at'] !== null) {
        $n['deletedAt'] = $r['deleted_at'];
    }
    return $n;
}

function notFound(): HttpError
{
    return new HttpError(404, 'Resource not found');
}

/** Reads and parses the JSON body, applying 415 -> 413 -> 400 in order. */
function rejectNonJsonBody(): void
{
    $len = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
    $raw = file_get_contents('php://input');
    if (($len > 0 || ($raw !== false && $raw !== '')) && !isJsonMediaType($_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? null)) {
        throw new HttpError(415, 'Content-Type must be application/json');
    }
}

function readJsonBody(): mixed
{
    $len = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
    $raw = file_get_contents('php://input');
    $raw = $raw === false ? '' : $raw;
    $hasBody = $len > 0 || $raw !== '';
    if ($hasBody && !isJsonMediaType($_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? null)) {
        throw new HttpError(415, 'Content-Type must be application/json');
    }
    if ($len > MAX_BODY_BYTES || strlen($raw) > MAX_BODY_BYTES) {
        throw new HttpError(413, 'Request body exceeds 2 MiB', [], ['Connection' => 'close']);
    }
    $data = json_decode($raw, false, 512);
    if ($raw === '' || json_last_error() !== JSON_ERROR_NONE) {
        throw new HttpError(400, 'Malformed JSON');
    }
    return $data;
}

function validationError(array $errors): HttpError
{
    return new HttpError(422, 'Validation failed', ['errors' => $errors]);
}

function handle(Store $store, string $method, string $path): void
{
    if ($method === 'GET' && $path === '/health') {
        sendJson(200, ['status' => 'ok']);
        return;
    }
    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    $user = null;
    if (preg_match('/^Bearer +(\S+)$/i', trim($auth), $m)) {
        $user = $store->userByToken($m[1]);
    }
    if (!$user) {
        throw new HttpError(401, 'Missing or invalid bearer token');
    }
    $uid = $user['id'];
    $seg = array_map('rawurldecode', explode('/', substr($path, 1)));

    if ($path === '/me' && $method === 'GET') {
        sendJson(200, ['id' => $uid, 'name' => $user['name'], 'teams' => $store->teamsOf($uid)]);
    } elseif ($path === '/teams' && $method === 'GET') {
        sendJson(200, ['items' => $store->teamsOf($uid)]);
    } elseif ($path === '/teams' && $method === 'POST') {
        createTeamRoute($store, $uid);
    } elseif (count($seg) === 2 && $seg[0] === 'teams' && $seg[1] !== '' && $method === 'GET') {
        $role = $store->roleOf($seg[1], $uid) ?? throw notFound();
        $t = $store->team($seg[1]);
        sendJson(200, ['id' => $t['id'], 'name' => $t['name'], 'role' => $role]);
    } elseif (count($seg) === 3 && $seg[0] === 'teams' && $seg[2] === 'members' && $method === 'GET') {
        $store->isMember($seg[1], $uid) || throw notFound();
        sendJson(200, ['items' => $store->members($seg[1])]);
    } elseif (count($seg) === 4 && $seg[0] === 'teams' && $seg[2] === 'members' && $seg[3] !== '' && in_array($method, ['PUT', 'DELETE'], true)) {
        memberRoute($store, $method, $uid, $seg[1], $seg[3]);
    } elseif (count($seg) === 3 && $seg[0] === 'teams' && $seg[2] === 'notes' && in_array($method, ['GET', 'POST'], true)) {
        teamNotes($store, $method, $uid, $seg[1]);
    } elseif ($seg[0] === 'notes' && count($seg) === 2 && $seg[1] !== '' && in_array($method, ['GET', 'PATCH', 'DELETE'], true)) {
        noteRoute($store, $method, $uid, $seg[1]);
    } elseif ($seg[0] === 'notes' && count($seg) === 3 && $seg[2] === 'restore' && $method === 'POST') {
        restoreRoute($store, $uid, $seg[1]);
    } else {
        throw notFound();
    }
}

function createTeamRoute(Store $store, string $uid): void
{
    [$clean, $errors] = validateTeam(readJsonBody());
    if ($errors) {
        throw validationError($errors);
    }
    if (!$store->createTeam($clean['id'], $clean['name'], $uid)) {
        throw new HttpError(409, 'A team with this id already exists');
    }
    sendJson(201, ['id' => $clean['id'], 'name' => $clean['name'], 'role' => 'owner'], ['Location' => '/teams/' . $clean['id']]);
}

/** Precedence: 404 (non-member) -> 403 (not owner) -> 415 -> 422 (unknown user) -> 409 (last owner). */
function memberRoute(Store $store, string $method, string $uid, string $teamId, string $userId): void
{
    $role = $store->roleOf($teamId, $uid) ?? throw notFound();
    if ($role !== 'owner') {
        throw new HttpError(403, 'Only the team owner can manage members');
    }
    rejectNonJsonBody();
    if ($method === 'PUT') {
        $u = $store->user($userId);
        if (!$u) {
            throw validationError([['field' => 'userId', 'message' => 'unknown user']]);
        }
        $store->addMember($teamId, $userId);
        sendJson(200, ['id' => $u['id'], 'name' => $u['name'], 'role' => $store->roleOf($teamId, $userId)]);
        return;
    }
    if (!$store->removeMember($teamId, $userId)) {
        throw new HttpError(409, 'Cannot remove the last owner');
    }
    http_response_code(204);
}

function teamNotes(Store $store, string $method, string $uid, string $teamId): void
{
    if (!$store->isMember($teamId, $uid)) {
        throw notFound();
    }
    if ($method === 'GET') {
        $archived = parseArchived($_GET['archived'] ?? null);
        if ($archived === null) {
            throw validationError([['field' => 'archived', 'message' => 'must be true or false']]);
        }
        $rows = $store->listNotes($teamId, $archived);
        sendJson(200, ['items' => array_map('noteJson', $rows)]);
        return;
    }
    [$clean, $errors] = validateFields(readJsonBody(), true);
    if ($errors) {
        throw validationError($errors);
    }
    $n = $store->createNote($teamId, $uid, $clean['title'], $clean['body'], nowIso());
    sendJson(201, noteJson($n), ['Location' => '/notes/' . $n['id'], 'ETag' => etagFor((int) $n['version'])]);
}

/** A note the caller may see (member of its team); deleted notes only when $allowDeleted. */
function visibleNote(Store $store, string $uid, string $id, bool $allowDeleted): array
{
    $n = $store->note($id);
    if (!$n || !$store->isMember($n['team_id'], $uid) || (!$allowDeleted && $n['deleted_at'] !== null)) {
        throw notFound();
    }
    return $n;
}

function noteRoute(Store $store, string $method, string $uid, string $id): void
{
    if ($method === 'DELETE') {
        $n = visibleNote($store, $uid, $id, true);
        rejectNonJsonBody();
        $store->softDelete($n['id'], nowIso());
        http_response_code(204);
        return;
    }
    $n = visibleNote($store, $uid, $id, false);
    if ($method === 'GET') {
        sendJson(200, noteJson($n), ['ETag' => etagFor((int) $n['version'])]);
        return;
    }
    [$clean, $errors] = validateFields(readJsonBody(), false);
    if ($errors) {
        throw validationError($errors);
    }
    $check = checkIfMatch($_SERVER['HTTP_IF_MATCH'] ?? null, (int) $n['version']);
    if ($check === 'required') {
        throw new HttpError(428, 'If-Match header with the current ETag is required');
    }
    $updated = $check === 'ok' ? $store->updateNote($id, (int) $n['version'], $clean, nowIso()) : null;
    if (!$updated) {
        $cur = $store->note($id);
        throw new HttpError(412, 'If-Match does not match the current version', [], ['ETag' => etagFor((int) ($cur['version'] ?? $n['version']))]);
    }
    sendJson(200, noteJson($updated), ['ETag' => etagFor((int) $updated['version'])]);
}

function restoreRoute(Store $store, string $uid, string $id): void
{
    $n = visibleNote($store, $uid, $id, true);
    rejectNonJsonBody();
    if ($n['deleted_at'] !== null) {
        $n = $store->restore($id, nowIso());
    }
    sendJson(200, noteJson($n), ['ETag' => etagFor((int) $n['version'])]);
}
