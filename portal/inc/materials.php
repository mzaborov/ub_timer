<?php
declare(strict_types=1);

function portal_markdown_html(string $md): string
{
    $md = str_replace("\0", '', $md);
    $path = dirname(__DIR__) . '/vendor/Parsedown.php';
    if (is_file($path)) {
        require_once $path;
        $pd = new Parsedown();
        $pd->setSafeMode(true);
        $pd->setBreaksEnabled(true);
        return portal_md_external_links($pd->text($md));
    }
    return portal_md_external_links(portal_markdown_simple($md));
}

/** Запасной безопасный subset, если нет Parsedown. */
function portal_markdown_simple(string $md): string
{
    $md = str_replace(["\r\n", "\r"], "\n", $md);
    $blocks = preg_split("/\n{2,}/", trim($md)) ?: [];
    $out = [];
    foreach ($blocks as $block) {
        $block = trim($block);
        if ($block === '') {
            continue;
        }
        if (preg_match('/^###\s+(.+)$/u', $block, $m)) {
            $out[] = '<h3>' . portal_md_inline($m[1]) . '</h3>';
            continue;
        }
        if (preg_match('/^##\s+(.+)$/u', $block, $m)) {
            $out[] = '<h2>' . portal_md_inline($m[1]) . '</h2>';
            continue;
        }
        if (preg_match('/^#\s+(.+)$/u', $block, $m)) {
            $out[] = '<h1>' . portal_md_inline($m[1]) . '</h1>';
            continue;
        }
        if (preg_match('/^[-*]\s/u', $block)) {
            $items = preg_split("/\n/", $block) ?: [];
            $lis = '';
            foreach ($items as $item) {
                $item = preg_replace('/^[-*]\s+/u', '', $item) ?? $item;
                $lis .= '<li>' . portal_md_inline($item) . '</li>';
            }
            $out[] = '<ul>' . $lis . '</ul>';
            continue;
        }
        $out[] = '<p>' . nl2br(portal_md_inline($block), false) . '</p>';
    }
    return implode('', $out);
}

function portal_md_inline(string $s): string
{
    $s = h($s);
    $s = (string)preg_replace('/\*\*(.+?)\*\*/u', '<strong>$1</strong>', $s);
    $s = (string)preg_replace('/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/u', '<em>$1</em>', $s);
    $s = (string)preg_replace(
        '/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/u',
        '<a href="$2" rel="noopener" target="_blank">$1</a>',
        $s
    );
    $s = (string)preg_replace('/`([^`]+)`/u', '<code>$1</code>', $s);
    return $s;
}

function portal_md_external_links(string $html): string
{
    return (string)preg_replace_callback(
        '/<a\s+([^>]*?)href="(https?:\/\/[^"]+)"([^>]*)>/i',
        static function (array $m): string {
            $rest = $m[1] . $m[3];
            $extra = '';
            if (!preg_match('/\btarget=/i', $rest)) {
                $extra .= ' target="_blank"';
            }
            if (!preg_match('/\brel=/i', $rest)) {
                $extra .= ' rel="noopener"';
            }
            return '<a ' . trim($m[1]) . ' href="' . $m[2] . '"' . $m[3] . $extra . '>';
        },
        $html
    );
}

function portal_slugify(string $title): string
{
    $map = [
        'а' => 'a', 'б' => 'b', 'в' => 'v', 'г' => 'g', 'д' => 'd', 'е' => 'e', 'ё' => 'e',
        'ж' => 'zh', 'з' => 'z', 'и' => 'i', 'й' => 'y', 'к' => 'k', 'л' => 'l', 'м' => 'm',
        'н' => 'n', 'о' => 'o', 'п' => 'p', 'р' => 'r', 'с' => 's', 'т' => 't', 'у' => 'u',
        'ф' => 'f', 'х' => 'h', 'ц' => 'ts', 'ч' => 'ch', 'ш' => 'sh', 'щ' => 'sch',
        'ъ' => '', 'ы' => 'y', 'ь' => '', 'э' => 'e', 'ю' => 'yu', 'я' => 'ya',
    ];
    $s = mb_strtolower(trim($title));
    $s = strtr($s, $map);
    $s = (string)preg_replace('/[^a-z0-9]+/', '-', $s);
    $s = trim($s, '-');
    return $s !== '' ? $s : 'doc';
}

function portal_materials_table_ok(mysqli $db): bool
{
    $r = $db->query("SHOW TABLES LIKE 'material_docs'");
    return $r && $r->num_rows > 0;
}

