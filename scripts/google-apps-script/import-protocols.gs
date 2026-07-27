/**
 * Импорт протоколов protocols-batch v1 → лист «протоколы игр».
 *
 * Версия: 1.2.3 (2026-06-29)
 * Спецификация: docs/protocol/
 *
 * Script Properties (опционально):
 *   PROTOCOLS_SHEET_NAME — лист протоколов, по умолчанию «протоколы игр»
 *   PROTOCOL_FORMAT_REF_COLUMN — эталон оформления (буква, напр. GR); иначе колонка слева от самой левой в пакете
 */

var PROTO_IMPORT_VERSION = '1.2.3';
var PROTO_FMT_WHITE = '#ffffff';
var PROTO_FMT_BLACK = '#000000';
var PROTO_IMPORT_SHEET = '_protocol_import';
var PROTO_LOG_SHEET = '_protocol_import_log';
var PROTO_DEFAULT_SHEET = 'протоколы игр';
var PROTO_LOG_HEADERS = ['Время', 'Режим', 'Колонка', 'sit', 'Статус', 'Сообщение'];

var PROTO_ROW = {
  HEADER: 2,
  STARTED: 3,
  SITUATION: 8,
  T1_PLAYER: 9,
  T1_SECOND: 10,
  T2_PLAYER: 11,
  T2_SECOND: 12,
  JUDGE_NAME: 13,
  JUDGE_VOTE: 22,
  MAX_JUDGES: 9,
  /** Строки 1–2 — заголовок турнира. Формат копируем только 3–12 (игроки, не судьи). */
  FMT_COPY_FIRST: 3,
  FMT_COPY_LAST: 12
};

function installProtocolImportMenu_() {
  SpreadsheetApp.getUi()
    .createMenu('Протоколы игр')
    .addItem('Подготовить лист импорта', 'prepareImportSheet')
    .addSeparator()
    .addItem('Предпросмотр импорта', 'previewImport')
    .addItem('Выполнить импорт', 'executeImport')
    .addSeparator()
    .addItem('Очистить JSON (A1)', 'clearImportA1')
    .addToUi();
}

function prepareImportSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(PROTO_IMPORT_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(PROTO_IMPORT_SHEET);
  } else {
    sheet.clear();
  }
  sheet.getRange('A1').setValue('Вставьте JSON protocols-batch в эту ячейку (замените этот текст).');
  sheet.setColumnWidth(1, 600);
  SpreadsheetApp.getUi().alert('Лист «' + PROTO_IMPORT_SHEET + '» готов. Вставьте JSON в A1.');
}

function clearImportA1() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PROTO_IMPORT_SHEET);
  if (!sheet) {
    SpreadsheetApp.getUi().alert('Сначала «Подготовить лист импорта».');
    return;
  }
  sheet.getRange('A1').clearContent();
  SpreadsheetApp.getUi().alert('A1 очищена.');
}

function previewImport() {
  runProtocolImport_(true);
}

function executeImport() {
  runProtocolImport_(false);
}

