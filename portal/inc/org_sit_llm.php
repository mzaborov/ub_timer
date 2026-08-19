<?php
declare(strict_types=1);

/** Точечная генерация разметки ситуации. Промпты как в GAS enrich-situations.gs. */

function portal_llm_config(): array
{
    global $qwen_api_key, $llm_provider, $qwen_model;
    $key = isset($qwen_api_key) ? trim((string)$qwen_api_key) : '';
    $prov = isset($llm_provider) ? strtolower(trim((string)$llm_provider)) : 'openrouter';
    if ($prov === '') {
        $prov = 'openrouter';
    }
    $model = isset($qwen_model) ? trim((string)$qwen_model) : '';
    if ($model === '') {
        $model = $prov === 'dashscope' ? 'qwen-plus' : 'qwen/qwen-plus';
    }
    return ['key' => $key, 'provider' => $prov, 'model' => $model];
}

function org_sit_norm_type(string $raw): string
{
    $t = mb_strtolower(trim($raw));
    if ($t === '') {
        return '';
    }
    if (str_contains($t, 'экспресс') || $t === 'express') {
        return 'express';
    }
    if (str_contains($t, 'парн') || $t === 'pair') {
        return 'pair';
    }
    if (str_contains($t, 'классик') || $t === 'classic') {
        return 'classic';
    }
    return '';
}

function org_sit_type_label(string $norm): string
{
    return match ($norm) {
        'express' => 'экспресс',
        'pair' => 'парный',
        default => 'классика',
    };
}

