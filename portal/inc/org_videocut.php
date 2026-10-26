<?php
declare(strict_types=1);

/** Нарезка видео: данные мероприятия, поединков и публикация ссылок в videos. */

function org_vc_events(mysqli $db): array
{
    $sql = 'SELECT e.id, e.title, e.event_type, e.starts_on, e.starts_at, e.status,
                   COUNT(d.id) AS duel_count
            FROM events e
            JOIN duels d ON d.event_id = e.id
            WHERE e.starts_on IS NOT NULL
            GROUP BY e.id, e.title, e.event_type, e.starts_on, e.starts_at, e.status
            ORDER BY e.starts_on DESC, COALESCE(e.starts_at, \'00:00:00\') DESC, e.id DESC
            LIMIT 200';
    $out = [];
    $r = $db->query($sql);
    while ($row = $r->fetch_assoc()) {
        $out[] = [
            'id' => (int)$row['id'],
            'title' => (string)$row['title'],
            'eventType' => (string)$row['event_type'],
            'startsOn' => (string)($row['starts_on'] ?? ''),
            'startsAt' => (string)($row['starts_at'] ?? ''),
            'status' => (string)$row['status'],
            'duelCount' => (int)$row['duel_count'],
        ];
    }
    return $out;
}

function org_vc_load_event(mysqli $db, int $eventId): ?array
{
    if ($eventId <= 0) {
        return null;
    }
    $st = $db->prepare(
        'SELECT id, title, event_type, starts_on, starts_at, ends_at, status
         FROM events WHERE id = ? LIMIT 1'
    );
    $st->bind_param('i', $eventId);
    $st->execute();
    $row = $st->get_result()->fetch_assoc();
    $st->close();
    if (!$row) {
        return null;
    }
    return [
        'id' => (int)$row['id'],
        'title' => (string)$row['title'],
        'eventType' => (string)$row['event_type'],
        'startsOn' => (string)($row['starts_on'] ?? ''),
        'startsAt' => (string)($row['starts_at'] ?? ''),
        'endsAt' => (string)($row['ends_at'] ?? ''),
        'status' => (string)$row['status'],
    ];
}

function org_vc_duels(mysqli $db, int $eventId): array
{
    $sql = 'SELECT d.id, d.sort_order, d.duel_type, d.round_minutes,
                   s.code AS sit_code, s.num AS sit_num,
                   p1.full_name AS p1_name, p2.full_name AS p2_name
            FROM duels d
            LEFT JOIN situations s ON s.id = d.situation_id
            LEFT JOIN people p1 ON p1.id = d.player1_id
            LEFT JOIN people p2 ON p2.id = d.player2_id
            WHERE d.event_id = ?
            ORDER BY d.sort_order ASC, d.id ASC';
    $st = $db->prepare($sql);
    $st->bind_param('i', $eventId);
    $st->execute();
    $res = $st->get_result();
    $out = [];
    while ($row = $res->fetch_assoc()) {
        $sit = trim((string)($row['sit_code'] ?? ''));
        if ($row['sit_num'] !== null && $row['sit_num'] !== '') {
            $sit = trim($sit . ' ' . (string)$row['sit_num']);
        }
        $out[] = [
            'duelId' => (int)$row['id'],
            'order' => (int)$row['sort_order'],
            'type' => (string)$row['duel_type'],
            'roundMinutes' => (int)$row['round_minutes'],
            'situation' => $sit,
            'p1' => trim((string)($row['p1_name'] ?? '')),
            'p2' => trim((string)($row['p2_name'] ?? '')),
        ];
    }
    $st->close();
    return $out;
}

/** Абсолютные метки из payload_json.server_ts (мс) и длительность по moment_sec. */
function org_vc_protocol_times(mysqli $db, int $eventId): array
{
    $sql = 'SELECT pe.duel_id, pe.moment_sec, pe.payload_json
            FROM protocol_events pe
            JOIN duels d ON d.id = pe.duel_id
            WHERE d.event_id = ?
            ORDER BY pe.duel_id ASC, pe.seq_num ASC, pe.id ASC';
    $st = $db->prepare($sql);
    $st->bind_param('i', $eventId);
    $st->execute();
    $res = $st->get_result();
    $out = [];
    while ($row = $res->fetch_assoc()) {
        $did = (int)$row['duel_id'];
        if (!isset($out[$did])) {
            $out[$did] = ['startMs' => null, 'endMs' => null, 'durationSec' => null];
        }
        $moment = $row['moment_sec'];
        if ($moment !== null && $moment !== '') {
            $m = (int)$moment;
            if ($m >= 0 && ($out[$did]['durationSec'] === null || $m > $out[$did]['durationSec'])) {
                $out[$did]['durationSec'] = $m;
            }
        }
        $payload = json_decode((string)($row['payload_json'] ?? ''), true);
        if (!is_array($payload) || !isset($payload['server_ts'])) {
            continue;
        }
        $ts = $payload['server_ts'];
        if (!is_numeric($ts)) {
            continue;
        }
        $ts = (float)$ts;
        if ($ts > 1e11) {
            $ms = (int)round($ts);
        } elseif ($ts > 1e8) {
            $ms = (int)round($ts * 1000);
        } else {
            continue;
        }
        if ($out[$did]['startMs'] === null || $ms < $out[$did]['startMs']) {
            $out[$did]['startMs'] = $ms;
        }
        if ($out[$did]['endMs'] === null || $ms > $out[$did]['endMs']) {
            $out[$did]['endMs'] = $ms;
        }
    }
    $st->close();
    return $out;
}

function org_vc_videos(mysqli $db, int $eventId): array
{
    $out = ['byDuel' => [], 'day' => null];
    $st = $db->prepare(
        'SELECT id, duel_id, url, title, video_type
         FROM videos WHERE event_id = ? ORDER BY id ASC'
    );
    $st->bind_param('i', $eventId);
    $st->execute();
    $res = $st->get_result();
    while ($row = $res->fetch_assoc()) {
        $item = [
            'id' => (int)$row['id'],
            'url' => (string)($row['url'] ?? ''),
            'title' => (string)($row['title'] ?? ''),
            'videoType' => (string)($row['video_type'] ?? ''),
        ];
        $did = (int)($row['duel_id'] ?? 0);
        if ($did > 0) {
            if (!isset($out['byDuel'][$did])) {
                $out['byDuel'][$did] = $item;
            }
        } elseif ($out['day'] === null) {
            $out['day'] = $item;
        }
    }
    $st->close();
    return $out;
}

function org_vc_event_start_ms(array $event): ?int
{
    $date = (string)($event['startsOn'] ?? '');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
        return null;
    }
    $time = (string)($event['startsAt'] ?? '');
    if (!preg_match('/^\d{2}:\d{2}(:\d{2})?$/', $time)) {
        $time = '00:00:00';
    }
    $ts = strtotime($date . ' ' . $time);
    return $ts ? $ts * 1000 : null;
}