function runProtocolImport_(dryRun) {
  var ui = SpreadsheetApp.getUi();
  var batch;
  try {
    batch = loadBatchFromImportSheet_();
  } catch (e) {
    ui.alert('Ошибка JSON: ' + e.message);
    return;
  }

  var ctx = getProtocolsContext_();
  if (!ctx) return;

  var nameIndex = buildNameIndex_(ctx.sheet);
  var plans = buildImportPlans_(batch, ctx.sheet, nameIndex);
  var formatRefCol = resolveBatchFormatRefCol_(plans);

  protoLogInit_();
  var lines = [];
  var errors = 0;
  var ok = 0;

  lines.push('Версия: ' + PROTO_IMPORT_VERSION);
  lines.push('Турнир: ' + batch.meta.tournament);
  lines.push('Эталон оформления: ' + columnToLetter_(formatRefCol));
  lines.push('Режим: ' + (dryRun ? 'ПРЕДПРОСМОТР' : 'ИМПОРТ'));
  lines.push('Поединков: ' + plans.length);
  lines.push('');

  for (var i = 0; i < plans.length; i++) {
    var p = plans[i];
    var status = p.error ? 'ERROR' : 'OK';
    if (p.error) errors++;
    else ok++;

    var msg = p.summary;
    if (p.warnings && p.warnings.length) {
      msg += ' | ' + p.warnings.join('; ');
    }
    protoLogRow_(dryRun ? 'PREVIEW' : 'IMPORT', p.colLetter || '-', p.situationNum, status, msg);

    lines.push('--- sit ' + p.situationNum + ' → ' + (p.colLetter || '?') + ' [' + status + '] ---');
    lines.push(msg);
    if (p.diff && p.diff.length) {
      for (var d = 0; d < p.diff.length; d++) {
        lines.push('  ' + p.diff[d]);
      }
    }
    if (p.duelNotes) {
      lines.push('  notes: ' + p.duelNotes);
    }
    lines.push('');

    if (!dryRun && !p.error && p.writes) {
      copyProtocolColumnFormat_(ctx.sheet, p.col, formatRefCol);
      applyProtocolWrites_(ctx.sheet, p.col, p.writes);
      applyJudgeBlock_(ctx.sheet, p.col, p.judges, nameIndex, formatRefCol);
    }
  }

  lines.push('Итого: OK=' + ok + ', ERROR=' + errors);

  if (dryRun) {
    ui.alert(lines.join('\n').substring(0, 18000));
  } else if (errors) {
    ui.alert('Импорт с ошибками (' + errors + '). См. «' + PROTO_LOG_SHEET + '».\n\n' + lines.join('\n').substring(0, 12000));
  } else {
    ui.alert('Импорт выполнен: ' + ok + ' поединков.\nСм. «' + PROTO_LOG_SHEET + '».');
  }
}

function loadBatchFromImportSheet_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PROTO_IMPORT_SHEET);
  if (!sheet) {
    throw new Error('Нет листа «' + PROTO_IMPORT_SHEET + '». Запустите «Подготовить лист импорта».');
  }
  var raw = String(sheet.getRange('A1').getValue() || '').trim();
  if (!raw || raw.indexOf('{') < 0) {
    throw new Error('В A1 нет JSON. Вставьте содержимое *.json.');
  }
  var batch = JSON.parse(raw);
  if (batch.format !== 'protocols-batch' || batch.version !== 1) {
    throw new Error('Ожидается format=protocols-batch, version=1');
  }
  if (!batch.meta || !batch.meta.tournament) {
    throw new Error('meta.tournament обязателен');
  }
  if (!batch.duels || !batch.duels.length) {
    throw new Error('duels[] пуст');
  }
  return batch;
}

function getProtocolsContext_() {
  var name = PropertiesService.getScriptProperties().getProperty('PROTOCOLS_SHEET_NAME') || PROTO_DEFAULT_SHEET;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    SpreadsheetApp.getUi().alert('Лист «' + name + '» не найден.');
    return null;
  }
  return { sheet: sheet, name: name };
}

function buildImportPlans_(batch, sheet, nameIndex) {
  var meta = batch.meta;
  var plans = [];
  for (var i = 0; i < batch.duels.length; i++) {
    plans.push(buildOnePlan_(batch.duels[i], meta, sheet, nameIndex));
  }
  return plans;
}

