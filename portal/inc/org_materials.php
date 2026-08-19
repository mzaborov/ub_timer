<?php
declare(strict_types=1);

require_once __DIR__ . '/materials.php';

function org_mat_save(mysqli $db): array
{
    if (!portal_materials_ensure_table($db)) {
        return ['error' => 'Нет таблицы material_docs'];
    }
    $page = portal_mat_page($db);
    $id = (int)$page['id'];
    $title = trim((string)($_POST['title'] ?? ''));
    $body = (string)($_POST['body_md'] ?? '');
    $now = date('Y-m-d H:i:s');
    if ($id < 1) {
        $slug = 'page';
        $st = $db->prepare(
            'INSERT INTO material_docs (title, slug, body_md, sort_order, is_visible, updated_at)
             VALUES (?, ?, ?, 0, 1, ?)'
        );
        $st->bind_param('ssss', $title, $slug, $body, $now);
        $ok = $st->execute();
        $id = (int)$db->insert_id;
        $st->close();
        if (!$ok || $id < 1) {
            return ['error' => 'Не удалось сохранить'];
        }
    } else {
        $st = $db->prepare(
            'UPDATE material_docs SET title = ?, body_md = ?, is_visible = 1, updated_at = ? WHERE id = ?'
        );
        $st->bind_param('sssi', $title, $body, $now, $id);
        $st->execute();
        $st->close();
    }
    $page = [
        'id' => $id,
        'title' => $title,
        'bodyMd' => $body,
    ];
    return $page;
}

function org_mat_handle_post(mysqli $db): array
{
    if (!portal_csrf_ok((string)($_POST['csrf'] ?? ''))) {
        return ['error' => 'Сессия устарела, обновите страницу'];
    }
    $action = (string)($_POST['action'] ?? '');
    if ($action === 'org_mat_save') {
        return org_mat_save($db);
    }
    return ['error' => 'Неизвестное действие'];
}

function portal_echo_org_materials(mysqli $db): void
{
    $doc = portal_mat_page($db);
    echo '<div class="org-mat" id="org-mat">';
    echo '<p class="org-mat-err" id="org-mat-err" hidden></p>';
    echo '<form class="card org-mat-form" id="org-mat-form">';
    echo '<input type="hidden" id="org-mat-id" value="' . (int)$doc['id'] . '">';
    echo '<label>Заголовок <span class="muted">(необязательно)</span>';
    echo '<input type="text" id="org-mat-title" value="' . h($doc['title']) . '"></label>';
    echo '<div class="org-mat-split">';
    echo '<label>Markdown<textarea id="org-mat-body">' . h($doc['bodyMd']) . '</textarea></label>';
    echo '<div><div class="muted org-mat-preview-lab">Предпросмотр</div>';
    echo '<div class="org-mat-preview mat-card" id="org-mat-preview"></div></div>';
    echo '</div>';
    echo '<div class="org-mat-actions">';
    echo '<button type="submit" class="is-pri" id="org-mat-save">Сохранить</button>';
    echo '<span class="org-mat-ok" id="org-mat-ok" hidden>Сохранено</span>';
    echo '</div></form>';
    echo '</div>';
    echo '<input type="hidden" id="org-mat-csrf" value="' . h(portal_csrf_token()) . '">';
}