function org_sit_build_prompt(string $duelType, string $description, string $rolesPlain): string
{
    $rolesBlock = $rolesPlain !== ''
        ? $rolesPlain
        : '(пусто — выведи роли из текста ситуации)';

    $descScopeRules = implode("\n", [
        '- SituationDescription = ТОЛЬКО текст ситуации из блока «Полное описание» (ниже), одна строка',
        '- НЕ копируй в SituationDescription блок «Роли и интересы», цели (Goals) и интересы ролей',
    ]);
    $roleHighlightRules = implode("\n", [
        '- Список ролей для выделения возьми из блока «Роли и интересы» (имя роли до тире «—»)',
        '- Выделяй роль только когда в тексте говорится об УЧАСТНИКЕ поединка из списка, а не о должности в прошлом или в общем смысле',
        '- НЕ выделяй должность как описание чужой/прошлой работы: «работал …», «бывший …», «уволившийся …» — если речь о другом человеке',
        '- Пример НЕ выделять: «<strong>старый знакомый</strong>, который также работал финансовым директором» — «финансовым директором» не трогай',
        '- Пример выделять: «<strong>Финансовый директор</strong> принимает предложение» — это участник ситуации',
        '- Пример: «зарплата уволившегося финансового директора – <strong>старого знакомого</strong>» — выдели знакомого; «финансового директора» = бывший ФД, не участник',
        '- Пройди текст и выдели КАЖДОЕ упоминание участника в его роли, во всех падежах и регистре (кроме исключений выше)',
        '- Не пропускай вхождение из-за маленькой буквы: «старый знакомый» и «Старый знакомый» — одна роль, оба выделяй',
        '- Описательные роли из нескольких слов выделяй целиком, регистр внутри <strong> — как в исходном тексте',
    ]);

    if ($duelType === 'express') {
        $descSpec = implode("\n", [
            '1. SituationDescription:',
            $descScopeRules,
            $roleHighlightRules,
            '- ОБЯЗАТЕЛЬНО выдели <em> КАЖДУЮ агрессивную реплику (роли — <strong>, реплики — <em>):',
            '  • текст после тире «—» / «–» (тире и пробел перед репликой НЕ внутри тега)',
            '  • текст в кавычках "..." или «...»; кавычки снаружи тега',
            '- Пример: говорит: — <em>Смотрю вот на результаты. Может, другого нанять?</em>',
            '- Пример: удивился: "<em>Это что за сборная солянка?</em>", ответил: — <em>Это всё, что выдал ИИ.</em>',
            '- Если внутри реплики есть роль — роль в <strong> внутри <em> (вложенность допустима)',
            '- Агрессивные реплики — прямая речь персонажей; выделяй только реплику, не весь абзац',
            '- НЕ используй <br> или другие переносы строк',
            '- Сохрани текст в ОДНУ строку',
            '- НЕ изменяй исходный текст, только добавь выделение ролей и реплик',
        ]);
        $rolesSpec = implode("\n", [
            '2. SituationRoles:',
            '- JSON-массив из РОВНО ДВУХ объектов в формате ub-timer:',
            '- Первый: {"Role": "...", "Phrase": "агрессивная фраза"} — роль, которая её произносит',
            '- Второй: ТОЛЬКО {"Role": "..."} — поля Phrase у второй роли НЕТ',
            '- НЕ дублируй одну и ту же Phrase у обеих ролей',
            '- Агрессивная фраза (Phrase) ВСЕГДА одна и ВСЕГДА ПОСЛЕДНЯЯ прямая речь в тексте',
            '- Бери текст после последнего тире «—»/«–»; если тире нет — текст из последних кавычек',
            '- Предыдущие реплики НЕ являются Phrase (пример: "Это что за сборная солянка?" — НЕ Phrase)',
            '- Пример верного Phrase: «Это всё, что выдал мне ИИ по запросу. Всё, как Вы учили!»',
            '- Phrase без тегов <strong>/<em>, без кавычек-обёрток, без самого знака «—»',
            '- Пример: [{"Role":"Специалист","Phrase":"Это всё, что выдал мне ИИ..."},{"Role":"Руководитель"}]',
            '- Если «Роли и интересы» пусты — две главные роли из текста ситуации',
            '- Тип ситуации: Экспресс',
        ]);
        $extra = '- Экспресс: SituationRoles = [{"Role","Phrase"},{"Role"}]; Phrase = ПОСЛЕДНЯЯ прямая речь; прямые речи в HTML в <em>; роли в <strong>';
        $example = '{"SituationDescription":"...","SituationRoles":[{"Role":"...","Phrase":"..."},{"Role":"..."}]}';
    } else {
        $descSpec = implode("\n", [
            '1. SituationDescription:',
            $descScopeRules,
            $roleHighlightRules,
            '- НЕ используй <br> или другие переносы строк',
            '- Сохрани текст в ОДНУ строку',
            '- НЕ изменяй исходный текст, только добавь выделение ролей',
        ]);
        $rolesSpec = implode("\n", [
            '2. SituationRoles:',
            '- JSON-массив объектов: {"Role": "...", "Goals": "..."}',
            '- Формулировки Role и Goals — точно как во входных данных',
            '- JSON с отступами для читаемости',
        ]);
        $extra = '';
        $example = '{"SituationDescription":"...","SituationRoles":[{"Role":"...","Goals":"..."}]}';
    }

    return implode("\n", [
        'Ты — эксперт по созданию управленческих ситуаций для бизнес-тренингов. Твоя задача — преобразовать входные данные в формат для Excel-таблицы.',
        '',
        'ВХОДНЫЕ ДАННЫЕ:',
        '1. Текст ситуации (описание конфликта)',
        '2. Роли и их интересы (список ролей с целями)',
        '',
        'ТРЕБУЕМЫЙ ВЫВОД:',
        '',
        $descSpec,
        '',
        $rolesSpec,
        '',
        'ПРАВИЛА:',
        '- Выделяй только участников из «Роли и интересы», НЕ отделы и абстракции',
        '- Участник — при каждом упоминании (все падежи/регистр), кроме должности в прошлом у другого лица',
        '- SituationDescription без блока «Роли и интересы» — цели только в SituationRoles (JSON)',
        $extra,
        '- Сохраняй всю пунктуацию, кавычки, регистр букв из исходного текста',
        '- НЕ добавляй пояснений',
        '',
        'СГЕНЕРИРУЙ SituationDescription и SituationRoles для следующей ситуации:',
        '',
        $description,
        '',
        'РОЛИ И ИНТЕРЕСЫ:',
        $rolesBlock,
        '',
        'Верни ТОЛЬКО JSON-объект (без markdown, без пояснений) вида:',
        $example,
    ]);
}