function buildOnePlan_(duel, meta, sheet, nameIndex) {
  var hints = duel.matchHints || {};
  var sit = duel.situationNum;
  var eventDate = hints.eventDate || meta.eventDate || '';
  var plan = {
    situationNum: sit,
    duelNotes: duel.notes || '',
    warnings: [],
    diff: [],
    error: null,
    col: null,
    colLetter: hints.expectedColumn || null,
    writes: null,
    summary: ''
  };

  try {
    if (!duel.roles || !duel.roles.player1) {
      throw new Error('roles.player1 обязателен');
    }
    if (!duel.judges || !duel.judges.length) {
      throw new Error('judges[] пуст');
    }

    var col = matchDuelColumn_(duel, meta, sheet);
    plan.col = col;
    plan.colLetter = columnToLetter_(col);

    var planT1 = sheet.getRange(PROTO_ROW.T1_PLAYER, col).getValue();
    var planT2 = sheet.getRange(PROTO_ROW.T2_PLAYER, col).getValue();
    var planSit = sheet.getRange(PROTO_ROW.SITUATION, col).getValue();
    var planStarted = sheet.getRange(PROTO_ROW.STARTED, col).getValue();

    var roles = duel.roles;
    var teams = duel.teams
      ? normalizeTeamsFromJson_(duel.teams, nameIndex)
      : deriveTeams_(roles, planT1, nameIndex);
    var started = deriveStartedBy_(roles.player1, teams, nameIndex);

    var norm = function (n) {
      return normalizeName_(n, nameIndex);
    };

    plan.summary = 'teams: T1=' + teams.team1.player + '+' + teams.team1.second +
      '; T2=' + teams.team2.player + '+' + teams.team2.second + '; Начинал=' + started;

    pushProtocolDiff_(plan, 'row ' + PROTO_ROW.STARTED, planStarted, started);
    if (duel.situationLabel) {
      pushProtocolDiff_(plan, 'row ' + PROTO_ROW.SITUATION, planSit, duel.situationLabel);
    }
    pushProtocolDiff_(plan, 'row ' + PROTO_ROW.T1_PLAYER, planT1, teams.team1.player);
    pushProtocolDiff_(plan, 'row ' + PROTO_ROW.T1_SECOND, sheet.getRange(PROTO_ROW.T1_SECOND, col).getValue(), teams.team1.second);
    pushProtocolDiff_(plan, 'row ' + PROTO_ROW.T2_PLAYER, planT2, teams.team2.player);
    pushProtocolDiff_(plan, 'row ' + PROTO_ROW.T2_SECOND, sheet.getRange(PROTO_ROW.T2_SECOND, col).getValue(), teams.team2.second);

    var writes = {};
    writes[PROTO_ROW.STARTED] = started;
    if (duel.situationLabel) {
      writes[PROTO_ROW.SITUATION] = duel.situationLabel;
    }
    writes[PROTO_ROW.T1_PLAYER] = norm(teams.team1.player);
    writes[PROTO_ROW.T1_SECOND] = norm(teams.team1.second);
    writes[PROTO_ROW.T2_PLAYER] = norm(teams.team2.player);
    writes[PROTO_ROW.T2_SECOND] = norm(teams.team2.second);

    var judges = duel.judges;
    plan.judges = judges;
    if (judges.length > PROTO_ROW.MAX_JUDGES) {
      plan.warnings.push('Судей ' + judges.length + ', в таблице макс. ' + PROTO_ROW.MAX_JUDGES);
    }
    if ([5, 7, 9].indexOf(judges.length) < 0) {
      plan.warnings.push('Судей ' + judges.length + ' — ожидается 5, 7 или 9');
    }
    var layout = getJudgeLayout_(judges.length);
    for (var slot = 0; slot < PROTO_ROW.MAX_JUDGES; slot++) {
      var nameRow = PROTO_ROW.JUDGE_NAME + slot;
      var voteRow = PROTO_ROW.JUDGE_VOTE + slot;
      if (slot >= layout.offset && slot < layout.offset + layout.count) {
        var j = slot - layout.offset;
        var jName = norm(judges[j].name);
        var jVote = judges[j].vote;
        pushProtocolDiff_(plan, 'row ' + nameRow, sheet.getRange(nameRow, col).getValue(), jName);
        pushProtocolDiff_(plan, 'row ' + voteRow, sheet.getRange(voteRow, col).getValue(), jVote);
      } else {
        pushProtocolDiff_(plan, 'row ' + nameRow, sheet.getRange(nameRow, col).getValue(), '');
        pushProtocolDiff_(plan, 'row ' + voteRow, sheet.getRange(voteRow, col).getValue(), '');
      }
    }

    plan.writes = writes;
    plan.summary = plan.colLetter + ' sit ' + sit + (eventDate ? ' ' + eventDate : '') + ' | ' + plan.summary;
  } catch (e) {
    plan.error = e.message;
    plan.summary = 'sit ' + sit + ': ' + e.message;
  }

  return plan;
}

function pushProtocolDiff_(plan, label, oldVal, newVal) {
  var o = displayProtocolCell_(oldVal);
  var n = displayProtocolCell_(newVal);
  if (o !== n) {
    plan.diff.push(label + ': «' + o + '» → «' + n + '»');
  }
}

function displayProtocolCell_(v) {
  if (v === null || v === undefined || v === '') return '(пусто)';
  return String(v);
}

