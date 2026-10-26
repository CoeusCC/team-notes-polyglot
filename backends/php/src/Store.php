<?php
declare(strict_types=1);

// SQLite store via PDO. The shared schema is loaded from spec/schema.sql.

final class Store
{
    private PDO $db;

    public function __construct(string $path, string $schemaFile)
    {
        $this->db = new PDO('sqlite:' . $path);
        $this->db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $this->db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        $this->db->exec('PRAGMA busy_timeout = 5000');
        $has = $this->db->query("SELECT 1 FROM sqlite_master WHERE name='notes'")->fetch();
        if (!$has) {
            $this->db->exec((string) file_get_contents($schemaFile));
        }
        $this->db->exec('PRAGMA foreign_keys = ON');
    }

    public function userByToken(string $token): ?array
    {
        $s = $this->db->prepare('SELECT id, name FROM users WHERE token_hash = ?');
        $s->execute([hash('sha256', $token)]);
        return $s->fetch() ?: null;
    }

    public function teamsOf(string $userId): array
    {
        $s = $this->db->prepare('SELECT t.id, t.name, m.role FROM memberships m JOIN teams t ON t.id = m.team_id WHERE m.user_id = ? ORDER BY t.id');
        $s->execute([$userId]);
        return $s->fetchAll();
    }

    public function isMember(string $teamId, string $userId): bool
    {
        $s = $this->db->prepare('SELECT 1 FROM memberships WHERE team_id = ? AND user_id = ?');
        $s->execute([$teamId, $userId]);
        return (bool) $s->fetch();
    }

    public function listNotes(string $teamId, bool $archived): array
    {
        $cond = $archived ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL';
        $s = $this->db->prepare("SELECT * FROM notes WHERE team_id = ? AND $cond ORDER BY seq DESC");
        $s->execute([$teamId]);
        return $s->fetchAll();
    }

    public function createNote(string $teamId, string $authorId, string $title, string $body, string $now): array
    {
        $id = self::uuid4();
        $s = $this->db->prepare('INSERT INTO notes (id, team_id, author_id, title, body, version, created_at, updated_at) VALUES (?,?,?,?,?,1,?,?)');
        $s->execute([$id, $teamId, $authorId, $title, $body, $now, $now]);
        return $this->note($id);
    }

    /** The note row if it exists (deleted or not). */
    public function note(string $id): ?array
    {
        $s = $this->db->prepare('SELECT * FROM notes WHERE id = ?');
        $s->execute([$id]);
        return $s->fetch() ?: null;
    }

    /** Compare-and-set update; returns the new row or null if the version moved. */
    public function updateNote(string $id, int $expectedVersion, array $changes, string $now): ?array
    {
        $s = $this->db->prepare('UPDATE notes SET title = COALESCE(?, title), body = COALESCE(?, body), version = version + 1, updated_at = ? WHERE id = ? AND version = ? AND deleted_at IS NULL');
        $s->execute([$changes['title'] ?? null, $changes['body'] ?? null, $now, $id, $expectedVersion]);
        return $s->rowCount() === 1 ? $this->note($id) : null;
    }

    public function softDelete(string $id, string $now): void
    {
        $s = $this->db->prepare('UPDATE notes SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL');
        $s->execute([$now, $id]);
    }

    public function restore(string $id, string $now): ?array
    {
        $s = $this->db->prepare('UPDATE notes SET deleted_at = NULL, version = version + 1, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL');
        $s->execute([$now, $id]);
        return $this->note($id);
    }

    private static function uuid4(): string
    {
        $b = random_bytes(16);
        $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
        $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
        $h = bin2hex($b);
        return sprintf('%s-%s-%s-%s-%s', substr($h, 0, 8), substr($h, 8, 4), substr($h, 12, 4), substr($h, 16, 4), substr($h, 20));
    }
}
