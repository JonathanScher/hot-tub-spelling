/**
 * Cozy Tub Spelling - Google Apps Script Backend
 * Sheet Name: Words
 * Columns: word | week_label | active | box | next_review | streak | total_attempts | custom_audio_url
 */

var SHEET_NAME = 'Words';
var HEADERS = [
  'word',
  'week_label',
  'active',
  'box',
  'next_review',
  'streak',
  'total_attempts',
  'custom_audio_url'
];

/**
 * Handles GET requests from the web game to fetch vocabulary and SRS state.
 */
function doGet(e) {
  try {
    var sheet = getOrCreateWordsSheet_();
    var words = readAllWords_(sheet);
    return jsonResponse_({
      ok: true,
      words: words,
      updatedAt: new Date().toISOString()
    });
  } catch (err) {
    return jsonResponse_({
      ok: false,
      error: String(err && err.message ? err.message : err)
    });
  }
}

/**
 * Handles POST requests (sent as text/plain JSON to avoid CORS preflight blocks).
 * Supported actions:
 *  - "update_word": Update single word SRS stats (or insert if missing)
 *  - "sync_progress": Batch update multiple words' SRS stats
 *  - "add_weekly_words": Add a new weekly list of 6-10 words from Parent Mode
 *  - "delete_word": Remove a typo word if requested from Parent Mode
 */
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('Missing POST payload.');
    }

    var payload = JSON.parse(e.postData.contents);
    var action = payload.action || '';
    var sheet = getOrCreateWordsSheet_();

    if (action === 'update_word') {
      if (!payload.word) {
        throw new Error('Missing word field.');
      }
      upsertWords_(sheet, [payload], false);
      return jsonResponse_({
        ok: true,
        action: action,
        words: readAllWords_(sheet)
      });
    }

    if (action === 'sync_progress') {
      var updates = Array.isArray(payload.updates) ? payload.updates : [];
      if (updates.length > 0) {
        upsertWords_(sheet, updates, false);
      }
      return jsonResponse_({
        ok: true,
        action: action,
        syncedCount: updates.length,
        words: readAllWords_(sheet)
      });
    }

    if (action === 'add_weekly_words') {
      var weekLabel = String(payload.week_label || 'Week 1').trim();
      var incoming = Array.isArray(payload.words) ? payload.words : [];
      var todayStr = formatToday_();

      var normalizedBatch = [];
      for (var i = 0; i < incoming.length; i++) {
        var item = incoming[i];
        var rawWord = typeof item === 'string' ? item : (item && item.word ? item.word : '');
        var cleanWord = normalizeWord_(rawWord);
        if (!cleanWord) continue;

        normalizedBatch.push({
          word: cleanWord,
          week_label: weekLabel,
          active: true,
          box: item && item.box ? clampBox_(item.box) : 1,
          next_review: item && item.next_review ? String(item.next_review) : todayStr,
          streak: item && typeof item.streak === 'number' ? item.streak : 0,
          total_attempts: item && typeof item.total_attempts === 'number' ? item.total_attempts : 0,
          custom_audio_url: item && item.custom_audio_url ? String(item.custom_audio_url).trim() : ''
        });
      }

      upsertWords_(sheet, normalizedBatch, true);

      return jsonResponse_({
        ok: true,
        action: action,
        addedCount: normalizedBatch.length,
        words: readAllWords_(sheet)
      });
    }

    if (action === 'delete_word') {
      var target = normalizeWord_(payload.word || '');
      var deleted = deleteWordRow_(sheet, target);
      return jsonResponse_({
        ok: true,
        action: action,
        deleted: deleted,
        words: readAllWords_(sheet)
      });
    }

    throw new Error('Unknown action: ' + action);
  } catch (err) {
    return jsonResponse_({
      ok: false,
      error: String(err && err.message ? err.message : err)
    });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Ensures the "Words" sheet exists and has the required header row.
 */
function getOrCreateWordsSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  } else {
    var firstRow = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), HEADERS.length)).getValues()[0];
    var firstCell = String(firstRow[0] || '').trim().toLowerCase();
    if (firstCell !== 'word') {
      sheet.insertRowBefore(1);
      sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
  }

  return sheet;
}

/**
 * Reads all rows from the Words sheet into normalized JSON objects.
 */
function readAllWords_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastCol = Math.max(sheet.getLastColumn(), HEADERS.length);
  if (lastRow <= 1) {
    return [];
  }

  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var colMap = getColumnMap_(values[0]);
  var tz = Session.getScriptTimeZone() || 'GMT';
  var results = [];

  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var wordVal = normalizeWord_(getCell_(row, colMap, 'word'));
    if (!wordVal) continue;

    var rawActive = getCell_(row, colMap, 'active');
    var active = true;
    if (rawActive === false || String(rawActive).trim().toLowerCase() === 'false' || String(rawActive).trim() === '0') {
      active = false;
    }

    var rawDate = getCell_(row, colMap, 'next_review');
    var nextReview = '';
    if (Object.prototype.toString.call(rawDate) === '[object Date]' && !isNaN(rawDate.getTime())) {
      nextReview = Utilities.formatDate(rawDate, tz, 'yyyy-MM-dd');
    } else if (rawDate !== null && rawDate !== undefined && String(rawDate).trim() !== '') {
      nextReview = String(rawDate).trim().slice(0, 10);
    } else {
      nextReview = formatToday_();
    }

    results.push({
      word: wordVal,
      week_label: String(getCell_(row, colMap, 'week_label') || 'Week 1').trim(),
      active: active,
      box: clampBox_(getCell_(row, colMap, 'box')),
      next_review: nextReview,
      streak: Math.max(0, parseInt(getCell_(row, colMap, 'streak'), 10) || 0),
      total_attempts: Math.max(0, parseInt(getCell_(row, colMap, 'total_attempts'), 10) || 0),
      custom_audio_url: String(getCell_(row, colMap, 'custom_audio_url') || '').trim()
    });
  }

  return results;
}