function org_sit_http_json(string $url, array $headers, string $payload, int $timeout = 60): string
{
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        $hdr = [];
        foreach ($headers as $k => $v) {
            $hdr[] = $k . ': ' . $v;
        }
        $hdr[] = 'Content-Type: application/json';
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => $hdr,
            CURLOPT_POSTFIELDS => $payload,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_CONNECTTIMEOUT => 15,
        ]);
        $body = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        if ($body === false) {
            throw new RuntimeException('LLM сеть: ' . $err);
        }
        if ($code < 200 || $code >= 300) {
            throw new RuntimeException('LLM HTTP ' . $code . ': ' . mb_substr((string)$body, 0, 500));
        }
        return (string)$body;
    }
    $h = "Content-type: application/json\r\n";
    foreach ($headers as $k => $v) {
        $h .= $k . ': ' . $v . "\r\n";
    }
    $ctx = stream_context_create([
        'http' => [
            'method' => 'POST',
            'header' => $h,
            'content' => $payload,
            'timeout' => $timeout,
            'ignore_errors' => true,
        ],
    ]);
    $body = @file_get_contents($url, false, $ctx);
    if ($body === false) {
        throw new RuntimeException('LLM сеть: нет ответа');
    }
    return $body;
}

function org_sit_call_llm(string $prompt): string
{
    $cfg = portal_llm_config();
    if ($cfg['key'] === '') {
        throw new RuntimeException('Нет QWEN_API_KEY в конфиге сервера (secrets.env → db.inc.php)');
    }
    $headers = ['Authorization' => 'Bearer ' . $cfg['key']];
    if ($cfg['provider'] === 'dashscope') {
        $url = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
    } else {
        $url = 'https://openrouter.ai/api/v1/chat/completions';
        $headers['HTTP-Referer'] = 'https://ciocdo-org-skills.zaborov.ru/';
        $headers['X-OpenRouter-Title'] = 'ub-timer org situations';
    }
    $payload = json_encode([
        'model' => $cfg['model'],
        'messages' => [
            ['role' => 'system', 'content' => 'Отвечай строго JSON-объектом. Без markdown-обёрток.'],
            ['role' => 'user', 'content' => $prompt],
        ],
        'temperature' => 0.2,
        'max_tokens' => 4096,
        'response_format' => ['type' => 'json_object'],
    ], JSON_UNESCAPED_UNICODE);
    $raw = org_sit_http_json($url, $headers, (string)$payload);
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        throw new RuntimeException('LLM: ответ не JSON');
    }
    $content = $data['choices'][0]['message']['content'] ?? '';
    if (!is_string($content) || trim($content) === '') {
        throw new RuntimeException('Пустой ответ LLM (' . $cfg['provider'] . ')');
    }
    return trim($content);
}

function org_sit_extract_json_object(string $text): ?string
{
    $s = trim($text);
    $start = strpos($s, '{');
    if ($start === false) {
        return null;
    }
    $depth = 0;
    $inStr = false;
    $esc = false;
    $len = strlen($s);
    for ($i = $start; $i < $len; $i++) {
        $ch = $s[$i];
        if ($esc) {
            $esc = false;
            continue;
        }
        if ($inStr) {
            if ($ch === '\\') {
                $esc = true;
            } elseif ($ch === '"') {
                $inStr = false;
            }
            continue;
        }
        if ($ch === '"') {
            $inStr = true;
            continue;
        }
        if ($ch === '{') {
            $depth++;
        } elseif ($ch === '}') {
            $depth--;
            if ($depth === 0) {
                return substr($s, $start, $i - $start + 1);
            }
        }
    }
    return null;
}

function org_sit_parse_llm(string $raw): array
{
    $text = trim($raw);
    $text = (string)preg_replace('/^```(?:json)?\s*/i', '', $text);
    $text = (string)preg_replace('/\s*```$/i', '', $text);
    $jsonStr = org_sit_extract_json_object($text) ?? $text;
    $obj = json_decode($jsonStr, true);
    if (is_array($obj) && (isset($obj['SituationDescription']) || isset($obj['SituationRoles']))) {
        $roles = $obj['SituationRoles'] ?? [];
        if (is_string($roles)) {
            $roles = json_decode($roles, true) ?: [];
        }
        return [
            'SituationDescription' => isset($obj['SituationDescription']) ? (string)$obj['SituationDescription'] : '',
            'SituationRoles' => is_array($roles) ? $roles : [],
        ];
    }
    throw new RuntimeException('Ответ не содержит SituationDescription и SituationRoles');
}