function org_vc_payload(array $event, array $duels, array $protocol, array $videos): array
{
    $outDuels = [];
    $firstProto = null;
    foreach ($duels as $d) {
        $did = (int)$d['duelId'];
        $t = $protocol[$did] ?? ['startMs' => null, 'endMs' => null, 'durationSec' => null];
        if ($t['startMs'] !== null && ($firstProto === null || $t['startMs'] < $firstProto)) {
            $firstProto = $t['startMs'];
        }
        $video = $videos['byDuel'][$did] ?? null;
        $outDuels[] = [
            'duelId' => $did,
            'order' => (int)$d['order'],
            'type' => (string)$d['type'],
            'roundMinutes' => (int)$d['roundMinutes'],
            'situation' => (string)$d['situation'],
            'p1' => (string)$d['p1'],
            'p2' => (string)$d['p2'],
            'protoStartMs' => $t['startMs'],
            'protoEndMs' => $t['endMs'],
            'protoDurationSec' => $t['durationSec'],
            'video' => $video,
        ];
    }
    $eventStart = org_vc_event_start_ms($event);
    $recordingStart = $eventStart ?? $firstProto;
    return [
        'event' => $event,
        'duels' => $outDuels,
        'recordingStartMs' => $recordingStart,
        'eventStartMs' => $eventStart,
        'firstProtoStartMs' => $firstProto,
        'dayVideo' => $videos['day'],
    ];
}