function applyProtocolWrites_(sheet, col, writes) {
  var rows = Object.keys(writes);
  for (var i = 0; i < rows.length; i++) {
    var row = parseInt(rows[i], 10);
    setProtocolCellValue_(sheet.getRange(row, col), writes[rows[i]], {});
  }
}

/** Эталон оформления: PROTOCOL_FORMAT_REF_COLUMN или колонка слева от min(колонок пакета). */
function resolveBatchFormatRefCol_(plans) {
  var forced = PropertiesService.getScriptProperties().getProperty('PROTOCOL_FORMAT_REF_COLUMN');
  if (forced) {
    var c = letterToColumn_(String(forced).trim());
    if (c > 0) {
      return c;
    }
  }
  var minCol = null;
  for (var i = 0; i < plans.length; i++) {
    if (plans[i].error || !plans[i].col) {
      continue;
    }
    if (minCol === null || plans[i].col < minCol) {
      minCol = plans[i].col;
    }
  }
  if (!minCol) {
    return 1;
  }
  return minCol > 1 ? minCol - 1 : minCol + 1;
}

/** Один раз на колонку: границы, подсветка игроков (rows 3–12). Блок судей — отдельно. */
function copyProtocolColumnFormat_(sheet, col, refCol) {
  var numRows = PROTO_ROW.FMT_COPY_LAST - PROTO_ROW.FMT_COPY_FIRST + 1;
  sheet.getRange(PROTO_ROW.FMT_COPY_FIRST, refCol, numRows, 1).copyTo(
    sheet.getRange(PROTO_ROW.FMT_COPY_FIRST, col, numRows, 1),
    SpreadsheetApp.CopyPasteType.PASTE_FORMAT,
    false
  );
}

/** Границы блока судей — одним диапазоном (поячейчно границы теряются). */
function copyJudgeBlockFormat_(sheet, col, refCol) {
  var startRow = PROTO_ROW.JUDGE_NAME;
  var endRow = PROTO_ROW.JUDGE_VOTE + PROTO_ROW.MAX_JUDGES - 1;
  var numRows = endRow - startRow + 1;
  sheet.getRange(startRow, refCol, numRows, 1).copyTo(
    sheet.getRange(startRow, col, numRows, 1),
    SpreadsheetApp.CopyPasteType.PASTE_FORMAT,
    false
  );
}

function getGrayBackgroundForRow_(sheet, row, refCol) {
  var bg = sheet.getRange(row, refCol).getBackground();
  if (isGrayCellBackground_(bg)) {
    return bg;
  }
  return bg;
}

function getActiveJudgeBackground_(sheet, voteRow, refCol, refLayout) {
  var refRow = voteRow
    ? PROTO_ROW.JUDGE_VOTE + refLayout.offset
    : PROTO_ROW.JUDGE_NAME + refLayout.offset;
  return sheet.getRange(refRow, refCol).getBackground();
}

function isGrayCellBackground_(color) {
  if (!color) return false;
  var c = String(color).toLowerCase().replace(/\s/g, '');
  return c !== '#ffffff' && c !== '#fff' && c !== 'white';
}

/** 9 / 7 / 5 судей по заливке строки 13–14 в колонке-образце. */
function detectJudgeLayoutFromColumn_(sheet, col) {
  if (!isGrayCellBackground_(sheet.getRange(PROTO_ROW.JUDGE_NAME, col).getBackground())) {
    return 9;
  }
  if (isGrayCellBackground_(sheet.getRange(PROTO_ROW.JUDGE_NAME + 1, col).getBackground())) {
    return 5;
  }
  return 7;
}

/** Только значение и точечные правки (после copyProtocolColumnFormat_). */
function setProtocolCellValue_(cell, value, opts) {
  opts = opts || {};
  if (opts.background) {
    cell.setBackground(opts.background);
  }
  if (value === null || value === undefined || value === '') {
    cell.clearContent();
  } else {
    cell.setValue(value);
  }
  if (opts.forceBlackFont) {
    cell.setFontColor(PROTO_FMT_BLACK)
      .setFontWeight('normal')
      .setFontStyle('normal');
  }
}

/** Смещение судей в блоке из 9 строк: 9→0, 7→1, 5→2. */
function getJudgeLayout_(judgeCount) {
  var count = Math.min(judgeCount, PROTO_ROW.MAX_JUDGES);
  var offset = Math.floor((PROTO_ROW.MAX_JUDGES - count) / 2);
  return { offset: offset, count: count };
}

