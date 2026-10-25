<?php
declare(strict_types=1);

function xlsx_xml_escape(string $value): string
{
    return htmlspecialchars($value, ENT_XML1 | ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function xlsx_col_letter(int $index): string
{
    $index++;
    $out = '';
    while ($index > 0) {
        $mod = ($index - 1) % 26;
        $out = chr(65 + $mod) . $out;
        $index = intdiv($index - 1, 26);
    }
    return $out;
}

function xlsx_cell(string $ref, mixed $value, int $style = 0): string
{
    $styleAttr = $style > 0 ? ' s="' . $style . '"' : '';
    if (is_int($value) || is_float($value)) {
        if (is_float($value)) {
            $num = rtrim(rtrim(sprintf('%.10F', $value), '0'), '.');
            if ($num === '' || $num === '-0') {
                $num = '0';
            }
        } else {
            $num = (string)$value;
        }
        return '<c r="' . $ref . '"' . $styleAttr . '><v>' . $num . '</v></c>';
    }
    $text = (string)$value;
    if ($text === '') {
        return '';
    }
    return '<c r="' . $ref . '"' . $styleAttr . ' t="inlineStr"><is><t xml:space="preserve">'
        . xlsx_xml_escape($text) . '</t></is></c>';
}

function xlsx_sheet_xml(array $rows, array $widths): string
{
    $rowCount = count($rows);
    $maxCols = 1;
    foreach ($rows as $row) {
        $maxCols = max($maxCols, count($row));
    }
    $lastCol = xlsx_col_letter($maxCols - 1);
    $lastRow = max(1, $rowCount);
    $dim = 'A1:' . $lastCol . $lastRow;

    $cols = '';
    if ($widths) {
        $cols = '<cols>';
        foreach (array_values($widths) as $i => $width) {
            $n = $i + 1;
            $cols .= '<col min="' . $n . '" max="' . $n . '" width="' . (float)$width . '" customWidth="1"/>';
        }
        $cols .= '</cols>';
    }

    $sheetRows = '';
    foreach ($rows as $i => $row) {
        $r = $i + 1;
        $style = $i === 0 ? 1 : 0;
        $cells = '';
        foreach (array_values($row) as $c => $value) {
            if ($value === null || $value === '') {
                continue;
            }
            $ref = xlsx_col_letter($c) . $r;
            $cells .= xlsx_cell($ref, $value, $style);
        }
        $sheetRows .= '<row r="' . $r . '">' . $cells . '</row>';
    }

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        . '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        . '<dimension ref="' . $dim . '"/>'
        . '<sheetViews><sheetView workbookViewId="0">'
        . '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
        . '</sheetView></sheetViews>'
        . '<sheetFormatPr defaultRowHeight="15"/>'
        . $cols
        . '<sheetData>' . $sheetRows . '</sheetData>'
        . ($rowCount > 1 ? '<autoFilter ref="A1:' . $lastCol . $lastRow . '"/>' : '')
        . '</worksheet>';
}

function xlsx_styles_xml(): string
{
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        . '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        . '<fonts count="2">'
        . '<font><sz val="11"/><name val="Calibri"/></font>'
        . '<font><b/><sz val="11"/><name val="Calibri"/></font>'
        . '</fonts>'
        . '<fills count="2"><fill><patternFill patternType="none"/></fill>'
        . '<fill><patternFill patternType="gray125"/></fill></fills>'
        . '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
        . '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        . '<cellXfs count="2">'
        . '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
        . '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
        . '</cellXfs>'
        . '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
        . '</styleSheet>';
}

function xlsx_sheet_name(string $name): string
{
    $name = trim($name);
    $name = str_replace(['\\', '/', '?', '*', '[', ']', ':', "'"], ' ', $name);
    $name = trim(preg_replace('/\s+/u', ' ', $name) ?? '');
    $name = mb_substr($name, 0, 31);
    return $name !== '' ? $name : 'Лист1';
}

function xlsx_content_types_xml(): string
{
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        . '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        . '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        . '<Default Extension="xml" ContentType="application/xml"/>'
        . '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        . '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        . '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        . '</Types>';
}

function xlsx_root_rels_xml(): string
{
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        . '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        . '</Relationships>';
}

function xlsx_workbook_xml(string $sheetName): string
{
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        . '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
        . ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        . '<sheets><sheet name="' . xlsx_xml_escape(xlsx_sheet_name($sheetName)) . '" sheetId="1" r:id="rId1"/></sheets>'
        . '</workbook>';
}

function xlsx_workbook_rels_xml(): string
{
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        . '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        . '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        . '</Relationships>';
}

function xlsx_zip_store(array $files): string
{
    $local = '';
    $central = '';
    $offset = 0;
    $count = 0;
    foreach ($files as $name => $data) {
        $name = ltrim(str_replace('\\', '/', (string)$name), '/');
        $data = (string)$data;
        $size = strlen($data);
        $crc = crc32($data);
        $nameLen = strlen($name);
        $localHeader = pack(
            'VvvvvvVVVvv',
            0x04034b50,
            20,
            0,
            0,
            0,
            0,
            $crc,
            $size,
            $size,
            $nameLen,
            0
        );
        $local .= $localHeader . $name . $data;
        $centralHeader = pack(
            'VvvvvvvVVVvvvvvVV',
            0x02014b50,
            20,
            20,
            0,
            0,
            0,
            0,
            $crc,
            $size,
            $size,
            $nameLen,
            0,
            0,
            0,
            0,
            0,
            $offset
        );
        $central .= $centralHeader . $name;
        $offset += strlen($localHeader) + $nameLen + $size;
        $count++;
    }
    $eocd = pack(
        'VvvvvVVv',
        0x06054b50,
        0,
        0,
        $count,
        $count,
        strlen($central),
        $offset,
        0
    );
    return $local . $central . $eocd;
}

function xlsx_build_table(array $rows, array $widths = [], string $sheetName = 'Лист1'): string
{
    $files = [
        '[Content_Types].xml' => xlsx_content_types_xml(),
        '_rels/.rels' => xlsx_root_rels_xml(),
        'xl/workbook.xml' => xlsx_workbook_xml($sheetName),
        'xl/_rels/workbook.xml.rels' => xlsx_workbook_rels_xml(),
        'xl/styles.xml' => xlsx_styles_xml(),
        'xl/worksheets/sheet1.xml' => xlsx_sheet_xml($rows, $widths),
    ];
    return xlsx_zip_store($files);
}