/**
 * AJAX: сохранить ссылку на нарезанный фрагмент в videos.
 * Используется порталом после загрузки фрагмента в Drive.
 */
function org_vc_publish_video(mysqli $db, array $in): array
{
    $eventId = (int)($in['event_id'] ?? 0);
    $duelId = (int)($in['duel_id'] ?? 0);
    $url = trim((string)($in['url'] ?? ''));
    $title = trim((string)($in['title'] ?? ''));
    if ($eventId <= 0 || $duelId <= 0) {
        return ['error' => 'Не указано мероприятие или поединок'];
    }
    if ($url === '') {
        return ['error' => 'Пустая ссылка на видео'];
    }
    if (!preg_match('#^https?://#i', $url) && !preg_match('#^/#', $url)) {
        return ['error' => 'Ссылка должна начинаться с http(s):// или /'];
    }
    if (mb_strlen($url) > 1024) {
        return ['error' => 'Слишком длинная ссылка'];
    }
    if (mb_strlen($title) > 255) {
        $title = mb_substr($title, 0, 255);
    }
    $st = $db->prepare('SELECT id FROM duels WHERE id = ? AND event_id = ? LIMIT 1');
    $st->bind_param('ii', $duelId, $eventId);
    $st->execute();
    $duel = $st->get_result()->fetch_assoc();
    $st->close();
    if (!$duel) {
        return ['error' => 'Поединок не найден в этом мероприятии'];
    }
    $st = $db->prepare('SELECT starts_on FROM events WHERE id = ? LIMIT 1');
    $st->bind_param('i', $eventId);
    $st->execute();
    $ev = $st->get_result()->fetch_assoc();
    $st->close();
    $date = (string)($ev['starts_on'] ?? '');
    $videoDate = preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) ? $date : null;

    $st = $db->prepare(
        "SELECT id FROM videos WHERE duel_id = ? AND video_type = 'Поединок' ORDER BY id ASC LIMIT 1"
    );
    $st->bind_param('i', $duelId);
    $st->execute();
    $existing = $st->get_result()->fetch_assoc();
    $st->close();

    if ($existing) {
        $id = (int)$existing['id'];
        $st = $db->prepare(
            "UPDATE videos SET event_id = ?, url = ?, title = ?, video_date = ?, video_type = 'Поединок'
             WHERE id = ?"
        );
        $st->bind_param('isssi', $eventId, $url, $title, $videoDate, $id);
        $st->execute();
        $st->close();
        return ['ok' => true, 'id' => $id, 'updated' => true];
    }

    $type = 'Поединок';
    $st = $db->prepare(
        'INSERT INTO videos (event_id, duel_id, url, video_date, title, video_type)
         VALUES (?, ?, ?, ?, ?, ?)'
    );
    $st->bind_param('iissss', $eventId, $duelId, $url, $videoDate, $title, $type);
    $st->execute();
    $id = (int)$db->insert_id;
    $st->close();
    if ($id < 1) {
        return ['error' => 'Не удалось создать запись видео'];
    }
    return ['ok' => true, 'id' => $id, 'updated' => false];
}

function org_vc_handle_post(mysqli $db): array
{
    if (!portal_csrf_ok((string)($_POST['csrf'] ?? ''))) {
        return ['error' => 'Сессия устарела, обновите страницу'];
    }
    $action = (string)($_POST['action'] ?? '');
    if ($action === 'org_vc_publish_video') {
        return org_vc_publish_video($db, $_POST);
    }
    return ['error' => 'Неизвестное действие'];
}

