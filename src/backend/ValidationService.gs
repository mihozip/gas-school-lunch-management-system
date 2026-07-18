/**
 * ValidationService.gs
 * 系統核心資料欄位與邏輯驗證服務
 */

var ValidationService = (function() {

  /**
   * 驗證四捨五入設定規則值
   * @param {string} val 設定值
   * @return {boolean} 是否有效
   */
  function validateRoundingRule(val) {
    return val === 'DAILY_ROUND' || val === 'MONTHLY_ROUND';
  }

  /**
   * 驗證進位模式設定值
   * @param {string} val 設定值
   * @return {boolean} 是否有效
   */
  function validateRoundingMode(val) {
    return val === 'HALF_UP' || val === 'FLOOR' || val === 'CEILING';
  }

  /**
   * 驗證保留小數點位數
   * @param {string|number} val 設定值
   * @return {boolean} 是否有效
   */
  function validateRoundingScale(val) {
    var scale = parseInt(val, 10);
    return scale === 0 || scale === 1 || scale === 2;
  }

  /**
   * 驗證系統設定的特定欄位值是否合法
   * @param {string} key 設定鍵
   * @param {string} val 設定值
   * @return {object} { valid: boolean, error: string }
   */
  function validateSystemConfig(key, val) {
    if (key === 'ROUNDING_RULE' && !validateRoundingRule(val)) {
      return { valid: false, error: 'ROUNDING_RULE 必須為 DAILY_ROUND 或 MONTHLY_ROUND' };
    }
    if (key === 'ROUNDING_MODE' && !validateRoundingMode(val)) {
      return { valid: false, error: 'ROUNDING_MODE 必須為 HALF_UP、FLOOR 或 CEILING' };
    }
    if (key === 'ROUNDING_SCALE' && !validateRoundingScale(val)) {
      return { valid: false, error: 'ROUNDING_SCALE 必須為 0, 1, 2' };
    }
    if ((key === 'ALLOW_RETROACTIVE_EDIT' || key === 'ALLOW_SUBSIDY_OVER_MEAL_PRICE' || key === 'ENABLE_DIETARY_STATS') && (val !== 'TRUE' && val !== 'FALSE')) {
      return { valid: false, error: key + ' 必須為 TRUE 或 FALSE' };
    }
    return { valid: true, error: '' };
  }

  /**
   * 檢查兩個日期區間是否重疊
   * @param {string} startA 區間 A 開始日期
   * @param {string} endA 區間 A 結束日期 (空字串或 null 代表無限遠)
   * @param {string} startB 區間 B 開始日期
   * @param {string} endB 區間 B 結束日期 (空字串或 null 代表無限遠)
   * @return {boolean} 是否重疊
   */
  function isDateOverlapping(startA, endA, startB, endB) {
    var sA = new Date(startA).getTime();
    var eA = endA ? new Date(endA).getTime() : Infinity;
    var sB = new Date(startB).getTime();
    var eB = endB ? new Date(endB).getTime() : Infinity;
    
    return sA <= eB && sB <= eA;
  }

  /**
   * 驗證學生補助身分歷程是否重疊
   * @param {object[]} historyRecords 該學生現有的所有歷程記錄
   * @param {object} newRecord 要新增/修改的歷程記錄 (必須包含 student_id, effective_start_date, effective_end_date)
   * @return {object} { valid: boolean, error: string }
   */
  function validateStudentSubsidyHistory(historyRecords, newRecord) {
    if (!newRecord.effective_start_date) {
      return { valid: false, error: '生效開始日期為必填項' };
    }

    for (var i = 0; i < historyRecords.length; i++) {
      var rec = historyRecords[i];
      // 排除自身記錄的更新比對 (若有 history_id)
      if (newRecord.history_id && rec.history_id === newRecord.history_id) {
        continue;
      }
      if (rec.enabled === false || rec.enabled === 'FALSE') {
        continue; // 忽略已停用的歷程
      }

      if (isDateOverlapping(
        rec.effective_start_date, rec.effective_end_date,
        newRecord.effective_start_date, newRecord.effective_end_date
      )) {
        return {
          valid: false,
          error: '補助身分生效區間與現有歷程重疊：[' + rec.effective_start_date + ' 至 ' + (rec.effective_end_date || '持續有效') + ']'
        };
      }
    }

    return { valid: true, error: '' };
  }

  /**
   * 驗證學生班級歷程是否重疊
   * @param {object[]} historyRecords 該學生現有的所有班級歷程記錄
   * @param {object} newRecord 要新增/修改的歷程記錄
   * @return {object} { valid: boolean, error: string }
   */
  function validateStudentClassHistory(historyRecords, newRecord) {
    if (!newRecord.effective_start_date) {
      return { valid: false, error: '生效開始日期為必填項' };
    }

    for (var i = 0; i < historyRecords.length; i++) {
      var rec = historyRecords[i];
      if (newRecord.history_id && rec.history_id === newRecord.history_id) {
        continue;
      }
      if (rec.enabled === false || rec.enabled === 'FALSE') {
        continue;
      }

      if (isDateOverlapping(
        rec.effective_start_date, rec.effective_end_date,
        newRecord.effective_start_date, newRecord.effective_end_date
      )) {
        return {
          valid: false,
          error: '班級生效區間與現有歷程重疊：[' + rec.effective_start_date + ' 至 ' + (rec.effective_end_date || '持續有效') + ']'
        };
      }
    }

    return { valid: true, error: '' };
  }

  /**
   * 驗證補助規則是否符合規範且無重疊
   * @param {object[]} ruleRecords 該身分類別在資料庫中的現有規則
   * @param {object} newRule 要新增/修改的規則
   * @return {object} { valid: boolean, error: string }
   */
  function validateSubsidyRules(ruleRecords, newRule) {
    if (!newRule.subsidy_category_id) {
      return { valid: false, error: '補助身分類別 ID 為必填項' };
    }
    if (!newRule.effective_start_date) {
      return { valid: false, error: '規則生效開始日期為必填項' };
    }

    // 1. 同一 funding_source 驗證日期重疊
    for (var i = 0; i < ruleRecords.length; i++) {
      var r = ruleRecords[i];
      if (newRule.rule_id && r.rule_id === newRule.rule_id) {
        continue;
      }
      if (r.enabled === false || r.enabled === 'FALSE') {
        continue;
      }

      if (r.funding_source === newRule.funding_source) {
        if (isDateOverlapping(
          r.effective_start_date, r.effective_end_date,
          newRule.effective_start_date, newRule.effective_end_date
        )) {
          return {
            valid: false,
            error: '同一補助來源的生效日期區間重疊：[' + r.effective_start_date + ' 至 ' + (r.effective_end_date || '持續有效') + ']'
          };
        }
      }
    }

    // 2. 數值範圍與合法性檢查
    if (newRule.calculation_type === 'percentage') {
      var rate = parseFloat(newRule.subsidy_rate);
      if (isNaN(rate) || rate < 0 || rate > 1) {
        return { valid: false, error: '百分比計算時，補助比例 (subsidy_rate) 必須介於 0.00 到 1.00 之間' };
      }
    } else if (newRule.calculation_type === 'fixed_amount') {
      var amt = parseFloat(newRule.subsidy_amount);
      if (isNaN(amt) || amt < 0) {
        return { valid: false, error: '固定金額計算時，補助金額 (subsidy_amount) 不得為負數' };
      }
    } else {
      return { valid: false, error: '無效的計算類型，必須為 percentage 或 fixed_amount' };
    }

    // 3. 檢查特定日期下 percentage 補助的加總是否合法
    // 此項目在單筆儲存時通常為警告或限制，此處提供單日總和檢查函數
    return { valid: true, error: '' };
  }

  /**
   * 驗證同一身分類別、特定日期的百分比補助總和是否小於等於 1.00
   * @param {object[]} activeRulesAtDate 當日生效的所有啟用規則
   * @return {object} { valid: boolean, error: string }
   */
  function validatePercentageRulesSum(activeRulesAtDate) {
    var sum = 0;
    activeRulesAtDate.forEach(function(r) {
      if (r.calculation_type === 'percentage') {
        sum += parseFloat(r.subsidy_rate || 0);
      }
    });

    if (sum > 1.00) {
      return {
        valid: false,
        error: '該日期區間下百分比補助總和為 ' + (sum * 100) + '%，已超過 100%'
      };
    }
    return { valid: true, error: '' };
  }

  return {
    validateRoundingRule: validateRoundingRule,
    validateRoundingMode: validateRoundingMode,
    validateRoundingScale: validateRoundingScale,
    validateSystemConfig: validateSystemConfig,
    validateStudentSubsidyHistory: validateStudentSubsidyHistory,
    validateStudentClassHistory: validateStudentClassHistory,
    validateSubsidyRules: validateSubsidyRules,
    validatePercentageRulesSum: validatePercentageRulesSum
  };
})();