/** Аддитивно: если таблицы нет — CREATE, без DROP. */
function portal_materials_ensure_table(mysqli $db): bool
{
    if (portal_materials_table_ok($db)) {
        return true;
    }
    $sql = 'CREATE TABLE material_docs (
      id INT NOT NULL AUTO_INCREMENT,
      title VARCHAR(255) NOT NULL,
      slug VARCHAR(191) NOT NULL,
      body_md MEDIUMTEXT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      is_visible TINYINT(1) NOT NULL DEFAULT 0,
      updated_at DATETIME NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_mat_slug (slug),
      KEY idx_mat_sort (sort_order, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4';
    try {
        $db->query($sql);
    } catch (Throwable $e) {
        return portal_materials_table_ok($db);
    }
    return portal_materials_table_ok($db);
}

/** Seed: бывший хардкод .mat-card на главной. */
function portal_mat_seed_md(): string
{
    return <<<'MD'
## О поединках

- [Правила проведения поединков (М.Заборов)](https://docs.google.com/document/d/1xLDZo9Ttmv9ElGNWQ2tAzYSDHE523KGwsCwofaGJ-30/edit?usp=drive_link)
- [Презентация о поединках для клуба](https://docs.google.com/presentation/d/1IUxWNVIlX8bzUW97SHdpAXtuNtXQuCxa/edit?usp=sharing&ouid=109144507660418421539&rtpof=true&sd=true)
- [Инструктаж по Экспрессам от Ирины Окуловой](https://disk.yandex.ru/d/sBeLRYROyVRgTg)

## Как судить

- [Памятка для судей](https://docs.google.com/presentation/d/1_tV0hz5QkF1T9_LkwOuoJxRpvLZ2EIfezVTP0sbRo2I/edit?usp=sharing)
- [Чек лист - как судить](https://disk.yandex.ru/i/AGhh7Y-l8v2FNQ)
- [Инструктаж для судей (М. Иващенко)](https://youtu.be/gRL5WQvjlMo)
- [критерии судейства экспрессов](https://disk.yandex.ru/i/jJICOWt-l8DMlA)

## Как готовиться

- [Алгоритм подготовки от Уральской школы переговоров](https://docs.google.com/presentation/d/14QaLgR-DRHu7o2h5bRwPpY-RFbcp9jT85ONv-hwCvGU/edit?usp=sharing)
- [Таблица слоев подготовки к поединку](https://drive.google.com/file/d/1-Je9sn_TMglFO8iXp-Jfp-iJ4-vjIklT/view?usp=drive_link)
- [Как готовиться (Заборов М.) - черновик](https://docs.google.com/document/d/1kXCrfJjjwQhcLXGvIR-ZCyJ09oOQtNK9H0WfwpfPy1g/edit?usp=drive_link)

### Примеры подготовки

- [Заборов М.(Xmind)](https://xmind.ai/share/pYr01Fyo)
- [Рашевский Ярослав (Excel)](https://docs.google.com/spreadsheets/d/1IkCRZnhrOSqZyhg1ycZxYEyjcsUmx4QH/edit?usp=sharing&ouid=107060050572514905027&rtpof=true&sd=true)
MD;
}

/** Одна страница материалов (slug=page). Нет строки или пустое тело — seed. */
function portal_mat_page(mysqli $db): array
{
    $seedTitle = 'Материалы';
    $seedBody = portal_mat_seed_md();
    $fallback = ['id' => 0, 'title' => $seedTitle, 'bodyMd' => $seedBody];
    if (!portal_materials_ensure_table($db)) {
        return $fallback;
    }
    $r = $db->query("SELECT id, title, body_md FROM material_docs WHERE slug = 'page' LIMIT 1");
    $row = $r ? $r->fetch_assoc() : null;
    if (!$row) {
        $now = date('Y-m-d H:i:s');
        $slug = 'page';
        $st = $db->prepare(
            'INSERT INTO material_docs (title, slug, body_md, sort_order, is_visible, updated_at)
             VALUES (?, ?, ?, 0, 1, ?)'
        );
        $st->bind_param('ssss', $seedTitle, $slug, $seedBody, $now);
        $ok = $st->execute();
        $id = (int)$db->insert_id;
        $st->close();
        if (!$ok || $id < 1) {
            return $fallback;
        }
        return ['id' => $id, 'title' => $seedTitle, 'bodyMd' => $seedBody];
    }
    $id = (int)$row['id'];
    $title = (string)($row['title'] ?? '');
    $body = (string)($row['body_md'] ?? '');
    if (trim($body) === '') {
        $body = $seedBody;
        if ($title === '') {
            $title = $seedTitle;
        }
        $now = date('Y-m-d H:i:s');
        $st = $db->prepare('UPDATE material_docs SET title = ?, body_md = ?, is_visible = 1, updated_at = ? WHERE id = ?');
        $st->bind_param('sssi', $title, $body, $now, $id);
        $st->execute();
        $st->close();
    }
    return ['id' => $id, 'title' => $title, 'bodyMd' => $body];
}

function portal_echo_materials_card(mysqli $db): void
{
    $doc = portal_mat_page($db);
    $title = trim($doc['title']);
    $html = portal_markdown_html($doc['bodyMd']);
    echo '<section class="card mat-card">';
    if ($title !== '') {
        echo '<h1>' . portal_icon('book') . ' ' . h($title) . '</h1>';
    }
    $plain = trim(html_entity_decode(strip_tags($html), ENT_QUOTES, 'UTF-8'));
    if ($plain === '' && $title === '') {
        echo '<p class="muted">Пока нет материалов.</p>';
    } else {
        echo '<div class="mat-body">' . $html . '</div>';
    }
    echo '</section>';
}
