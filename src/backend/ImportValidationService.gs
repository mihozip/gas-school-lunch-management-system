/**
 * ImportValidationService.gs
 * 匯入資料正規化與驗證服務
 */

var ImportValidationService = (function() {

  var ALIAS_MAP = {
    'student_number': ['student_number', '學號'],
    'student_name': ['student_name', '學生姓名', '姓名'],
    'class_code': ['class_code', '班級', '班級代碼'],
    'seat_number': ['seat_number', '座號'],
    'subsidy_category': ['subsidy_category', '補助身分', '身分類別'],
    'dietary_type': ['dietary_type', '餐別', '膳食類別'],
    'start_date': ['start_date', '入校日期', '轉入日期', '開始日期'],
    'end_date': ['end_date', '轉出日期', '結束日期'],
    'note': ['note', '備註']
  };

  /**
   * 將原始欄位標題對應到系統標準欄位鍵
   * @param {string[]} headers 原始欄位列
   * @return {object} { 欄位索引: 標準鍵 }
   */
  function mapHeaders(headers) {
    var mapping = {};
    headers.forEach(function(header, index) {
      if (!header) return;
      var cleanHeader = String(header).trim().toLowerCase();
      
      var matchedKey = null;
      Object.keys(ALIAS_MAP).forEach(function(key) {
        var aliases = ALIAS_MAP[key];
        aliases.forEach(function(alias) {
          if (cleanHeader === alias.toLowerCase()) {
            matchedKey = key;
          }
        });
      });

      if (matchedKey) {
        mapping[index] = matchedKey;
      }
    });
    return mapping;
  }

  /**
   * 正規化日期字串 (支援 YYYY-MM-DD, 民國日期 115/09/01, 民國純數字 1150901)
   */
  function normalizeDate(dateStr) {
    if (!dateStr) return '';
    var s = String(dateStr).trim();
    if (!s) return '';

    // 1. 已是 YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      return s;
    }

    // 2. YYYY/MM/DD 限制月和日必須是 2 位數以防模糊日期
    if (/^\d{4}\/\d{2}\/\d{2}$/.test(s)) {
      var parts = s.split('/');
      return parts[0] + '-' + parts[1] + '-' + parts[2];
    }

    // 3. 民國日期 115/09/01 或 115-09-01 (年分 3 位數，月日 2 位數)
    var minguoSlashMatch = s.match(/^(\d{3})[\/\-](\d{2})[\/\-](\d{2})$/);
    if (minguoSlashMatch) {
      var yr = parseInt(minguoSlashMatch[1], 10) + 1911;
      return yr + '-' + minguoSlashMatch[2] + '-' + minguoSlashMatch[3];
    }

    // 4. 民國純數字例如 1150901 (長度精確為 7 位)
    if (/^\d{7}$/.test(s)) {
      var yr = parseInt(s.substring(0, 3), 10) + 1911;
      var mo = s.substring(3, 5);
      var dy = s.substring(5, 7);
      return yr + '-' + mo + '-' + dy;
    }

    // 5. 西元純數字例如 20260901 (長度精確為 8 位)
    if (/^\d{8}$/.test(s)) {
      var yr = s.substring(0, 4);
      var mo = s.substring(4, 6);
      var dy = s.substring(6, 8);
      return yr + '-' + mo + '-' + dy;
    }

    // 其餘模糊、不足位數日期 (例如 1591, 11591, 115901) 一律拒絕，不得猜測
    throw new Error('日期格式無法唯一判斷，請使用 115/09/01 或 2026-09-01。');
  }

  function padZero(numStr) {
    var val = parseInt(numStr, 10);
    return val < 10 ? '0' + val : String(val);
  }

  /**
   * 驗證與比對單列資料的狀態
   * @param {object} rowData 正規化後的單列 JSON 資料
   * @param {object[]} existingStudents 當前資料庫中的所有學生快取
   * @param {object[]} classes 當前班級清單快取
   * @param {object[]} categories 補助身分類別快取
   * @param {object[]} dietaryTypes 膳食類別快取
   * @param {object} uniqueMap 上傳資料中已處理學號之 Map (用以檢測 Conflict)
   * @param {number} schoolYear 匯入所屬之學年度
   * @return {object} 評估結果 { action, normalizedData, errors, warnings, matchedStudent }
   */
  function validateRow(rowData, existingStudents, classes, categories, dietaryTypes, uniqueMap, schoolYear) {
    var errors = [];
    var warnings = [];
    var action = 'CREATE';
    var matchedStudent = null;

    var startDateNormalized = '';
    var endDateNormalized = '';
    
    try {
      startDateNormalized = normalizeDate(rowData.start_date);
    } catch(e) {
      startDateNormalized = 'INVALID_DATE: ' + e.message;
    }
    
    try {
      endDateNormalized = normalizeDate(rowData.end_date);
    } catch(e) {
      endDateNormalized = 'INVALID_DATE: ' + e.message;
    }

    // 1. 正規化基礎資料
    var norm = {
      student_number: String(rowData.student_number || '').trim(),
      student_name: String(rowData.student_name || '').trim(),
      class_code: String(rowData.class_code || '').trim().toUpperCase(),
      seat_number: parseInt(rowData.seat_number, 10) || 0,
      subsidy_category: String(rowData.subsidy_category || '').trim(),
      dietary_type: String(rowData.dietary_type || '葷食').trim(),
      start_date: startDateNormalized,
      end_date: endDateNormalized,
      note: String(rowData.note || '').trim()
    };

    // 2. 欄位合法性驗證
    if (!norm.student_name) {
      errors.push('學生姓名不得為空白');
    }
    if (!norm.class_code) {
      errors.push('班級代碼不得為空白');
    }

    if (norm.start_date && norm.start_date.indexOf('INVALID_DATE') !== -1) {
      errors.push(norm.start_date.replace('INVALID_DATE: ', ''));
    }
    if (norm.end_date && norm.end_date.indexOf('INVALID_DATE') !== -1) {
      errors.push(norm.end_date.replace('INVALID_DATE: ', ''));
    }

    // 2.1 驗證班級是否存在
    var matchedClass = classes.filter(function(c) {
      return String(c.school_year) === String(schoolYear) && c.class_code === norm.class_code;
    })[0];

    if (!matchedClass) {
      errors.push('班級代碼 [' + norm.class_code + '] 不存在於學年度 ' + schoolYear + ' 的班級名冊中');
    } else {
      norm.class_id = matchedClass.class_id; // 綁定 ID
    }

    // 2.2 驗證補助身分
    var matchedCategory = categories.filter(function(cat) {
      return cat.subsidy_category_id === norm.subsidy_category || cat.category_name === norm.subsidy_category;
    })[0];

    if (!norm.subsidy_category) {
      norm.subsidy_category_id = 'GENERAL'; // 預設為一般生
    } else if (!matchedCategory) {
      errors.push('身分類別 [' + norm.subsidy_category + '] 不存在於系統補助類別中');
    } else {
      norm.subsidy_category_id = matchedCategory.subsidy_category_id;
    }

    // 2.3 驗證膳食類別 (對照 JSON 陣列或逗號字串)
    var matchedDiet = dietaryTypes.filter(function(d) {
      return d.code === norm.dietary_type || d.name === norm.dietary_type;
    })[0];
    if (norm.dietary_type && !matchedDiet) {
      warnings.push('膳食類別 [' + norm.dietary_type + '] 未在系統膳食設定中啟用，匯入後將沿用此類別，但可能無法進行標準統計。');
    }

    // 3. 唯一性與動作分類比對 (CREATE, UPDATE, SKIP, CONFLICT)
    if (norm.student_number) {
      // 3.1 偵測上傳檔案內部的重複 Conflict
      if (uniqueMap[norm.student_number]) {
        action = 'CONFLICT';
        errors.push('上傳資料中存在重複的學號: ' + norm.student_number);
      } else {
        uniqueMap[norm.student_number] = true;
      }

      // 3.2 比對資料庫中既有學生
      var dbStudent = existingStudents.filter(function(s) {
        return String(s.school_year) === String(schoolYear) && s.student_number === norm.student_number;
      })[0];

      if (dbStudent) {
        matchedStudent = dbStudent;
        
        // 檢查是否有欄位異動
        var hasChanges = 
          dbStudent.student_name !== norm.student_name ||
          dbStudent.class_id !== norm.class_id ||
          dbStudent.seat_number !== norm.seat_number ||
          dbStudent.subsidy_category_id !== norm.subsidy_category_id ||
          dbStudent.dietary_type !== norm.dietary_type ||
          dbStudent.start_date !== norm.start_date ||
          dbStudent.end_date !== norm.end_date ||
          dbStudent.note !== norm.note;

        if (hasChanges) {
          action = 'UPDATE';
        } else {
          action = 'SKIP';
        }
      }
    } else {
      // 沒有學號：視為無學號模式 (SCHOOL_YEAR_AND_STUDENT_NUMBER 允許無學號，但無法更新只能新增)
      action = 'CREATE';
    }

    if (errors.length > 0) {
      action = 'ERROR';
    }

    return {
      action: action,
      normalizedData: norm,
      errors: errors,
      warnings: warnings,
      matchedStudent: matchedStudent
    };
  }

  return {
    mapHeaders: mapHeaders,
    normalizeDate: normalizeDate,
    validateRow: validateRow
  };
})();