function portal_echo_org_videocut(mysqli $db, string $error = ''): void
{
    $events = org_vc_events($db);
    $eventId = (int)($_GET['event'] ?? 0);
    $event = org_vc_load_event($db, $eventId);
    if (!$event && $events) {
        $event = org_vc_load_event($db, (int)$events[0]['id']);
    }
    $duels = $event ? org_vc_duels($db, (int)$event['id']) : [];
    $protocol = $event ? org_vc_protocol_times($db, (int)$event['id']) : [];
    $videos = $event ? org_vc_videos($db, (int)$event['id']) : ['byDuel' => [], 'day' => null];
    $payload = $event ? org_vc_payload($event, $duels, $protocol, $videos) : null;
    org_vc_render([
        'events' => $events,
        'event' => $event,
        'duels' => $duels,
        'payload' => $payload,
    ], $error);
}

function org_vc_render(array $ctx, string $error = ''): void
{
    $events = $ctx['events'];
    $event = $ctx['event'];
    $duels = $ctx['duels'];
    $payload = $ctx['payload'];
    ?>
<div class="org-vc" id="org-vc">
    <?php if ($error !== '') { ?>
    <p class="org-vc-err" role="alert"><?php echo h($error); ?></p>
    <?php } ?>

    <div class="org-vc-head">
        <form class="org-vc-event" method="get">
            <input type="hidden" name="p" value="org">
            <input type="hidden" name="s" value="videocut">
            <label class="org-vc-field org-vc-field--event">Мероприятие
                <select name="event" id="org-vc-event-select">
                    <?php if (!$events) { ?>
                    <option value="0">Нет мероприятий с поединками</option>
                    <?php } ?>
                    <?php foreach ($events as $ev) {
                        $label = $ev['title'] . ' — ' . $ev['startsOn']
                            . ($ev['startsAt'] !== '' ? ' ' . substr($ev['startsAt'], 0, 5) : '')
                            . ' (' . $ev['duelCount'] . ')';
                        ?>
                    <option value="<?php echo (int)$ev['id']; ?>"<?php echo $event && (int)$ev['id'] === (int)$event['id'] ? ' selected' : ''; ?>><?php echo h($label); ?></option>
                    <?php } ?>
                </select>
            </label>
        </form>
        <?php if ($event) { ?>
        <div class="org-vc-event-meta">
            <span class="org-vc-pill"><?php echo h($event['status']); ?></span>
            <span><?php echo h($event['startsOn']); ?><?php if ($event['startsAt'] !== '') { ?> · <?php echo h(substr($event['startsAt'], 0, 5)); ?><?php } ?></span>
            <span><?php echo count($duels); ?> поединков</span>
            <?php if ($payload && $payload['dayVideo']) { ?>
            <a class="org-vc-day-link" href="player.php?id=<?php echo (int)$payload['dayVideo']['id']; ?>" target="_blank" rel="noopener">Запись дня целиком</a>
            <?php } ?>
        </div>
        <?php } ?>
        <div class="org-vc-service">
            <span class="org-vc-dot" id="org-vc-service-dot" aria-hidden="true"></span>
            <span id="org-vc-service-text">локальный сервис не проверен</span>
            <button type="button" class="btn-ghost" id="org-vc-service-check">Проверить</button>
        </div>
    </div>

    <ol class="org-vc-steps" id="org-vc-steps">
        <li data-step="import">1. Запись</li>
        <li data-step="markup">2. Разметка</li>
        <li data-step="cut" class="is-locked">3. Нарезка</li>
        <li data-step="publish" class="is-locked">4. Публикация</li>
    </ol>

    <div class="org-vc-grid">
        <div class="org-vc-col">
            <section class="card org-vc-card org-vc-filecard">
                <div class="org-vc-file-row">
                    <label class="org-vc-file">
                        <input type="file" id="org-vc-file" accept="video/*,.mkv,.mp4,.mov,.avi,.webm">
                        <span class="org-vc-file-btn">Выбрать запись</span>
                    </label>
                    <div class="org-vc-file-meta" id="org-vc-file-meta">Файл не выбран</div>
                    <button type="button" class="btn-ghost" id="org-vc-clear">Убрать</button>
                </div>
                <p class="org-vc-hint">Файл не загружается на сервер: браузер читает его локально. Нарезка пойдёт через локальный ffmpeg-сервис. Записи Zoom обычно лежат в <code>Документы\Zoom</code> (<code>C:\Users\...\Documents\Zoom</code>).</p>
            </section>

            <section class="card org-vc-card org-vc-playercard">
                <video id="org-vc-video" controls playsinline preload="metadata"></video>
                <p class="org-vc-player-empty" id="org-vc-player-empty">Выберите файл записи, чтобы увидеть превью и таймлайн.</p>
                <div class="org-vc-nudge-wrap" id="org-vc-nudge" hidden>
                    <div class="org-vc-nudge" aria-label="Навигация по видео">
                        <button type="button" data-nudge="-60" title="Назад на 60 секунд">−60</button>
                        <button type="button" data-nudge="-30" title="Назад на 30 секунд">−30</button>
                        <button type="button" data-nudge="-15" title="Назад на 15 секунд">−15</button>
                        <button type="button" data-nudge="-5" title="Назад на 5 секунд">−5</button>
                        <button type="button" data-nudge="-1" title="Назад на 1 секунду">−1</button>
                        <button type="button" class="org-vc-nudge-mark" id="org-vc-mark-start" title="Поставить начало выбранного поединка в текущей позиции; старт выравнивается по ближайшему полному кадру слева">точка начала</button>
                        <button type="button" data-nudge="1" title="Вперёд на 1 секунду">+1</button>
                        <button type="button" data-nudge="5" title="Вперёд на 5 секунд">+5</button>
                        <button type="button" data-nudge="15" title="Вперёд на 15 секунд">+15</button>
                        <button type="button" data-nudge="30" title="Вперёд на 30 секунд">+30</button>
                        <button type="button" data-nudge="60" title="Вперёд на 60 секунд">+60</button>
                    </div>
                    <p class="org-vc-nudge-note">Шаг — секунды. «точка начала» ставит начало выбранного поединка по левому полному кадру; fps — в параметрах нарезки.</p>
                </div>
            </section>

            <section class="card org-vc-card org-vc-tl">
                <div class="org-vc-tl-bar">
                    <div class="org-vc-zoom">
                        <button type="button" class="btn-ghost" data-zoom="out" title="Уменьшить масштаб">−</button>
                        <button type="button" class="btn-ghost" data-zoom="fit">Вся запись</button>
                        <button type="button" class="btn-ghost" data-zoom="in" title="Увеличить масштаб">+</button>
                    </div>
                    <label class="org-vc-field">Старт записи
                        <input type="datetime-local" id="org-vc-rec-start" step="1">
                    </label>
                    <label class="org-vc-field">Сдвиг, с
                        <input type="number" id="org-vc-shift" step="0.1" value="0">
                    </label>
                    <button type="button" class="btn-ghost" id="org-vc-auto">Разложить по протоколу</button>
                </div>
                <canvas id="org-vc-canvas" height="118" tabindex="0" aria-label="Таймлайн поединков"></canvas>
                <div class="org-vc-legend">
                    <span><i class="org-vc-dot-mark org-vc-dot-mark--proto"></i> протокол</span>
                    <span><i class="org-vc-dot-mark org-vc-dot-mark--guess"></i> расчёт</span>
                    <span><i class="org-vc-dot-mark org-vc-dot-mark--manual"></i> вручную</span>
                    <span><i class="org-vc-dot-mark org-vc-dot-mark--warn"></i> требует проверки</span>
                    <span class="org-vc-tl-hint">Колесо — зум, края блоков — границы, клик по блоку — выбор и перемотка</span>
                </div>
            </section>
        </div>

        <aside class="org-vc-col org-vc-side">
            <section class="card org-vc-card org-vc-inspector">
                <h2>Проверка границ</h2>
                <div class="org-vc-selected" id="org-vc-selected">Поединок не выбран</div>
                <div class="org-vc-frames">
                    <figure>
                        <canvas id="org-vc-frame-start" width="320" height="180"></canvas>
                        <figcaption>Начало <b id="org-vc-frame-start-t">—</b></figcaption>
                    </figure>
                    <figure>
                        <canvas id="org-vc-frame-end" width="320" height="180"></canvas>
                        <figcaption>Финиш <b id="org-vc-frame-end-t">—</b></figcaption>
                    </figure>
                </div>
                <ul class="org-vc-issues" id="org-vc-issues" hidden></ul>
            </section>

            <section class="card org-vc-card org-vc-settings">
                <h2>Параметры нарезки</h2>
                <div class="org-vc-settings-grid">
                    <label class="org-vc-field">CRF
                        <input type="number" id="org-vc-crf" min="0" max="51" step="1" value="20">
                    </label>
                    <label class="org-vc-field">Пресет
                        <select id="org-vc-preset">
                            <option value="ultrafast">ultrafast</option>
                            <option value="veryfast">veryfast</option>
                            <option value="faster">faster</option>
                            <option value="fast">fast</option>
                            <option value="medium" selected>medium</option>
                            <option value="slow">slow</option>
                        </select>
                    </label>
                    <label class="org-vc-field">fps записи
                        <input type="number" id="org-vc-fps" min="1" max="240" step="0.001" value="25" title="Частота кадров записи; для Zoom обычно 25">
                    </label>
                    <label class="org-vc-field org-vc-field--wide">Шаблон имени
                        <input type="text" id="org-vc-template" value="{дата}_{мероприятие}_{номер}_{игрок1}_vs_{игрок2}.mp4">
                    </label>
                    <label class="org-vc-field">Пауза между, с
                        <input type="number" id="org-vc-gap" min="0" step="0.5" value="2">
                    </label>
                    <label class="org-vc-field">Хвост после, с
                        <input type="number" id="org-vc-tail" min="0" step="0.5" value="5">
                    </label>
                </div>
                <div class="org-vc-settings-actions">
                    <button type="button" class="btn-ghost" id="org-vc-export">Скачать JSON разметки</button>
                    <button type="button" class="btn-ghost" id="org-vc-clear-draft">Очистить черновик</button>
                </div>
                <p class="org-vc-hint">Черновик хранится в браузере. Нарезка и загрузка станут доступны после запуска локального сервиса.</p>
            </section>

            <section class="card org-vc-card org-vc-duels">
                <div class="org-vc-duels-head">
                    <h2>Поединки <span id="org-vc-count"></span></h2>
                    <label class="org-vc-search"><input type="search" id="org-vc-search" placeholder="поиск по игроку"></label>
                </div>
                <div class="org-vc-duel-list" id="org-vc-duel-list"></div>
                <p class="org-vc-empty" id="org-vc-no-duels"<?php echo $duels ? ' hidden' : ''; ?>>У мероприятия нет поединков.</p>
            </section>
        </aside>
    </div>

    <div class="org-vc-footer">
        <span id="org-vc-save-state" class="org-vc-save-state">Черновик не сохранён</span>
        <button type="button" class="is-pri" id="org-vc-cut" disabled title="Нужен локальный сервис нарезки">Нарезать</button>
        <button type="button" class="is-pri" id="org-vc-publish" disabled title="Нужен локальный сервис нарезки">Опубликовать</button>
    </div>
</div>
<input type="hidden" id="org-vc-csrf" value="<?php echo h(portal_csrf_token()); ?>">
<script type="application/json" id="org-vc-data"><?php
echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP);
?></script>
    <?php
}
