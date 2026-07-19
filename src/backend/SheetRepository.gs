/**
 * SheetRepository.gs
 * 共用試算表資料存取層 (CRUD 封裝)
 */

var SheetRepository = (function() {
  
  /**
   * 取得 Spreadsheet 物件
   * @return {SpreadsheetApp.Spreadsheet}
   */
  function getSpreadsheet() {
    var ssId = Config.getSpreadsheetId();
    if (!ssId) {
      throw new Error('資料庫試算表 ID 未設定');
    }
    try {
      return SpreadsheetApp.openById(ssId);
    } catch (e) {
      throw new Error('無法開啟資料庫試算表，請檢查權限或 ID 是否正確：' + e.message);
    }
  }

  /**
   * 取得指定工作表物件
   * @param {string} sheetName 工作表名稱
   * @return {SpreadsheetApp.Sheet}
   */
  function getSheet(sheetName) {
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      throw new Error('工作表不存在：' + sheetName);
    }
    return sheet;
  }

  /**
   * 檢查工作表是否存在
   * @param {string} sheetName 工作表名稱
   * @return {boolean} 是否存在
   */
  function sheetExists(sheetName) {
    try {
      var ss = getSpreadsheet();
      return ss.getSheetByName(sheetName) !== null;
    } catch (e) {
      return false;
    }
  }

  /**
   * 取得工作表的 Header 欄位清單 (第一列)
   * @param {string} sheetName 工作表名稱
   * @return {string[]} 欄位名稱陣列
   */
  function getHeaders(sheetName) {
    var sheet = getSheet(sheetName);
    var lastColumn = sheet.getLastColumn();
    if (lastColumn === 0) return [];
    return sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(function(h) {
      return String(h).trim();
    });
  }

  /**
   * 建立 Header 名稱對應到索引 (1-indexed) 的 Map
   * @param {string} sheetName 工作表名稱
   * @return {object} { fieldName: columnIndex }
   */
  function getHeaderMap(sheetName) {
    var headers = getHeaders(sheetName);
    var map = {};
    headers.forEach(function(header, idx) {
      if (header) {
        map[header] = idx + 1; // 1-indexed for Sheets Range
      }
    });
    return map;
  }

  /**
   * 驗證工作表欄位是否與預期一致 (不依賴順序，僅驗證是否缺失)
   * @param {string} sheetName 工作表名稱
   * @param {string[]} expectedHeaders 預期的欄位名稱清單
   * @return {object} { valid: boolean, missing: string[] }
   */
  function validateHeaders(sheetName, expectedHeaders) {
    var currentHeaders = getHeaders(sheetName);
    var missing = [];
    expectedHeaders.forEach(function(h) {
      if (currentHeaders.indexOf(h) === -1) {
        missing.push(h);
      }
    });
    return {
      valid: missing.length === 0,
      missing: missing
    };
  }

  /**
   * 將二維資料陣列轉換成物件陣列
   * @param {string[]} headers 欄位名稱清單
   * @param {any[][]} values 二維數值陣列 (排除 Header)
   * @return {object[]} 物件陣列
   */
  function parseRows(headers, values) {
    if (!values || values.length === 0) return [];
    return values.map(function(row) {
      var obj = {};
      headers.forEach(function(header, colIdx) {
        if (header) {
          var val = row[colIdx];
          // 解析 Boolean 型態 (自動轉換為 JS Boolean)
          if (val === 'TRUE' || val === true) {
            obj[header] = true;
          } else if (val === 'FALSE' || val === false) {
            obj[header] = false;
          } else {
            obj[header] = val;
          }
        }
      });
      return obj;
    });
  }

  /**
   * 將物件轉換為寫入試算表的列資料陣列 (依據 Header 順序排列)
   * @param {string[]} headers 欄位名稱清單
   * @param {object} recordObj 資料物件
   * @return {any[]} 列資料陣列
   */
  function objectToRow(headers, recordObj) {
    return headers.map(function(header) {
      var val = recordObj[header];
      if (val === undefined) return '';
      // 防止公式注入
      return Utils.sanitizeInput(val);
    });
  }

  /**
   * 取得工作表的所有資料記錄
   * @param {string} sheetName 工作表名稱
   * @return {object[]} 資料物件清單
   */
  function getAllRecords(sheetName) {
    var sheet = getSheet(sheetName);
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow <= 1 || lastCol === 0) return [];
    
    var headers = getHeaders(sheetName);
    var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    return parseRows(headers, values);
  }

  /**
   * 依據 ID 搜尋單筆記錄
   * @param {string} sheetName 工作表名稱
   * @param {string} idColName ID 欄位名稱
   * @param {string|number} idValue ID 欄位值
   * @return {object|null} 匹配的資料物件，未找到回傳 null
   */
  function findById(sheetName, idColName, idValue) {
    var records = getAllRecords(sheetName);
    for (var i = 0; i < records.length; i++) {
      if (String(records[i][idColName]) === String(idValue)) {
        return records[i];
      }
    }
    return null;
  }

  /**
   * 依據條件篩選多筆記錄
   * @param {string} sheetName 工作表名稱
   * @param {object|function} filterFnOrMap 篩選函數，或鍵值對過濾物件
   * @return {object[]} 匹配的資料物件清單
   */
  function findRecords(sheetName, filterFnOrMap) {
    var records = getAllRecords(sheetName);
    if (typeof filterFnOrMap === 'function') {
      return records.filter(filterFnOrMap);
    } else if (typeof filterFnOrMap === 'object') {
      return records.filter(function(record) {
        for (var key in filterFnOrMap) {
          if (String(record[key]) !== String(filterFnOrMap[key])) {
            return false;
          }
        }
        return true;
      });
    }
    return records;
  }

  /**
   * 新增一筆記錄
   * @param {string} sheetName 工作表名稱
   * @param {object} recordObj 資料物件
   * @return {object} 新增完成的資料物件
   */
  function appendRecord(sheetName, recordObj) {
    return LockServiceHelper.runWithLock(function() {
      var sheet = getSheet(sheetName);
      var headers = getHeaders(sheetName);
      
      // 自動處理時間戳記與啟用狀態 (若欄位存在且物件未傳入)
      if (headers.indexOf('created_at') !== -1 && !recordObj.created_at) {
        recordObj.created_at = Utils.formatDateTime(new Date());
      }
      if (headers.indexOf('updated_at') !== -1 && !recordObj.updated_at) {
        recordObj.updated_at = Utils.formatDateTime(new Date());
      }
      if (headers.indexOf('enabled') !== -1 && recordObj.enabled === undefined) {
        recordObj.enabled = true;
      }

      var rowData = objectToRow(headers, recordObj);
      sheet.appendRow(rowData);
      return recordObj;
    });
  }

  /**
   * 依據 ID 更新指定記錄
   * @param {string} sheetName 工作表名稱
   * @param {string} idColName ID 欄位名稱
   * @param {string|number} idValue ID 欄位值
   * @param {object} updateObj 要更新的欄位與值
   * @return {boolean} 是否更新成功
   */
  function updateRecordById(sheetName, idColName, idValue, updateObj) {
    return LockServiceHelper.runWithLock(function() {
      var sheet = getSheet(sheetName);
      var lastRow = sheet.getLastRow();
      var lastCol = sheet.getLastColumn();
      if (lastRow <= 1 || lastCol === 0) return false;

      var headers = getHeaders(sheetName);
      var headerMap = getHeaderMap(sheetName);
      var idColIdx = headerMap[idColName];
      if (!idColIdx) throw new Error('ID 欄位不存在：' + idColName);

      // 讀取 ID 欄整直行進行比對
      var idValues = sheet.getRange(2, idColIdx, lastRow - 1, 1).getValues();
      var targetRow = -1;
      for (var i = 0; i < idValues.length; i++) {
        if (String(idValues[i][0]) === String(idValue)) {
          targetRow = i + 2; // 2-indexed: skip header
          break;
        }
      }

      if (targetRow === -1) return false; // 未找到記錄

      // 自動更新時間戳記
      if (headers.indexOf('updated_at') !== -1 && !updateObj.updated_at) {
        updateObj.updated_at = Utils.formatDateTime(new Date());
      }

      // 逐欄更新 (優化：一次讀出該列，修改後一次寫回，避免逐格 set)
      var range = sheet.getRange(targetRow, 1, 1, lastCol);
      var rowData = range.getValues()[0];

      for (var key in updateObj) {
        var colIdx = headerMap[key];
        if (colIdx) {
          rowData[colIdx - 1] = Utils.sanitizeInput(updateObj[key]);
        }
      }

      range.setValues([rowData]);
      return true;
    });
  }

  /**
   * 存入或更新記錄 (若存在則更新，不存在則新增)
   * @param {string} sheetName 工作表名稱
   * @param {string} idColName ID 欄位名稱
   * @param {string|number} idValue ID 欄位值
   * @param {object} recordObj 資料物件
   * @return {object} 最終寫入的資料物件
   */
  function upsertRecord(sheetName, idColName, idValue, recordObj) {
    var exists = findById(sheetName, idColName, idValue);
    if (exists) {
      updateRecordById(sheetName, idColName, idValue, recordObj);
      return recordObj;
    } else {
      recordObj[idColName] = idValue;
      return appendRecord(sheetName, recordObj);
    }
  }

  /**
   * 批次寫入資料記錄 (覆蓋現有資料)
   * @param {string} sheetName 工作表名稱
   * @param {object[]} records 資料物件清單
   */
  function batchWrite(sheetName, records) {
    return LockServiceHelper.runWithLock(function() {
      var sheet = getSheet(sheetName);
      var headers = getHeaders(sheetName);
      var lastCol = sheet.getLastColumn();
      
      // 清除首列 header 以外的所有舊資料
      var lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
      }

      if (records.length === 0) return;

      // 整理二維資料陣列
      var matrix = records.map(function(record) {
        // 自動補足 timestamp
        if (headers.indexOf('created_at') !== -1 && !record.created_at) {
          record.created_at = Utils.formatDateTime(new Date());
        }
        if (headers.indexOf('updated_at') !== -1 && !record.updated_at) {
          record.updated_at = Utils.formatDateTime(new Date());
        }
        if (headers.indexOf('enabled') !== -1 && record.enabled === undefined) {
          record.enabled = true;
        }
        return objectToRow(headers, record);
      });

      // 一次性批次寫入
      sheet.getRange(2, 1, matrix.length, headers.length).setValues(matrix);
    });
  }

  /**
   * 安全地刪除資料記錄 (測試環境執行硬刪除，正式環境自動改為軟刪除)
   * @param {string} sheetName 工作表名稱
   * @param {string} pkName 主鍵欄位名稱
   * @param {any} id 主鍵值
   */
  function deleteRecordById(sheetName, pkName, id) {
    var isTestMode = false;
    try {
      var env = Config.getSystemConfig('ENVIRONMENT');
      var testId = PropertiesService.getScriptProperties().getProperty('TEST_SPREADSHEET_ID');
      isTestMode = (env === 'TEST' || (testId && Config.getSpreadsheetId() === testId));
    } catch (e) {
      isTestMode = false;
    }

    if (isTestMode) {
      // 僅在測試環境進行硬刪除
      return LockServiceHelper.runWithLock(function() {
        var sheet = getSheet(sheetName);
        var headers = getHeaders(sheetName);
        var pkIdx = headers.indexOf(pkName);
        if (pkIdx === -1) throw new Error('找不到欄位：' + pkName);

        var data = sheet.getDataRange().getValues();
        for (var i = 1; i < data.length; i++) {
          if (String(data[i][pkIdx]) === String(id)) {
            sheet.deleteRow(i + 1);
            break;
          }
        }
      });
    } else {
      // 正式與 UAT 環境：安全檢驗與自動進行軟刪除 (將 enabled 設為 false，並寫入刪除資訊)
      AuthService.requireAnyRole(['system_admin', 'lunch_admin']);
      
      return LockServiceHelper.runWithLock(function() {
        var record = findById(sheetName, pkName, id);
        if (!record) return;

        var headers = getHeaders(sheetName);
        
        // 檢查 PeriodLock
        if (headers.indexOf('date') !== -1 && record.date) {
          PeriodLockService.assertDateWritable(record.date);
        }
        if (headers.indexOf('effective_start_date') !== -1 && record.effective_start_date) {
          PeriodLockService.assertRuleWritable(record.effective_start_date, record.effective_end_date);
        }

        record.enabled = false;
        
        var identity = AuthService.getCurrentIdentity();
        var currentDateTime = Utils.formatDateTime(new Date());

        if (headers.indexOf('status') !== -1) {
          record.status = 'deleted';
        }
        if (headers.indexOf('deleted_by') !== -1) {
          record.deleted_by = identity ? identity.email : 'system';
        }
        if (headers.indexOf('deleted_at') !== -1) {
          record.deleted_at = currentDateTime;
        }
        if (headers.indexOf('deletion_reason') !== -1) {
          record.deletion_reason = '系統執行刪除/還原動作';
        }
        if (headers.indexOf('updated_by') !== -1) {
          record.updated_by = identity ? identity.email : 'system';
        }
        if (headers.indexOf('updated_at') !== -1) {
          record.updated_at = currentDateTime;
        }

        upsertRecord(sheetName, pkName, id, record);
      });
    }
  }

  return {
    getSpreadsheet: getSpreadsheet,
    getSheet: getSheet,
    sheetExists: sheetExists,
    getHeaders: getHeaders,
    getHeaderMap: getHeaderMap,
    validateHeaders: validateHeaders,
    getAllRecords: getAllRecords,
    findById: findById,
    findRecords: findRecords,
    appendRecord: appendRecord,
    updateRecordById: updateRecordById,
    upsertRecord: upsertRecord,
    batchWrite: batchWrite,
    deleteRecordById: deleteRecordById
  };
})();
