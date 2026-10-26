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
check('if-match weak', checkIfMatch('W/"1"', 1) === 'stale');
check('if-match list hit', checkIfMatch('"9", "1"', 1) === 'ok');
check('if-match list miss', checkIfMatch('"8", "9"', 1) === 'stale');
check('if-match list with star', checkIfMatch('"1", *', 1) === 'required');
check('if-match leading zero', checkIfMatch('"01"', 1) === 'stale');
check('if-match unquoted', checkIfMatch('1', 1) === 'stale');
check('if-match empty', checkIfMatch('', 1) === 'required');
check('archived parsing', parseArchived(null) === false && parseArchived('true') === true && parseArchived('false') === false
    && parseArchived('yes') === null && parseArchived('1') === null && parseArchived('TRUE') === null && parseArchived('') === null);
check('trim nbsp/em/ideographic', trimTitle("\u{a0}hi\u{3000}") === 'hi' && trimTitle("\u{2003}hi\u{2003}") === 'hi' && trimTitle("\t\nhi\t\n") === 'hi');
check('trim keeps ZWSP and BOM', trimTitle("\u{200B}hi") === "\u{200B}hi" && trimTitle("\u{FEFF}hi\u{FEFF}") === "\u{FEFF}hi\u{FEFF}");
[, $e] = validateFields($j('"x"'), true);
check('non-object root field is $', $errFields($e) === ['$']);
[, $e] = validateFields($j('{"title":" 　"}'), true);
check('nbsp-only title rejected', $errFields($e) === ['title']);
[, $e] = validateFields($j('{"title":"​"}'), true);
check('lone ZWSP title valid', !$e);
[, $e] = validateFields($j('{"title":"t","__proto__":{}}'), true);
check('__proto__ unknown field', $errFields($e) === ['__proto__']);
[, $e] = validateFields($j('{"title":"' . str_repeat("e\u{301}", 100) . '"}'), true);
check('200 code points with combiners accepted', !$e);
[, $e] = validateFields($j('{"title":"' . str_repeat("e\u{301}", 101) . '"}'), true);
check('202 code points with combiners rejected', $errFields($e) === ['title']);
check('timestamp format', preg_match('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/', nowIso()) === 1);
check('json media type', isJsonMediaType('application/json; charset=utf-8') && !isJsonMediaType('text/plain') && !isJsonMediaType(null));
foreach (['abc' => true, 'ab' => false, 'AB' => false, 'a_b' => false, "abc\n" => false, 'a b' => false, 'team-red' => true,
    str_repeat('a', 40) => true, str_repeat('a', 41) => false, 'é-é-é' => false] as $slug => $want) {
    check('slug ' . json_encode((string) $slug), isValidSlug((string) $slug) === $want);
}
[$c, $e] = validateTeam($j('{"id":"abc","name":"  N  "}'));
check('team valid, name trimmed', $c === ['id' => 'abc', 'name' => 'N'] && !$e);
[, $e] = validateTeam($j('{"id":"AB","name":"x"}'));
check('team bad slug names id', $errFields($e) === ['id']);
[, $e] = validateTeam($j('{"id":5,"name":"   ","owner":"bob"}'));
check('team id/name/owner named', $errFields($e) === ['id', 'name', 'owner']);
[, $e] = validateTeam($j('{"id":"abc","name":"' . str_repeat('😀', 81) . '"}'));
check('team name 81 code points rejected', $errFields($e) === ['name']);
[, $e] = validateTeam($j('{}'));
check('team requires id and name', $errFields($e) === ['id', 'name']);
exit($fail ? 1 : 0);
