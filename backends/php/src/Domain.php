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
    return preg_replace('/^[\s\p{Z}\x{FEFF}]+|[\s\p{Z}\x{FEFF}]+$/u', '', $s) ?? $s;
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
 * Evaluate an If-Match header against the current version.
 * Returns 'ok', 'required' (428) or 'stale' (412).
 */
function checkIfMatch(?string $header, int $version): string
{
    $h = $header === null ? '' : trim($header);
    if ($h === '' || $h === '*') {
        return 'required';
    }
    foreach (explode(',', $h) as $candidate) {
        if (trim($candidate) === etagFor($version)) {
            return 'ok';
        }
    }
    return 'stale';
}

/**
 * Validate a decoded JSON body (objects decoded as stdClass so {} and [] differ).
 * @return array{0: array<string,string>, 1: list<array{field:string,message:string}>}
 */
function validateFields(mixed $data, bool $isCreate): array
{
    if (!($data instanceof stdClass)) {
        return [[], [['field' => '(body)', 'message' => 'must be a JSON object']]];
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
