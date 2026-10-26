<?php
declare(strict_types=1);

// Pure domain: validation and rules. No I/O, no globals.

const TITLE_MAX = 200;
const BODY_MAX = 100000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const READ_ONLY_FIELDS = ['id', 'teamId', 'authorId', 'version', 'createdAt', 'updatedAt', 'deletedAt'];

function cpLength(string $s): int
{
    return mb_strlen($s, 'UTF-8');
}

function trimTitle(string $s): string
{
    // Unicode White_Space exactly (not U+200B, not U+FEFF, which are not White_Space).
    $ws = '[\x{9}-\x{D}\x{20}\x{85}\x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}]+';
    return preg_replace("/^$ws|$ws\$/u", '', $s) ?? $s;
}

function nowIso(): string
{
    $t = microtime(true);
    $sec = (int) floor($t);
    $ms = (int) floor(($t - $sec) * 1000);
    return gmdate('Y-m-d\TH:i:s', $sec) . sprintf('.%03dZ', $ms);
}

function isJsonMediaType(?string $contentType): bool
{
    if ($contentType === null) {
        return false;
    }
    $type = strtolower(trim(explode(';', $contentType, 2)[0]));
    return $type === 'application/json';
}

function etagFor(int $version): string
{
    return '"' . $version . '"';
}

/**
 * Evaluate an If-Match header against the current version (RFC 9110 strong comparison).
 * Returns 'ok', 'required' (428) or 'stale' (412). Any `*` entry gives 'required';
 * otherwise only a strong tag byte-equal to the current ETag matches (weak and unquoted never do).
 */
function checkIfMatch(?string $header, int $version): string
{
    $entries = [];
    foreach (explode(',', $header ?? '') as $e) {
        $e = trim($e, " \t");
        if ($e !== '') {
            $entries[] = $e;
        }
    }
    if (!$entries || in_array('*', $entries, true)) {
        return 'required';
    }
    return in_array(etagFor($version), $entries, true) ? 'ok' : 'stale';
}

/** Parse ?archived=: absent -> false; only "true"/"false" valid; anything else null. */
function parseArchived(mixed $v): ?bool
{
    if ($v === null) {
        return false;
    }
    return $v === 'true' ? true : ($v === 'false' ? false : null);
}

/**
 * Validate a decoded JSON body (objects decoded as stdClass so {} and [] differ).
 * @return array{0: array<string,string>, 1: list<array{field:string,message:string}>}
 */
function validateFields(mixed $data, bool $isCreate): array
{
    if (!($data instanceof stdClass)) {
        return [[], [['field' => '$', 'message' => 'must be a JSON object']]];
    }
    $fields = get_object_vars($data);
    $errors = [];
    $clean = [];
    foreach ($fields as $k => $v) {
        $k = (string) $k;
        if ($k === 'title') {
            if (!is_string($v)) {
                $errors[] = ['field' => 'title', 'message' => 'must be a string'];
                continue;
            }
            $t = trimTitle($v);
            $n = cpLength($t);
            if ($n < 1 || $n > TITLE_MAX) {
                $errors[] = ['field' => 'title', 'message' => 'must be 1-200 characters after trimming'];
            } else {
                $clean['title'] = $t;
            }
        } elseif ($k === 'body') {
            if (!is_string($v)) {
                $errors[] = ['field' => 'body', 'message' => 'must be a string'];
            } elseif (cpLength($v) > BODY_MAX) {
                $errors[] = ['field' => 'body', 'message' => 'must be at most 100000 characters'];
            } else {
                $clean['body'] = $v;
            }
        } elseif (in_array($k, READ_ONLY_FIELDS, true)) {
            $errors[] = ['field' => $k, 'message' => 'is read-only'];
        } else {
            $errors[] = ['field' => $k, 'message' => 'unknown field'];
        }
    }
    if ($isCreate) {
        if (!array_key_exists('title', $fields)) {
            $errors[] = ['field' => 'title', 'message' => 'is required'];
        }
        $clean['body'] ??= '';
    } elseif (!$fields) {
        $errors[] = ['field' => '(body)', 'message' => 'at least one of title, body is required'];
    }
    return [$clean, $errors];
}

/**
 * Validate a decoded POST /teams body: {id: slug, name}. Unknown fields are named.
 * @return array{0: array<string,string>, 1: list<array{field:string,message:string}>}
 */
function validateTeam(mixed $data): array
{
    if (!($data instanceof stdClass)) {
        return [[], [['field' => '$', 'message' => 'must be a JSON object']]];
    }
    $fields = get_object_vars($data);
    $errors = [];
    $clean = [];
    foreach ($fields as $k => $v) {
        $k = (string) $k;
        if ($k === 'id') {
            if (!is_string($v) || !isValidSlug($v)) {
                $errors[] = ['field' => 'id', 'message' => 'must match ^[a-z0-9-]{3,40}$'];
            } else {
                $clean['id'] = $v;
            }
        } elseif ($k === 'name') {
            if (!is_string($v)) {
                $errors[] = ['field' => 'name', 'message' => 'must be a string'];
                continue;
            }
            $t = trimTitle($v);
            $n = cpLength($t);
            if ($n < 1 || $n > 80) {
                $errors[] = ['field' => 'name', 'message' => 'must be 1-80 characters after trimming'];
            } else {
                $clean['name'] = $t;
            }
        } else {
            $errors[] = ['field' => $k, 'message' => 'unknown field'];
        }
    }
    foreach (['id', 'name'] as $req) {
        if (!array_key_exists($req, $fields)) {
            $errors[] = ['field' => $req, 'message' => 'is required'];
        }
    }
    return [$clean, $errors];
}

/** ^[a-z0-9-]{3,40}$ using \z so a trailing newline is not accepted. */
function isValidSlug(string $s): bool
{
    return preg_match('/^[a-z0-9-]{3,40}\z/', $s) === 1;
}
