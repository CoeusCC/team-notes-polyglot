<?php
declare(strict_types=1);
require __DIR__ . '/../src/Domain.php';

$fail = 0;
function check(string $name, bool $ok): void
{
    global $fail;
    echo ($ok ? "ok   " : "FAIL ") . $name . "\n";
    $fail += $ok ? 0 : 1;
}
$j = fn(string $s) => json_decode($s);
$errFields = fn(array $e) => array_column($e, 'field');

[$c, $e] = validateFields($j('{"title":"  hi  "}'), true);
check('title trimmed, body defaults', $c === ['title' => 'hi', 'body' => ''] && !$e);
[, $e] = validateFields($j('{"title":"   "}'), true);
check('blank title rejected', $errFields($e) === ['title']);
[, $e] = validateFields($j('{"title":"' . str_repeat('😀', 200) . '"}'), true);
check('200 emoji accepted', !$e);
[, $e] = validateFields($j('{"title":"' . str_repeat('😀', 201) . '"}'), true);
check('201 emoji rejected', $errFields($e) === ['title']);
[, $e] = validateFields($j('{"title":42}'), true);
check('numeric title rejected', $errFields($e) === ['title']);
[, $e] = validateFields($j('{"title":"t","foo":1,"version":2}'), true);
check('unknown and read-only fields named', $errFields($e) === ['foo', 'version']);
[, $e] = validateFields($j('{}'), false);
check('empty patch rejected', count($e) === 1);
[, $e] = validateFields($j('null'), false);
check('null body rejected', count($e) === 1);
[, $e] = validateFields($j('[1]'), true);
check('array body rejected', count($e) === 1);
[, $e] = validateFields($j('{"body":"' . str_repeat('b', 100001) . '"}'), false);
check('long body rejected', $errFields($e) === ['body']);
check('if-match missing', checkIfMatch(null, 1) === 'required');
check('if-match star', checkIfMatch('*', 1) === 'required');
check('if-match ok', checkIfMatch('"1"', 1) === 'ok');
check('if-match stale', checkIfMatch('"1"', 2) === 'stale');
check('timestamp format', preg_match('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/', nowIso()) === 1);
check('json media type', isJsonMediaType('application/json; charset=utf-8') && !isJsonMediaType('text/plain') && !isJsonMediaType(null));
exit($fail ? 1 : 0);
