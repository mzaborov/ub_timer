<?php
declare(strict_types=1);

function portal_log_ensure(mysqli $db): bool
{
    $r = $db->query("SHOW TABLES LIKE 'portal_log'");
    if ($r && $r->num_rows > 0) {
        return true;
    }
    $old = $db->query("SHOW TABLES LIKE 'org_change_log'");
    if ($old && $old->num_rows > 0) {
        try {
            $db->query('RENAME TABLE org_change_log TO portal_log');
        } catch (Throwable $e) {
        }
        $r2 = $db->query("SHOW TABLES LIKE 'portal_log'");
        return $r2 && $r2->num_rows > 0;
    }
    $sql = 'CREATE TABLE portal_log (
      id INT NOT NULL AUTO_INCREMENT,
      actor_id INT NULL,
      actor_name VARCHAR(255) NULL,
      action VARCHAR(64) NOT NULL,
      entity VARCHAR(64) NOT NULL,
      entity_id INT NULL,
      payload_json TEXT NULL,
      created_at DATETIME NOT NULL,
      PRIMARY KEY (id),
      KEY idx_plog_entity (entity, entity_id),
      KEY idx_plog_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4';
    try {
        $db->query($sql);
    } catch (Throwable $e) {
    }
    $r3 = $db->query("SHOW TABLES LIKE 'portal_log'");
    return $r3 && $r3->num_rows > 0;
}

function portal_log_write(mysqli $db, string $action, string $entity, int $entityId, array $payload): void
{
    if (!portal_log_ensure($db)) {
        return;
    }
    $actorId = function_exists('current_person_id') ? current_person_id() : 0;
    $actorName = '';
    if ($actorId > 0 && function_exists('load_person')) {
        $p = load_person($db, $actorId);
        if ($p) {
            $actorName = (string)($p['full_name'] ?? '');
        }
    }
    $actorBind = $actorId > 0 ? $actorId : null;
    $entityBind = $entityId > 0 ? $entityId : null;
    $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) {
        $json = '{}';
    }
    $created = date('Y-m-d H:i:s');
    $st = $db->prepare(
        'INSERT INTO portal_log (actor_id, actor_name, action, entity, entity_id, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    $st->bind_param('isssiss', $actorBind, $actorName, $action, $entity, $entityBind, $json, $created);
    $st->execute();
    $st->close();
}