function org_sit_sanitize_html(string $html): string
{
    $html = (string)preg_replace('#<script\b[^>]*>.*?</script>#is', '', $html);
    $html = (string)preg_replace('#<iframe\b[^>]*>.*?</iframe>#is', '', $html);
    $html = (string)preg_replace('#<object\b[^>]*>.*?</object>#is', '', $html);
    $html = (string)preg_replace('/\son\w+\s*=\s*("[^"]*"|\'[^\']*\'|[^\s>]+)/i', '', $html);
    $html = (string)preg_replace('#javascript:#i', '', $html);
    $html = (string)preg_replace('#<br\s*/?>#i', ' ', $html);
    $html = (string)preg_replace('/[\r\n]+/', ' ', $html);
    $html = (string)preg_replace('/\s+/u', ' ', $html);
    return trim($html);
}

function org_sit_validate_result(array $parsed, string $duelType): void
{
    $desc = (string)($parsed['SituationDescription'] ?? '');
    $roles = $parsed['SituationRoles'] ?? [];
    if ($desc === '' && (!$roles || !is_array($roles))) {
        throw new RuntimeException('Ответ не содержит SituationDescription и SituationRoles');
    }
    if ($desc !== '' && preg_match('/<script/i', $desc)) {
        throw new RuntimeException('SituationDescription содержит запрещённый тег script');
    }
    if ($desc !== '' && preg_match('/РОЛИ\s+И\s+ИНТЕРЕСЫ/ui', $desc)) {
        throw new RuntimeException('SituationDescription не должен содержать блок «Роли и интересы»');
    }
    if (!is_array($roles) || !$roles) {
        return;
    }
    if ($duelType === 'express') {
        if (count($roles) !== 2) {
            throw new RuntimeException('Экспресс: нужно ровно 2 роли, получено ' . count($roles));
        }
        if (trim((string)($roles[0]['Role'] ?? '')) === '' || trim((string)($roles[1]['Role'] ?? '')) === '') {
            throw new RuntimeException('Экспресс: у обеих ролей должно быть поле Role');
        }
        $p0 = trim((string)($roles[0]['Phrase'] ?? ''));
        $p1 = trim((string)($roles[1]['Phrase'] ?? ''));
        if ($p0 === '' && $p1 === '') {
            throw new RuntimeException('Экспресс: у первой роли должна быть непустая Phrase');
        }
        return;
    }
    foreach ($roles as $i => $r) {
        if (!is_array($r) || trim((string)($r['Role'] ?? '')) === '' || trim((string)($r['Goals'] ?? '')) === '') {
            throw new RuntimeException('Классика/Парный: у роли ' . ((int)$i + 1) . ' нет Role или Goals');
        }
    }
}

function org_sit_strip_strong(string $s): string
{
    return (string)preg_replace('#</?strong>#i', '', $s);
}

function org_sit_clean_phrase(string $s): string
{
    $s = org_sit_strip_strong($s);
    $s = (string)preg_replace('/^["«]\s*/u', '', $s);
    $s = (string)preg_replace('/\s*["»]\s*$/u', '', $s);
    $s = (string)preg_replace('/\s+/u', ' ', $s);
    return trim($s);
}

function org_sit_last_phrase(string $text): string
{
    $plain = org_sit_clean_phrase(org_sit_strip_strong($text));
    if ($plain === '') {
        return '';
    }
    $em = mb_strrpos($plain, '—');
    $en = mb_strrpos($plain, '–');
    $dash = -1;
    if ($em !== false) {
        $dash = (int)$em;
    }
    if ($en !== false && (int)$en > $dash) {
        $dash = (int)$en;
    }
    if ($dash >= 0) {
        $after = org_sit_clean_phrase(mb_substr($plain, $dash + 1));
        if (mb_strlen($after) >= 3) {
            return $after;
        }
    }
    if (preg_match_all('/"([^"]{3,})"|«([^»]{3,})»/u', $plain, $m, PREG_SET_ORDER)) {
        $last = $m[count($m) - 1];
        return org_sit_clean_phrase((string)($last[1] !== '' ? $last[1] : $last[2]));
    }
    return '';
}