function applyJudgeBlock_(sheet, col, judges, nameIndex, formatRefCol) {
  if (!judges || !judges.length) return;
  var refCol = formatRefCol;
  var refLayout = getJudgeLayout_(detectJudgeLayoutFromColumn_(sheet, refCol));
  var layout = getJudgeLayout_(judges.length);
  var activeNameBg = getActiveJudgeBackground_(sheet, false, refCol, refLayout);
  var activeVoteBg = getActiveJudgeBackground_(sheet, true, refCol, refLayout);

  copyJudgeBlockFormat_(sheet, col, refCol);

  for (var slot = 0; slot < PROTO_ROW.MAX_JUDGES; slot++) {
    var nameRow = PROTO_ROW.JUDGE_NAME + slot;
    var voteRow = PROTO_ROW.JUDGE_VOTE + slot;
    var nameCell = sheet.getRange(nameRow, col);
    var voteCell = sheet.getRange(voteRow, col);
    var active = slot >= layout.offset && slot < layout.offset + layout.count;

    if (active) {
      var j = slot - layout.offset;
      nameCell.setValue(normalizeName_(judges[j].name, nameIndex)).setBackground(activeNameBg);
      setVoteCellBlack_(voteCell, judges[j].vote);
      voteCell.setBackground(activeVoteBg);
    } else {
      var grayBg = getGrayBackgroundForRow_(sheet, nameRow, refCol);
      nameCell.clearContent().setBackground(grayBg);
      voteCell.clearContent().setBackground(grayBg);
    }
  }
}

/** Число для формул + чёрный текст (без правок условного форматирования листа). */
function setVoteCellBlack_(cell, vote) {
  cell.setValue(vote);
  cell.setFontColor(PROTO_FMT_BLACK).setFontWeight('normal').setFontStyle('normal');
}

function matchDuelColumn_(duel, meta, sheet) {
  var hints = duel.matchHints || {};
  var tournament = String(meta.tournament || '').trim();
  var eventDate = hints.eventDate || meta.eventDate || '';
  var expectedHeader = buildExpectedHeader_(tournament, eventDate);

  var lastCol = sheet.getLastColumn();
  var headerRow = sheet.getRange(PROTO_ROW.HEADER, 1, 1, lastCol).getValues()[0];
  var candidates = [];

  for (var c = 0; c < headerRow.length; c++) {
    var h = String(headerRow[c] || '').trim();
    if (!h || h.indexOf(tournament) < 0) continue;
    if (expectedHeader && h !== expectedHeader && eventDate) {
      continue;
    }
    candidates.push(c + 1);
  }

  if (!candidates.length) {
    throw new Error('Нет колонок с «' + tournament + '»' +
      (expectedHeader ? ' и заголовком «' + expectedHeader + '»' : ''));
  }

  if (hints.expectedColumn) {
    var forced = letterToColumn_(hints.expectedColumn);
    if (candidates.indexOf(forced) < 0) {
      throw new Error('expectedColumn ' + hints.expectedColumn + ' не в списке кандидатов');
    }
    return forced;
  }

  var sit = duel.situationNum;
  var roles = duel.roles;
  var matched = [];
  for (var i = 0; i < candidates.length; i++) {
    var col = candidates[i];
    var sitCell = sheet.getRange(PROTO_ROW.SITUATION, col).getValue();
    var sitNum = extractSituationNum_(sitCell);
    var p1 = sheet.getRange(PROTO_ROW.T1_PLAYER, col).getValue();
    var p2 = sheet.getRange(PROTO_ROW.T2_PLAYER, col).getValue();
    var peopleOk = surnameMatch_(p1, roles.player1) || surnameMatch_(p1, roles.player2) ||
      surnameMatch_(p2, roles.player1) || surnameMatch_(p2, roles.player2);
    if (sitNum === sit || peopleOk) {
      matched.push(col);
    }
  }

  if (matched.length === 1) return matched[0];
  if (matched.length > 1) {
    throw new Error('Неоднозначный матчинг sit ' + sit + ' (колонки ' +
      matched.map(columnToLetter_).join(', ') + '). Задайте matchHints.expectedColumn.');
  }

  if (candidates.length === 1) return candidates[0];

  throw new Error('Не найдена колонка для sit ' + sit + ' среди ' +
    candidates.map(columnToLetter_).join(', '));
}

