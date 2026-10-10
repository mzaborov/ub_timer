<?php
declare(strict_types=1);

require_once __DIR__ . '/org_sit_llm.php';
require_once __DIR__ . '/sit_plays.php';
require_once __DIR__ . '/portal_log.php';

function org_sit_name_from_code(string $code): string
{
    if (preg_match('/^\d+[a-zA-Zа-яА-ЯёЁ]*\s*[-–—]\s*(.+)$/u', $code, $m)) {
        return trim($m[1]);
    }
    return $code;
}

function org_sit_row_public(array $row): array
{
    $code = trim((string)$row['code']);
    $rolesJson = null;
    $rawRoles = trim((string)($row['roles_json'] ?? ''));
    if ($rawRoles !== '') {
        $decoded = json_decode($rawRoles, true);
        if (is_array($decoded)) {
            $rolesJson = $decoded;
        }
    }
    return [
        'id' => (int)$row['id'],
        'num' => $row['num'] !== null && $row['num'] !== '' ? (int)$row['num'] : 0,
        'code' => $code,
        'name' => org_sit_name_from_code($code),
        'type' => (string)$row['duel_type'],
        'descriptionHtml' => (string)($row['description'] ?? ''),
        'rolesJson' => $rolesJson,
        'isPublished' => (int)($row['is_published'] ?? 0) === 1,
        'reviews' => [],
    ];
}

function org_sit_payload(mysqli $db): array
{
    $res = $db->query(
        'SELECT id, code, num, duel_type, description, roles_json, is_published
         FROM situations
         ORDER BY num IS NULL, num, code'
    );
    $rows = [];
    while ($row = $res->fetch_assoc()) {
        $code = trim((string)$row['code']);
        if ($code === '') {
            continue;
        }
        $rows[] = org_sit_row_public($row);
    }
    $videos = sit_video_maps($db);
    $plays = sit_plays_by_code($db, $videos);
    $reviewBySit = $videos['reviewBySit'] ?? [];
    foreach ($rows as &$sitRow) {
        $items = sit_reviews_public($reviewBySit[(int)$sitRow['id']] ?? []);
        if ($items) {
            $sitRow['reviews'] = $items;
            $general = sit_review_url_general($items);
            if ($general !== '') {
                $sitRow['reviewUrl'] = $general;
            }
        }
    }
    unset($sitRow);
    return [
        'source' => 'mysql-org',
        'count' => count($rows),
        'rows' => $rows,
        'playsByCode' => $plays === [] ? new stdClass() : $plays,
    ];
}

function org_sit_allowed_types(): array
{
    return ['классика', 'экспресс', 'парный'];
}

function org_sit_norm_roles_json(string $raw, string $type): array
{
    $raw = trim($raw);
    if ($raw === '') {
        return ['json' => null];
    }
    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        return ['error' => 'roles_json: невалидный JSON'];
    }
    $norm = org_sit_norm_type($type);
    if ($norm === 'express') {
        $out = [];
        foreach ($decoded as $i => $r) {
            if (!is_array($r) || trim((string)($r['Role'] ?? '')) === '') {
                return ['error' => 'экспресс: у каждой роли нужно поле Role'];
            }
            $item = ['Role' => trim((string)$r['Role'])];
            if ($i === 0) {
                $ph = trim((string)($r['Phrase'] ?? ''));
                if ($ph !== '') {
                    $item['Phrase'] = $ph;
                }
            }
            $out[] = $item;
        }
        if (count($out) !== 2) {
            return ['error' => 'экспресс: нужно ровно две роли [{Role,Phrase},{Role}]'];
        }
        $flags = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT;
        return ['json' => json_encode($out, $flags)];
    }
    $out = [];
    foreach ($decoded as $r) {
        if (!is_array($r) || trim((string)($r['Role'] ?? '')) === '') {
            return ['error' => 'у роли нужно поле Role'];
        }
        $out[] = [
            'Role' => trim((string)$r['Role']),
            'Goals' => trim((string)($r['Goals'] ?? '')),
        ];
    }
    $flags = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT;
    return ['json' => json_encode($out, $flags)];
}

function org_sit_format_num(int $num): string
{
    return sprintf('%02d', $num);
}

function org_sit_build_code(int $num, string $name): string
{
    $name = trim((string)preg_replace('/\s+/u', ' ', $name));
    return org_sit_format_num($num) . '-' . $name;
}

