/**
 * SchoolDaysService.gs
 * 上課日與供餐日曆管理服務 (唯一日期約束加強版)
 */

var SchoolDaysService = (function() {

  /**
   * 驗證日曆日期是否唯一，包含重複時將拋出錯誤
   */
  function validateUniqueSchoolDayDate() {
    var duplicates = findDuplicateSchoolDays();
    if (duplicates.length > 0) {
      throw new Error('🛑 日曆資料異常：偵測到重複的日期設定：' + duplicates.join(', ') + '，請先執行合併清理作業。');
    }
  }

  /**
   * 搜尋並回傳日曆中重複的日期陣列
   * @return {string[]} 重複日期清單 (如 ['2026-09-01'])
   */
  function findDuplicateSchoolDays() {
    var dates = [];
    var duplicates = [];
    
    try {
      var records = SheetRepository.getAllRecords('SchoolDays');
      var seen = {};
      records.forEach(function(r) {
        if (!r.date) return;
        if (seen[r.date]) {
          if (duplicates.indexOf(r.date) === -1) {
            duplicates.push(r.date);
          }
        }
        seen[r.date] = true;
      });
    } catch(e) {
      // 容忍表未建立
    }
    
    return duplicates;
  }

  /**
   * 執行安全合併重複日期的紀錄
   * @param {string} targetDate 目標日期
   * @param {number} keepIndex 保留的索引 (0: 保留第一筆, 1: 保留第二筆...)
   */
  function mergeDuplicateSchoolDays(targetDate, keepIndex) {
    AuthService.requireRole('system_admin');
    var identity = AuthService.getCurrentIdentity();
    var currentDateTime = Utils.formatDateTime(new Date());

    return LockServiceHelper.runWithLock(function() {
      var ssId = Config.getSpreadsheetId();
      var sheet = SpreadsheetApp.openById(ssId).getSheetByName('SchoolDays');
      var values = sheet.getDataRange().getValues();
      var headers = values[0];
      
      var matchedRows = []; // 儲存符合的 { rowIndex, data }
      for (var i = 1; i < values.length; i++) {
        var rowDate = Utils.formatDate(values[i][0]);
        if (rowDate === targetDate) {
          // 轉換為物件
          var obj = {};
          headers.forEach(function(h, idx) {
            obj[h] = values[i][idx];
          });
          matchedRows.push({
            rowIndex: i + 1,
            data: obj
          });
        }
      }

      if (matchedRows.length < 2) {
        throw new Error('該日期 ' + targetDate + ' 並無重複資料。');
      }

      var indexToKeep = parseInt(keepIndex, 10) || 0;
      if (indexToKeep < 0 || indexToKeep >= matchedRows.length) indexToKeep = 0;

      var rowToKeep = matchedRows[indexToKeep];
      
      // 收集被刪除/合併的資料快照
      var beforeData = matchedRows.map(function(mr) { return mr.data; });
      var afterData = rowToKeep.data;

      // 按由大到小的 row 序號進行刪除，避免刪除後 index 錯亂
      matchedRows.sort(function(a, b) { return b.rowIndex - a.rowIndex; });
      
      matchedRows.forEach(function(mr, idx) {
        // 保留指定的行
        if (mr.rowIndex === rowToKeep.rowIndex) return;
        sheet.deleteRow(mr.rowIndex);
      });

      // 紀錄審計日誌
      AuditService.log({
        action: 'MERGE_DUPLICATE_SCHOOL_DAY',
        module: 'calendar',
        recordId: targetDate,
        beforeData: beforeData,
        afterData: afterData,
        reason: '系統管理員執行日曆重複日期合併，保留指定索引為：' + indexToKeep
      });

      Config.clearAllCache();
      return afterData;
    });
  }

  /**
   * 自動遷移清理全日曆中所有重複的日期設定
   */
  function migrateSchoolDaysToUniqueDates() {
    AuthService.requireRole('system_admin');
    var duplicates = findDuplicateSchoolDays();
    var results = [];
    
    duplicates.forEach(function(d) {
      var merged = mergeDuplicateSchoolDays(d, 0); // 預設保留第一筆
      results.push(merged);
    });

    return results;
  }

  /**
   * 批次建立上課日設定 (排除六日，預設為普通上課日)
   */
  function batchCreateSchoolDays(startDate, endDate, schoolYear, semester, defaultPrice) {
    AuthService.requireAnyRole(['system_admin', 'lunch_admin']);
    var identity = AuthService.getCurrentIdentity();
    var currentDateTime = Utils.formatDateTime(new Date());

    var start = new Date(startDate);
    var end = new Date(endDate);
    var price = parseFloat(defaultPrice) || 60;

    var createdCount = 0;
    var skippedCount = 0;

    return LockServiceHelper.runWithLock(function() {
      // 確保期間未鎖定
      PeriodLockService.assertRangeWritable(startDate, endDate);
      var current = new Date(start.getTime());
      
      while (current <= end) {
        var dateStr = Utils.formatDate(current);
        var dayOfWeek = current.getDay();
        
        var isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
        var isMealDay = !isWeekend;
        var dayType = isWeekend ? 'weekend' : 'regular';
        var dayPrice = isMealDay ? price : 0;

        var existing = SheetRepository.findById('SchoolDays', 'date', dateStr);
        if (existing) {
          skippedCount++;
        } else {
          var record = {
            date: dateStr,
            school_year: parseInt(schoolYear, 10),
            semester: parseInt(semester, 10),
            is_meal_day: isMealDay,
            meal_price: dayPrice,
            day_type: dayType,
            description: isWeekend ? '例假日' : '普通供餐上課日',
            locked: false,
            updated_at: currentDateTime,
            created_by: identity.email,
            created_at: currentDateTime,
            updated_by: identity.email,
            lock_reason: ''
          };
          SheetRepository.appendRecord('SchoolDays', record);
          createdCount++;
        }

        current.setDate(current.getDate() + 1);
      }

      AuditService.log({
        action: 'BATCH_CREATE_SCHOOL_DAYS',
        module: 'calendar',
        reason: '批次建立供餐日曆：' + startDate + ' ~ ' + endDate + '，建立 ' + createdCount + ' 筆，跳過 ' + skippedCount + ' 筆。'
      });

      return { created: createdCount, skipped: skippedCount };
    });
  }

  /**
   * 更新單日曆期設定
   */
  function updateSchoolDay(dateStr, fields) {
    AuthService.requireAnyRole(['system_admin', 'lunch_admin']);
    var identity = AuthService.getCurrentIdentity();
    var currentDateTime = Utils.formatDateTime(new Date());

    return LockServiceHelper.runWithLock(function() {
      // 確保期間未鎖定
      PeriodLockService.assertDateWritable(dateStr);
      // 確保唯一性
      validateUniqueSchoolDayDate();

      var record = SheetRepository.findById('SchoolDays', 'date', dateStr);
      if (!record) {
        throw new Error('找不到該日期的設定: ' + dateStr);
      }

      if (record.locked === true || record.locked === 'TRUE') {
        throw new Error('🛑 此日期已被鎖定歸檔，無法進行任何修改！鎖定原因: ' + (record.lock_reason || '月結鎖定'));
      }

      var updated = JSON.parse(JSON.stringify(record));
      
      if (fields.is_meal_day !== undefined) updated.is_meal_day = (fields.is_meal_day === true || fields.is_meal_day === 'TRUE');
      if (fields.meal_price !== undefined) updated.meal_price = parseFloat(fields.meal_price) || 0;
      if (fields.day_type !== undefined) updated.day_type = fields.day_type;
      if (fields.description !== undefined) updated.description = fields.description;
      if (fields.locked !== undefined) updated.locked = (fields.locked === true || fields.locked === 'TRUE');
      if (fields.lock_reason !== undefined) updated.lock_reason = fields.lock_reason;

      updated.updated_at = currentDateTime;
      updated.updated_by = identity.email;

      SheetRepository.upsertRecord('SchoolDays', 'date', dateStr, updated);

      AuditService.log({
        action: 'UPDATE_SCHOOL_DAY',
        module: 'calendar',
        recordId: dateStr,
        beforeData: record,
        afterData: updated,
        reason: '修改日曆日期設定 (' + dateStr + ')'
      });

      return updated;
    });
  }

  /**
   * 批次設定/匯入 CSV 日曆 (唯一鍵約束版)
   * 相同日期在同一批次重複: CONFLICT
   * 日期已存在且內容相同: SKIP
   * 日期已存在但內容不同: UPDATE
   */
  function importSchoolDaysCSV(rows) {
    AuthService.requireAnyRole(['system_admin', 'lunch_admin']);
    var identity = AuthService.getCurrentIdentity();
    var currentDateTime = Utils.formatDateTime(new Date());

    var summary = { create: 0, update: 0, skip: 0, conflict: 0 };
    var batchSeen = {};

    return LockServiceHelper.runWithLock(function() {
      // 確保所有匯入日期皆可寫入 (未鎖定)
      rows.forEach(function(row) {
        if (row.date) PeriodLockService.assertDateWritable(row.date);
      });
      // 1. 預估分類
      rows.forEach(function(row) {
        var dateStr = row.date;
        if (!dateStr) return;

        // 同一批次日期重複
        if (batchSeen[dateStr]) {
          summary.conflict++;
          return;
        }
        batchSeen[dateStr] = true;

        var existing = SheetRepository.findById('SchoolDays', 'date', dateStr);
        if (existing) {
          var samePrice = parseFloat(existing.meal_price) === parseFloat(row.meal_price);
          var sameMeal = (existing.is_meal_day === true || existing.is_meal_day === 'TRUE') === (row.is_meal_day === true || row.is_meal_day === 'TRUE' || row.is_meal_day === '1');
          var sameType = existing.day_type === row.day_type;
          
          if (samePrice && sameMeal && sameType) {
            summary.skip++;
          } else {
            summary.update++;
          }
        } else {
          summary.create++;
        }
      });

      // 2. 執行寫入 (不使用 appendRow，改用 upsert 以確保唯一日期 constraint)
      batchSeen = {};
      rows.forEach(function(row) {
        var dateStr = row.date;
        if (!dateStr) return;

        if (batchSeen[dateStr]) {
          // 同一包重複衝突直接過濾跳過，不重複寫入
          return;
        }
        batchSeen[dateStr] = true;

        var existing = SheetRepository.findById('SchoolDays', 'date', dateStr);
        if (existing && (existing.locked === true || existing.locked === 'TRUE')) {
          return; // 略過已鎖定
        }

        var record = {
          date: dateStr,
          school_year: parseInt(row.school_year, 10) || 115,
          semester: parseInt(row.semester, 10) || 1,
          is_meal_day: (row.is_meal_day === true || row.is_meal_day === 'TRUE' || row.is_meal_day === '1'),
          meal_price: parseFloat(row.meal_price) || 0,
          day_type: row.day_type || 'regular',
          description: row.description || '',
          locked: (row.locked === true || row.locked === 'TRUE'),
          updated_at: currentDateTime,
          created_by: existing ? (existing.created_by || identity.email) : identity.email,
          created_at: existing ? (existing.created_at || currentDateTime) : currentDateTime,
          updated_by: identity.email,
          lock_reason: row.lock_reason || ''
        };

        SheetRepository.upsertRecord('SchoolDays', 'date', dateStr, record);
      });

      AuditService.log({
        action: 'IMPORT_SCHOOL_DAYS_CSV',
        module: 'calendar',
        reason: '完成大宗匯入供餐日曆。結果：新增 ' + summary.create + ' 筆，更新 ' + summary.update + ' 筆，跳過 ' + summary.skip + ' 筆，重複衝突 ' + summary.conflict + ' 筆。'
      });

      Config.clearAllCache();
      return summary;
    });
  }

  /**
   * 列出指定區間或學期的上課日設定
   */
  function listSchoolDays(schoolYear, semester) {
    return SheetRepository.findRecords('SchoolDays', function(x) {
      return (!schoolYear || String(x.school_year) === String(schoolYear)) &&
             (!semester || String(x.semester) === String(semester));
    });
  }

  /**
   * 取得指定日期設定
   */
  function getSchoolDay(dateStr) {
    return SheetRepository.findById('SchoolDays', 'date', dateStr);
  }

  /**
   * 判斷某一天是否為供餐日
   */
  function isMealDay(dateStr) {
    var day = getSchoolDay(dateStr);
    if (!day) return false;
    return (day.is_meal_day === true || day.is_meal_day === 'TRUE');
  }

  return {
    validateUniqueSchoolDayDate: validateUniqueSchoolDayDate,
    findDuplicateSchoolDays: findDuplicateSchoolDays,
    mergeDuplicateSchoolDays: mergeDuplicateSchoolDays,
    migrateSchoolDaysToUniqueDates: migrateSchoolDaysToUniqueDates,
    batchCreateSchoolDays: batchCreateSchoolDays,
    updateSchoolDay: updateSchoolDay,
    importSchoolDaysCSV: importSchoolDaysCSV,
    listSchoolDays: listSchoolDays,
    getSchoolDay: getSchoolDay,
    isMealDay: isMealDay
  };
})();