function buildExpectedHeader_(tournament, isoDate) {
  if (!isoDate) return null;
  var parts = String(isoDate).split('-');
  if (parts.length !== 3) return null;
  return tournament + ' ' + parts[2] + '.' + parts[1] + '.' + parts[0];
}

function extractSituationNum_(cell) {
  var s = String(cell || '').trim();
  var m = s.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function deriveTeams_(roles, planTeam1Player, nameIndex) {
  var swap = !samePerson_(roles.player1, planTeam1Player, nameIndex);
  if (!swap) {
    return {
      team1: { player: roles.player1, second: roles.second1 },
      team2: { player: roles.player2, second: roles.second2 }
    };
  }
  return {
    team1: { player: roles.player2, second: roles.second2 },
    team2: { player: roles.player1, second: roles.second1 }
  };
}

function normalizeTeamsFromJson_(teams, nameIndex) {
  return {
    team1: {
      player: normalizeName_(teams.team1.player, nameIndex),
      second: normalizeName_(teams.team1.second, nameIndex)
    },
    team2: {
      player: normalizeName_(teams.team2.player, nameIndex),
      second: normalizeName_(teams.team2.second, nameIndex)
    }
  };
}

function deriveStartedBy_(player1, teams, nameIndex) {
  if (samePerson_(player1, teams.team1.player, nameIndex)) return 'Команда 1';
  if (samePerson_(player1, teams.team2.player, nameIndex)) return 'Команда 2';
  throw new Error('Игрок №1 не найден среди команд для «Начинал»');
}

function buildNameIndex_(sheet) {
  var index = {};
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return index;
  var data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  for (var r = 0; r < data.length; r++) {
    for (var c = 0; c < data[r].length; c++) {
      var v = data[r][c];
      if (typeof v !== 'string') continue;
      v = v.replace(/\s+/g, ' ').trim();
      if (!v || v.indexOf('http') === 0 || v.indexOf('Команда') === 0) continue;
      var parts = v.split(' ');
      if (parts.length < 2) continue;
      if (!/^[А-ЯЁA-Z]/.test(parts[0])) continue;
      var sur = parts[0].toLowerCase();
      if (!index[sur]) index[sur] = [];
      if (index[sur].indexOf(v) < 0) index[sur].push(v);
    }
  }
  return index;
}

function normalizeName_(name, index) {
  if (!name) return name;
  var n = String(name).replace(/\s+/g, ' ').trim();
  var parts = n.split(' ');
  if (parts.length < 2) return n;
  var sur = parts[0].toLowerCase();
  var given = parts[1].toLowerCase();
  var list = index[sur] || [];
  for (var i = 0; i < list.length; i++) {
    var p = list[i].split(' ');
    if (p.length > 1 && (p[1].toLowerCase() === given || p[1].toLowerCase().indexOf(given.substring(0, 3)) === 0)) {
      return list[i];
    }
  }
  return n;
}

function samePerson_(a, b, nameIndex) {
  if (!a || !b) return false;
  return normalizeName_(a, nameIndex) === normalizeName_(b, nameIndex) ||
    surnameMatch_(a, b);
}

function surnameMatch_(a, b) {
  if (!a || !b) return false;
  var sa = String(a).trim().split(/\s+/)[0].toLowerCase();
  var sb = String(b).trim().split(/\s+/)[0].toLowerCase();
  return sa === sb;
}

function columnToLetter_(col) {
  var letter = '';
  while (col > 0) {
    var mod = (col - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    col = Math.floor((col - 1) / 26);
  }
  return letter;
}

function letterToColumn_(letter) {
  var s = String(letter || '').toUpperCase().trim();
  var col = 0;
  for (var i = 0; i < s.length; i++) {
    col = col * 26 + (s.charCodeAt(i) - 64);
  }
  return col;
}

function protoLogInit_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(PROTO_LOG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(PROTO_LOG_SHEET);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(PROTO_LOG_HEADERS);
  }
}

function protoLogRow_(mode, col, sit, status, message) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PROTO_LOG_SHEET);
  if (!sheet) return;
  sheet.appendRow([
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'),
    mode,
    col,
    sit,
    status,
    String(message).substring(0, 1500)
  ]);
}