function org_sit_read_fields(): array
{
    $id = (int)($_POST['id'] ?? 0);
    $name = trim((string)preg_replace('/\s+/u', ' ', (string)($_POST['name'] ?? '')));
    $numRaw = trim((string)($_POST['num'] ?? ''));
    $type = trim((string)($_POST['duel_type'] ?? $_POST['type'] ?? ''));
    $desc = org_sit_sanitize_html((string)($_POST['description'] ?? ''));
    $rolesRaw = (string)($_POST['roles_json'] ?? '');
    $pub = !empty($_POST['is_published']) ? 1 : 0;
    return compact('id', 'name', 'numRaw', 'type', 'desc', 'rolesRaw', 'pub');
}

function org_sit_save(mysqli $db): array
{
    $f = org_sit_read_fields();
    if ($f['name'] === '') {
        return ['error' => 'Нужно название ситуации'];
    }
    if ($f['numRaw'] === '' || !preg_match('/^-?\d+$/', $f['numRaw'])) {
        return ['error' => 'Нужен номер ситуации'];
    }
    $num = (int)$f['numRaw'];
    if ($num < 1) {
        return ['error' => 'Номер должен быть больше 0'];
    }
    if (!in_array($f['type'], org_sit_allowed_types(), true)) {
        return ['error' => 'Тип: классика, экспресс или парный'];
    }
    $roles = org_sit_norm_roles_json($f['rolesRaw'], $f['type']);
    if (!empty($roles['error'])) {
        return ['error' => $roles['error']];
    }
    $rolesJson = $roles['json'];
    $id = $f['id'];
    $code = org_sit_build_code($num, $f['name']);
    $stDup = $db->prepare('SELECT id FROM situations WHERE code = ? AND id <> ? LIMIT 1');
    $stDup->bind_param('si', $code, $id);
    $stDup->execute();
    $dup = $stDup->get_result()->fetch_assoc();
    $stDup->close();
    if ($dup) {
        return ['error' => 'Код уже занят: ' . $code];
    }
    $type = $f['type'];
    $desc = $f['desc'];
    $pub = $f['pub'];
    if ($id > 0) {
        $st = $db->prepare('SELECT id FROM situations WHERE id = ?');
        $st->bind_param('i', $id);
        $st->execute();
        $found = (bool)$st->get_result()->fetch_assoc();
        $st->close();
        if (!$found) {
            return ['error' => 'Ситуация не найдена'];
        }
        $st = $db->prepare(
            'UPDATE situations
             SET code = ?, num = ?, duel_type = ?, description = ?, roles_json = ?, is_published = ?
             WHERE id = ?'
        );
        $st->bind_param('sisssii', $code, $num, $type, $desc, $rolesJson, $pub, $id);
        $st->execute();
        $st->close();
        return ['id' => $id, 'data' => org_sit_payload($db)];
    }
    $st = $db->prepare(
        'INSERT INTO situations (code, num, duel_type, description, roles_json, is_published)
         VALUES (?, ?, ?, ?, ?, ?)'
    );
    $st->bind_param('sisssi', $code, $num, $type, $desc, $rolesJson, $pub);
    $st->execute();
    $newId = (int)$db->insert_id;
    $st->close();
    return ['id' => $newId, 'data' => org_sit_payload($db)];
}

function org_review_norm_date(string $raw): array
{
    $raw = trim($raw);
    if ($raw === '') {
        return ['date' => null];
    }
    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $raw) && !str_starts_with($raw, '0000')) {
        return ['date' => $raw];
    }
    return ['error' => 'Дата должна быть в формате ГГГГ-ММ-ДД'];
}

function org_review_norm_title(string $raw, string $url): ?string
{
    $raw = trim($raw);
    $low = function_exists('mb_strtolower') ? mb_strtolower($raw, 'UTF-8') : strtolower($raw);
    if ($raw === '' || $low === 'auto') {
        return null;
    }
    if ($low === 'разбор' || $low === 'материал') {
        return $low;
    }
    return sit_review_label($url, $raw);
}

function org_review_load(mysqli $db, int $id): ?array
{
    if ($id <= 0) {
        return null;
    }
    $st = $db->prepare(
        'SELECT id, event_id, duel_id, situation_id, url, video_date, title, video_type
         FROM videos WHERE id = ? LIMIT 1'
    );
    $st->bind_param('i', $id);
    $st->execute();
    $row = $st->get_result()->fetch_assoc();
    $st->close();
    return $row ?: null;
}