/**
 * Inserts or updates word records in the sheet.
 * When isWeeklyAdd is true, existing words keep their historical SRS stats unless absent,
 * while having their week_label and active flag refreshed.
 */
function upsertWords_(sheet, items, isWeeklyAdd) {
  var lastRow = sheet.getLastRow();
  var lastCol = Math.max(sheet.getLastColumn(), HEADERS.length);
  var values = sheet.getRange(1, 1, Math.max(1, lastRow), lastCol).getValues();
  var colMap = getColumnMap_(values[0]);
  var existingRowByWord = {};

  for (var r = 1; r < values.length; r++) {
    var existingWord = normalizeWord_(getCell_(values[r], colMap, 'word'));
    if (existingWord) {
      existingRowByWord[existingWord] = r + 1; // 1-based sheet row index
    }
  }

  var todayStr = formatToday_();

  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var cleanWord = normalizeWord_(item.word);
    if (!cleanWord) continue;

    var rowIndex = existingRowByWord[cleanWord];
    if (rowIndex) {
      var currentRow = sheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];

      if (isWeeklyAdd) {
        // Reactivate word under new week label while preserving long-term SRS progress if already practiced
        setCell_(currentRow, colMap, 'week_label', item.week_label || getCell_(currentRow, colMap, 'week_label') || 'Week 1');
        setCell_(currentRow, colMap, 'active', true);
        if (item.custom_audio_url) {
          setCell_(currentRow, colMap, 'custom_audio_url', String(item.custom_audio_url).trim());
        }
      } else {
        if (item.week_label !== undefined) {
          setCell_(currentRow, colMap, 'week_label', String(item.week_label).trim());
        }
        if (item.active !== undefined) {
          setCell_(currentRow, colMap, 'active', Boolean(item.active));
        }
        if (item.box !== undefined) {
          setCell_(currentRow, colMap, 'box', clampBox_(item.box));
        }
        if (item.next_review !== undefined) {
          setCell_(currentRow, colMap, 'next_review', String(item.next_review).slice(0, 10));
        }
        if (item.streak !== undefined) {
          setCell_(currentRow, colMap, 'streak', Math.max(0, parseInt(item.streak, 10) || 0));
        }
        if (item.total_attempts !== undefined) {
          setCell_(currentRow, colMap, 'total_attempts', Math.max(0, parseInt(item.total_attempts, 10) || 0));
        }
        if (item.custom_audio_url !== undefined) {
          setCell_(currentRow, colMap, 'custom_audio_url', String(item.custom_audio_url || '').trim());
        }
      }

      sheet.getRange(rowIndex, 1, 1, currentRow.length).setValues([currentRow]);
    } else {
      var newRow = new Array(lastCol);
      for (var c = 0; c < lastCol; c++) newRow[c] = '';

      setCell_(newRow, colMap, 'word', cleanWord);
      setCell_(newRow, colMap, 'week_label', String(item.week_label || 'Week 1').trim());
      setCell_(newRow, colMap, 'active', item.active !== undefined ? Boolean(item.active) : true);
      setCell_(newRow, colMap, 'box', clampBox_(item.box || 1));
      setCell_(newRow, colMap, 'next_review', String(item.next_review || todayStr).slice(0, 10));
      setCell_(newRow, colMap, 'streak', Math.max(0, parseInt(item.streak, 10) || 0));
      setCell_(newRow, colMap, 'total_attempts', Math.max(0, parseInt(item.total_attempts, 10) || 0));
      setCell_(newRow, colMap, 'custom_audio_url', String(item.custom_audio_url || '').trim());

      sheet.appendRow(newRow);
      existingRowByWord[cleanWord] = sheet.getLastRow();
    }
  }
}

function deleteWordRow_(sheet, targetWord) {
  if (!targetWord || sheet.getLastRow() <= 1) return false;
  var values = sheet.getRange(1, 1, sheet.getLastRow(), Math.max(sheet.getLastColumn(), HEADERS.length)).getValues();
  var colMap = getColumnMap_(values[0]);

  for (var r = values.length - 1; r >= 1; r--) {
    var w = normalizeWord_(getCell_(values[r], colMap, 'word'));
    if (w === targetWord) {
      sheet.deleteRow(r + 1);
      return true;
    }
  }
  return false;
}

function getColumnMap_(headerRow) {
  var map = {};
  for (var i = 0; i < headerRow.length; i++) {
    var key = String(headerRow[i] || '').trim().toLowerCase();
    if (key) {
      map[key] = i;
    }
  }
  for (var h = 0; h < HEADERS.length; h++) {
    if (map[HEADERS[h]] === undefined) {
      map[HEADERS[h]] = h;
    }
  }
  return map;
}

function getCell_(row, colMap, name) {
  var idx = colMap[name];
  return idx !== undefined && idx < row.length ? row[idx] : '';
}

function setCell_(row, colMap, name, val) {
  var idx = colMap[name];
  if (idx !== undefined) {
    row[idx] = val;
  }
}

function normalizeWord_(raw) {
  return String(raw || '').trim().toLowerCase();
}

function clampBox_(val) {
  var n = parseInt(val, 10);
  if (isNaN(n) || n < 1) return 1;
  if (n > 5) return 5;
  return n;
}

function formatToday_() {
  var tz = Session.getScriptTimeZone() || 'GMT';
  return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
