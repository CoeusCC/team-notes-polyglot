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
        $this->db->exec('PRAGMA busy_timeout = 10000');
        $has = $this->db->query("SELECT 1 FROM sqlite_master WHERE name='notes'")->fetch();
        if (!$has) {
            // Several server workers may race to create the schema: serialize and re-check.
            $this->db->exec('BEGIN IMMEDIATE');
            if (!$this->db->query("SELECT 1 FROM sqlite_master WHERE name='notes'")->fetch()) {
                $this->db->exec((string) file_get_contents($schemaFile));
            }
            $this->db->exec('COMMIT');
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

    public function team(string $teamId): ?array
    {
        $s = $this->db->prepare('SELECT id, name FROM teams WHERE id = ?');
        $s->execute([$teamId]);
        return $s->fetch() ?: null;
    }

    public function roleOf(string $teamId, string $userId): ?string
    {
        $s = $this->db->prepare('SELECT role FROM memberships WHERE team_id = ? AND user_id = ?');
        $s->execute([$teamId, $userId]);
        $r = $s->fetch();
        return $r ? $r['role'] : null;
    }

    /** Creates the team with its owner; false if the id is taken. */
    public function createTeam(string $id, string $name, string $ownerId): bool
    {
        $this->db->exec('BEGIN IMMEDIATE');
        try {
            if ($this->team($id)) {
                $this->db->exec('ROLLBACK');
                return false;
            }
            $this->db->prepare('INSERT INTO teams (id, name, owner_id) VALUES (?,?,?)')->execute([$id, $name, $ownerId]);
            $this->db->prepare("INSERT INTO memberships (team_id, user_id, role) VALUES (?,?,'owner')")->execute([$id, $ownerId]);
            $this->db->exec('COMMIT');
            return true;
        } catch (Throwable $e) {
            $this->db->exec('ROLLBACK');
            throw $e;
        }
    }

    public function members(string $teamId): array
    {
        $s = $this->db->prepare("SELECT u.id, u.name, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.team_id = ? ORDER BY (m.role = 'owner') DESC, u.id");
        $s->execute([$teamId]);
        return $s->fetchAll();
    }

    public function user(string $id): ?array
    {
        $s = $this->db->prepare('SELECT id, name FROM users WHERE id = ?');
        $s->execute([$id]);
        return $s->fetch() ?: null;
    }

    /** Idempotent add as plain member; an existing role (e.g. owner) is kept. */
    public function addMember(string $teamId, string $userId): void
    {
        $this->db->prepare("INSERT OR IGNORE INTO memberships (team_id, user_id, role) VALUES (?,?,'member')")->execute([$teamId, $userId]);
    }

    /** Idempotent removal; false only when it would remove the last owner (atomic conditional DELETE). */
    public function removeMember(string $teamId, string $userId): bool
    {
        $s = $this->db->prepare("DELETE FROM memberships WHERE team_id = ? AND user_id = ? AND (role <> 'owner' OR (SELECT COUNT(*) FROM memberships WHERE team_id = ? AND role = 'owner') > 1)");
        $s->execute([$teamId, $userId, $teamId]);
        return $s->rowCount() === 1 || $this->roleOf($teamId, $userId) !== 'owner';
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