function org_review_snapshot(array $row): array
{
    return [
        'id' => (int)($row['id'] ?? 0),
        'situation_id' => (int)($row['situation_id'] ?? 0),
        'duel_id' => (int)($row['duel_id'] ?? 0),
        'event_id' => (int)($row['event_id'] ?? 0),
        'url' => (string)($row['url'] ?? ''),
        'title' => (string)($row['title'] ?? ''),
        'video_date' => (string)($row['video_date'] ?? ''),
    ];
}

function org_review_save(mysqli $db): array
{
    $id = (int)($_POST['id'] ?? 0);
    $sitId = (int)($_POST['situation_id'] ?? 0);
    $duelId = (int)($_POST['duel_id'] ?? 0);
    $eventId = (int)($_POST['event_id'] ?? 0);
    $url = trim((string)($_POST['url'] ?? ''));
    if ($sitId <= 0 && $duelId <= 0) {
        return ['error' => 'Не указана ситуация'];
    }
    if (!sit_is_http_url($url)) {
        return ['error' => 'Нужна ссылка https://…'];
    }
    if (strlen($url) > 1024) {
        return ['error' => 'Ссылка слишком длинная'];
    }
    $dateRes = org_review_norm_date((string)($_POST['video_date'] ?? ''));
    if (!empty($dateRes['error'])) {
        return ['error' => $dateRes['error']];
    }
    $videoDate = $dateRes['date'];
    $title = org_review_norm_title((string)($_POST['title'] ?? ''), $url);
    if ($duelId > 0) {
        $stD = $db->prepare('SELECT id, event_id, situation_id FROM duels WHERE id = ? LIMIT 1');
        $stD->bind_param('i', $duelId);
        $stD->execute();
        $duel = $stD->get_result()->fetch_assoc();
        $stD->close();
        if (!$duel) {
            return ['error' => 'Поединок не найден'];
        }
        $duelSit = (int)($duel['situation_id'] ?? 0);
        if ($sitId <= 0) {
            $sitId = $duelSit;
        } elseif ($duelSit > 0 && $duelSit !== $sitId) {
            return ['error' => 'Поединок относится к другой ситуации'];
        }
        if ($eventId <= 0) {
            $eventId = (int)($duel['event_id'] ?? 0);
        }
    }
    if ($sitId > 0) {
        $stSit = $db->prepare('SELECT id FROM situations WHERE id = ? LIMIT 1');
        $stSit->bind_param('i', $sitId);
        $stSit->execute();
        $sitOk = (bool)$stSit->get_result()->fetch_assoc();
        $stSit->close();
        if (!$sitOk) {
            return ['error' => 'Ситуация не найдена'];
        }
    }
    $eventBind = $eventId > 0 ? $eventId : null;
    $duelBind = $duelId > 0 ? $duelId : null;
    $sitBind = $sitId > 0 ? $sitId : null;
    $type = 'Разбор';
    $before = null;
    if ($id > 0) {
        $found = org_review_load($db, $id);
        if (!$found || (string)($found['video_type'] ?? '') !== 'Разбор') {
            return ['error' => 'Разбор не найден'];
        }
        $before = org_review_snapshot($found);
        $st = $db->prepare(
            'UPDATE videos
             SET url = ?, title = ?, video_date = ?, event_id = ?, duel_id = ?
             WHERE id = ? AND video_type = ?'
        );
        $st->bind_param('sssiiis', $url, $title, $videoDate, $eventBind, $duelBind, $id, $type);
        $st->execute();
        $st->close();
    } else {
        $st = $db->prepare(
            'INSERT INTO videos (event_id, duel_id, situation_id, url, video_date, title, video_type)
             VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        $st->bind_param('iiissss', $eventBind, $duelBind, $sitBind, $url, $videoDate, $title, $type);
        $st->execute();
        $id = (int)$db->insert_id;
        $st->close();
        if ($id <= 0) {
            return ['error' => 'Не удалось сохранить разбор'];
        }
    }
    $after = [
        'situation_id' => $sitId,
        'duel_id' => $duelId,
        'event_id' => $eventId,
        'url' => $url,
        'title' => $title,
        'video_date' => $videoDate,
    ];
    portal_log_write($db, $before ? 'review_update' : 'review_create', 'video', $id, [
        'before' => $before,
        'after' => $after,
    ]);
    return org_review_json_ok($db, $id);
}

function org_review_delete(mysqli $db): array
{
    $id = (int)($_POST['id'] ?? 0);
    $found = org_review_load($db, $id);
    if (!$found || (string)($found['video_type'] ?? '') !== 'Разбор') {
        return ['error' => 'Разбор не найден'];
    }
    $st = $db->prepare('DELETE FROM videos WHERE id = ? AND video_type = ?');
    $type = 'Разбор';
    $st->bind_param('is', $id, $type);
    $st->execute();
    $st->close();
    portal_log_write($db, 'review_delete', 'video', $id, [
        'before' => org_review_snapshot($found),
    ]);
    return org_review_json_ok($db, $id);
}

function org_review_json_ok(mysqli $db, int $id): array
{
    if ((string)($_POST['s'] ?? $_GET['s'] ?? '') === 'events') {
        return ['id' => $id, 'ok' => true];
    }
    return ['id' => $id, 'data' => org_sit_payload($db)];
}

function org_sit_handle_post(mysqli $db): array
{
    if (!portal_csrf_ok((string)($_POST['csrf'] ?? ''))) {
        return ['error' => 'Сессия устарела, обновите страницу'];
    }
    $action = (string)($_POST['action'] ?? '');
    if ($action === 'org_sit_list') {
        return ['data' => org_sit_payload($db)];
    }
    if ($action === 'org_sit_save') {
        return org_sit_save($db);
    }
    if ($action === 'org_review_save') {
        return org_review_save($db);
    }
    if ($action === 'org_review_delete') {
        return org_review_delete($db);
    }
    if ($action === 'org_sit_generate') {
        try {
            $out = org_sit_generate_markup(
                (string)($_POST['text'] ?? ''),
                (string)($_POST['duel_type'] ?? $_POST['type'] ?? ''),
                (string)($_POST['roles_plain'] ?? '')
            );
            return $out;
        } catch (Throwable $e) {
            return ['error' => $e->getMessage()];
        }
    }
    return ['error' => 'Неизвестное действие'];
}

function org_sb_asset_ver(): string
{
    $root = dirname(__DIR__, 2) . '/version.txt';
    if (is_file($root)) {
        $v = trim((string)file_get_contents($root));
        if ($v !== '') {
            return $v;
        }
    }
    return '116';
}

function portal_echo_org_situations(mysqli $db): void
{
    $data = org_sit_payload($db);
    $timer = 'https://timer.zaborov.ru';
    echo '<div class="sb-app sb-org" id="sb-org-root" data-org-situations="1">';
    echo '<div id="sb-screen-list" class="sb-screen">';
    echo '<header class="sb-header">';
    echo '<h1 class="sb-header-title">Ситуации</h1>';
    echo '<button type="button" class="sb-header-btn" id="sb-org-create" title="Создать" aria-label="Создать">';
    echo '<i class="fa-solid fa-plus"></i></button>';
    echo '<button type="button" class="sb-header-btn" id="sb-search-toggle" aria-label="Поиск">';
    echo '<i class="fa-solid fa-magnifying-glass"></i></button>';
    echo '<button type="button" class="sb-header-btn" onclick="refreshSituationsBank()" aria-label="Обновить">';
    echo '<i class="fa-solid fa-rotate"></i></button>';
    echo '</header>';
    echo '<div id="sb-search-panel" class="sb-search-panel sb-hidden">';
    echo '<input type="search" id="situations-bank-search" class="sb-search-input" placeholder="Поиск по коду, тексту, ролям…" autocomplete="off" oninput="onSituationsBankSearchInput_(event)">';
    echo '</div>';
    echo '<div id="situations-bank-status" class="sb-status sb-hidden"></div>';
    echo '<div id="situations-bank-loading" class="sb-loading sb-hidden"><div class="sb-spinner"></div></div>';
    echo '<div class="sb-table-wrap"><table class="sb-table" aria-label="Список ситуаций">';
    echo '<thead><tr><th class="sb-th-code">Код</th><th class="sb-th-type">Тип</th><th class="sb-th-chevron" aria-hidden="true"></th></tr></thead>';
    echo '<tbody id="situations-bank-list"></tbody></table></div></div>';

    echo '<div id="sb-screen-detail" class="sb-screen sb-hidden">';
    echo '<header class="sb-header">';
    echo '<button type="button" class="sb-header-btn sb-header-btn--back" onclick="situationsBankPageBack_()" aria-label="Назад">';
    echo '<i class="fa-solid fa-arrow-left"></i></button>';
    echo '<h1 class="sb-header-title">Ситуация</h1>';
    echo '<button type="button" class="sb-header-btn" id="sb-org-edit" title="Редактировать" aria-label="Редактировать">';
    echo '<i class="fa-solid fa-pen"></i></button>';
    echo '<button type="button" class="sb-header-btn" onclick="shareSituationBank_()" aria-label="Поделиться">';
    echo '<i class="fa-solid fa-share-nodes"></i></button>';
    echo '</header>';
    echo '<div id="situations-bank-detail" class="sb-detail" tabindex="0"></div>';
    echo '<div id="sb-share-toast" class="sb-share-toast sb-hidden" role="status"></div>';
    echo '</div>';

    echo '<div id="sb-editor" class="sb-editor sb-hidden" hidden>';
    echo '<form class="sb-editor-card" id="sb-editor-form" autocomplete="off">';
    echo '<h2 class="sb-editor-title" id="sb-editor-title">Новая ситуация</h2>';
    echo '<p class="sb-editor-err" id="sb-editor-err" hidden></p>';
    echo '<input type="hidden" id="sb-ed-id" value="">';
    echo '<div class="sb-ed-row">';
    echo '<label class="sb-ed-lab sb-ed-lab--num">Номер<input id="sb-ed-num" type="number" min="1" step="1" required></label>';
    echo '<label class="sb-ed-lab sb-ed-lab--name">Название<input id="sb-ed-name" type="text" required maxlength="160"></label>';
    echo '</div>';
    echo '<p class="sb-ed-code-preview">Код: <span id="sb-ed-code-preview">—</span></p>';
    echo '<label class="sb-ed-lab">Тип<select id="sb-ed-type">';
    echo '<option value="классика">классика</option>';
    echo '<option value="экспресс">экспресс</option>';
    echo '<option value="парный">парный</option>';
    echo '</select></label>';
    echo '<label class="sb-ed-check"><input type="checkbox" id="sb-ed-pub"> опубликована</label>';
    echo '<details class="sb-ed-ai-box" id="sb-ed-ai-box">';
    echo '<summary>Перегенерировать через ИИ</summary>';
    echo '<label class="sb-ed-lab">Исходный текст (для ИИ)<textarea id="sb-ed-source" rows="5" placeholder="Текст ситуации без разметки"></textarea></label>';
    echo '<label class="sb-ed-lab">Роли текстом (для ИИ, классика/парный)<textarea id="sb-ed-roles-plain" rows="3" placeholder="Роль — цель"></textarea></label>';
    echo '<div class="sb-ed-ai">';
    echo '<button type="button" class="sb-ed-btn" id="sb-ed-ai">Сгенерировать разметку</button>';
    echo '<span class="sb-ed-ai-status" id="sb-ed-ai-status"></span>';
    echo '</div></details>';
    echo '<div class="sb-ed-lab">Описание';
    echo '<div class="sb-ed-tabs" role="tablist" aria-label="Режим описания">';
    echo '<button type="button" class="sb-ed-tab is-active" id="sb-ed-tab-visual" data-desc-tab="visual" role="tab" aria-selected="true">Визуальная</button>';
    echo '<button type="button" class="sb-ed-tab" id="sb-ed-tab-html" data-desc-tab="html" role="tab" aria-selected="false">Сырой HTML</button>';
    echo '</div>';
    echo '<div id="sb-ed-pane-visual" class="sb-ed-pane" role="tabpanel">';
    echo '<div class="sb-ed-markup" role="toolbar" aria-label="Разметка описания">';
    echo '<button type="button" class="sb-ed-btn" id="sb-ed-mark-role" title="Выделенный текст — роль (&lt;strong&gt;)">Роль</button>';
    echo '<button type="button" class="sb-ed-btn" id="sb-ed-mark-phrase" title="Выделенный текст — агрессивная фраза (&lt;em&gt;)">Агрессивная фраза</button>';
    echo '<button type="button" class="sb-ed-btn" id="sb-ed-mark-unwrap" title="Снять strong/em с выделения">Снять</button>';
    echo '<span class="sb-ed-mark-hint" id="sb-ed-mark-hint"></span>';
    echo '</div>';
    echo '<div id="sb-ed-visual" class="sb-description-html sb-ed-visual" contenteditable="true" spellcheck="false"></div>';
    echo '</div>';
    echo '<div id="sb-ed-pane-html" class="sb-ed-pane sb-hidden" role="tabpanel" hidden>';
    echo '<textarea id="sb-ed-desc" rows="8" spellcheck="false"></textarea>';
    echo '</div></div>';
    echo '<div class="sb-ed-lab">Роли и интересы';
    echo '<div class="sb-ed-tabs" role="tablist" aria-label="Режим ролей">';
    echo '<button type="button" class="sb-ed-tab is-active" id="sb-ed-tab-roles-table" data-roles-tab="table" role="tab" aria-selected="true">Таблица</button>';
    echo '<button type="button" class="sb-ed-tab" id="sb-ed-tab-roles-json" data-roles-tab="json" role="tab" aria-selected="false">JSON</button>';
    echo '</div>';
    echo '<div id="sb-ed-pane-roles-table" class="sb-ed-pane" role="tabpanel">';
    echo '<table class="sb-ed-roles-table"><thead><tr>';
    echo '<th>Роль</th><th id="sb-ed-roles-col2">Интерес</th><th class="sb-ed-roles-th-del"></th>';
    echo '</tr></thead><tbody id="sb-ed-roles-tbody"></tbody></table>';
    echo '<button type="button" class="sb-ed-btn" id="sb-ed-roles-add">Добавить строку</button>';
    echo '</div>';
    echo '<div id="sb-ed-pane-roles-json" class="sb-ed-pane sb-hidden" role="tabpanel" hidden>';
    echo '<div class="sb-json-editor">';
    echo '<pre class="sb-json-hi" aria-hidden="true"><code id="sb-ed-roles-hi" class="language-json"></code></pre>';
    echo '<textarea id="sb-ed-roles" rows="10" spellcheck="false"></textarea>';
    echo '</div></div></div>';
    echo '<div class="sb-ed-actions">';
    echo '<button type="submit" class="sb-ed-btn sb-ed-btn--pri">Сохранить</button>';
    echo '<button type="button" class="sb-ed-btn" id="sb-ed-cancel">Отмена</button>';
    echo '</div></form></div>';

    echo '<div id="sb-review-editor" class="sb-editor sb-review-editor sb-hidden" hidden>';
    echo '<form class="sb-editor-card sb-review-card" id="sb-review-form" autocomplete="off">';
    echo '<h2 class="sb-editor-title" id="sb-review-title">Добавить разбор</h2>';
    echo '<p class="sb-editor-err" id="sb-review-err" hidden></p>';
    echo '<input type="hidden" id="sb-rv-id" value="">';
    echo '<input type="hidden" id="sb-rv-sit" value="">';
    echo '<input type="hidden" id="sb-rv-duel" value="0">';
    echo '<input type="hidden" id="sb-rv-event" value="0">';
    echo '<label class="sb-ed-lab">Ссылка<input id="sb-rv-url" type="url" required maxlength="1024" placeholder="https://"></label>';
    echo '<label class="sb-ed-lab">Подпись<select id="sb-rv-label">';
    echo '<option value="auto">авто (по ссылке)</option>';
    echo '<option value="разбор">разбор</option>';
    echo '<option value="материал">материал</option>';
    echo '</select><span class="sb-rv-auto-hint" id="sb-rv-auto-hint"></span></label>';
    echo '<label class="sb-ed-lab">Дата<input id="sb-rv-date" type="date"></label>';
    echo '<div class="sb-ed-actions">';
    echo '<button type="submit" class="sb-ed-btn sb-ed-btn--pri">Сохранить</button>';
    echo '<button type="button" class="sb-ed-btn" id="sb-rv-cancel">Отмена</button>';
    echo '</div></form></div>';

    echo '</div>';
    echo '<input type="hidden" id="org-sit-csrf" value="' . h(portal_csrf_token()) . '">';
    echo '<script type="application/json" id="org-sit-json">'
        . json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP)
        . '</script>';
    echo '<script>window.UB_ORG_SITUATIONS=true;window.UB_SB_ASSETS='
        . json_encode($timer, JSON_UNESCAPED_SLASHES) . ';</script>';
}