function org_sit_fix_express_roles(array $roles): array
{
    if (count($roles) !== 2) {
        return $roles;
    }
    $p0 = trim((string)($roles[0]['Phrase'] ?? ''));
    $p1 = trim((string)($roles[1]['Phrase'] ?? ''));
    if ($p0 !== '') {
        return [
            ['Role' => trim((string)($roles[0]['Role'] ?? '')), 'Phrase' => $p0],
            ['Role' => trim((string)($roles[1]['Role'] ?? ''))],
        ];
    }
    if ($p1 !== '') {
        return [
            ['Role' => trim((string)($roles[1]['Role'] ?? '')), 'Phrase' => $p1],
            ['Role' => trim((string)($roles[0]['Role'] ?? ''))],
        ];
    }
    return $roles;
}

function org_sit_apply_last_phrase(array $roles, string $text): array
{
    if (count($roles) !== 2) {
        return $roles;
    }
    $last = org_sit_last_phrase($text);
    if ($last === '') {
        return $roles;
    }
    $role0 = trim((string)($roles[0]['Role'] ?? ''));
    $role1 = trim((string)($roles[1]['Role'] ?? ''));
    if ($role0 === '' || $role1 === '') {
        return $roles;
    }
    $plain = org_sit_strip_strong($text);
    $em = mb_strrpos($plain, '—');
    $en = mb_strrpos($plain, '–');
    $cut = -1;
    if ($em !== false) {
        $cut = (int)$em;
    }
    if ($en !== false && (int)$en > $cut) {
        $cut = (int)$en;
    }
    if ($cut < 0) {
        $q1 = mb_strrpos($plain, '"');
        $q2 = mb_strrpos($plain, '«');
        $cut = max($q1 === false ? -1 : (int)$q1, $q2 === false ? -1 : (int)$q2);
    }
    $before = $cut > 0 ? mb_substr($plain, 0, $cut) : $plain;
    $beforeLow = mb_strtolower($before);
    $i0 = $role0 !== '' ? mb_strrpos($beforeLow, mb_strtolower($role0)) : false;
    $i1 = $role1 !== '' ? mb_strrpos($beforeLow, mb_strtolower($role1)) : false;
    $speaker = $role0;
    if ($i1 !== false && ($i0 === false || (int)$i1 > (int)$i0)) {
        $speaker = $role1;
    }
    if (mb_strtolower($speaker) === mb_strtolower($role1)) {
        return [['Role' => $role1, 'Phrase' => $last], ['Role' => $role0]];
    }
    return [['Role' => $role0, 'Phrase' => $last], ['Role' => $role1]];
}

function org_sit_format_roles(array $roles, string $duelType): string
{
    if ($duelType === 'express') {
        $roles = org_sit_fix_express_roles($roles);
        if (count($roles) !== 2 || trim((string)($roles[0]['Phrase'] ?? '')) === '') {
            throw new RuntimeException('экспресс: не удалось собрать [{Role,Phrase},{Role}]');
        }
        $a = ['Role' => (string)$roles[0]['Role'], 'Phrase' => (string)$roles[0]['Phrase']];
        $b = ['Role' => (string)$roles[1]['Role']];
        return "[\n  " . json_encode($a, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
            . ",\n  " . json_encode($b, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n]";
    }
    $clean = [];
    foreach ($roles as $r) {
        if (!is_array($r)) {
            continue;
        }
        $clean[] = [
            'Role' => (string)($r['Role'] ?? ''),
            'Goals' => (string)($r['Goals'] ?? ''),
        ];
    }
    return (string)json_encode($clean, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
}

function org_sit_generate_markup(string $text, string $typeRaw, string $rolesPlain = ''): array
{
    $duelType = org_sit_norm_type($typeRaw);
    if ($duelType === '') {
        throw new RuntimeException('Нужен тип: классика, экспресс или парный');
    }
    $text = trim($text);
    if ($text === '') {
        throw new RuntimeException('Нужен текст ситуации');
    }
    @set_time_limit(90);
    $prompt = org_sit_build_prompt($duelType, $text, trim($rolesPlain));
    $raw = org_sit_call_llm($prompt);
    $parsed = org_sit_parse_llm($raw);
    org_sit_validate_result($parsed, $duelType);
    $html = org_sit_sanitize_html((string)($parsed['SituationDescription'] ?? ''));
    $roles = $parsed['SituationRoles'] ?? [];
    if ($duelType === 'express') {
        $roles = org_sit_fix_express_roles($roles);
        $roles = org_sit_apply_last_phrase($roles, $html !== '' ? $html : $text);
    }
    return [
        'descriptionHtml' => $html,
        'rolesJson' => org_sit_format_roles($roles, $duelType),
    ];
}
