/**
 * CalculationService.gs
 * 統一金額計算與小數點四捨五入核心服務
 */

var CalculationService = (function() {

  /**
   * 計算原始未進位金額
   * @param {number} mealCount 餐數
   * @param {number} price 單餐金額
   * @param {number} rateOrAmount 比例(0~1)或固定金額
   * @param {string} type 計算類型 ('percentage' 或 'fixed_amount')
   * @return {number} 原始金額 (浮點數)
   */
  function calculateRawAmount(mealCount, price, rateOrAmount, type) {
    if (type === 'percentage') {
      return mealCount * price * rateOrAmount;
    } else if (type === 'fixed_amount') {
      return mealCount * rateOrAmount;
    }
    return 0;
  }

  /**
   * 根據 SystemConfig 中的進位模式與小數點位數進行數值進位處理
   * @param {number} rawAmount 原始數值
   * @return {number} 進位後數值
   */
  function applyRounding(rawAmount) {
    var mode = Config.getSystemConfig('ROUNDING_MODE', 'HALF_UP');
    var scale = parseInt(Config.getSystemConfig('ROUNDING_SCALE', '0'), 10);
    
    var factor = Math.pow(10, scale);
    var temp = rawAmount * factor;
    var roundedTemp;

    if (mode === 'HALF_UP') {
      // JavaScript Math.round 在負數或特定浮點數時有小落差，採用標準 EPSILON 處理
      roundedTemp = Math.round(temp + Number.EPSILON);
    } else if (mode === 'FLOOR') {
      roundedTemp = Math.floor(temp + Number.EPSILON);
    } else if (mode === 'CEILING') {
      roundedTemp = Math.ceil(temp - Number.EPSILON);
    } else {
      roundedTemp = Math.round(temp); // 預設四捨五入
    }

    return roundedTemp / factor;
  }

  /**
   * 查詢指定學生在特定日期的有效補助身分
   * @param {string} date 日期 (YYYY-MM-DD)
   * @param {string} studentId 學生 ID
   * @return {string} 補助身分類別 ID (subsidy_category_id)
   */
  function getStudentSubsidyCategoryAtDate(date, studentId) {
    if (!SheetRepository.sheetExists('StudentSubsidyHistory')) {
      throw new Error('StudentSubsidyHistory 工作表不存在');
    }
    
    // 查詢該學生的所有啟用歷史歷程
    var records = SheetRepository.findRecords('StudentSubsidyHistory', function(r) {
      return String(r.student_id) === String(studentId) && 
             (r.enabled === true || r.enabled === 'TRUE');
    });

    var targetCategory = null;
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      var start = r.effective_start_date;
      var end = r.effective_end_date;

      // 比對日期區間 (start_date <= date <= end_date)
      var d = new Date(date).getTime();
      var s = new Date(start).getTime();
      var e = end ? new Date(end).getTime() : Infinity;

      if (d >= s && d <= e) {
        targetCategory = r.subsidy_category_id;
        break;
      }
    }

    if (!targetCategory) {
      throw new Error('找不到學生於該日期 (' + date + ') 的有效補助身分歷程，學生 ID: ' + studentId);
    }

    return targetCategory;
  }

  /**
   * 獲取指定身分類別在特定日期生效之補助規則清單
   * @param {string} date 日期 (YYYY-MM-DD)
   * @param {string} subsidyCategoryId 補助身分類別 ID
   * @return {object[]} 生效規則清單
   */
  function getApplicableSubsidyRules(date, subsidyCategoryId) {
    if (!SheetRepository.sheetExists('SubsidyRules')) {
      return [];
    }

    var rules = SheetRepository.findRecords('SubsidyRules', function(r) {
      return String(r.subsidy_category_id) === String(subsidyCategoryId) && 
             (r.enabled === true || r.enabled === 'TRUE');
    });

    var d = new Date(date).getTime();
    var activeRules = rules.filter(function(r) {
      var s = new Date(r.effective_start_date).getTime();
      var e = r.effective_end_date ? new Date(r.effective_end_date).getTime() : Infinity;
      return d >= s && d <= e;
    });

    if (activeRules.length === 0) {
      throw new Error('找不到該補助身分 (' + subsidyCategoryId + ') 於日期 ' + date + ' 的有效補助規則');
    }

    return activeRules;
  }

  /**
   * 依當日有效補助規則，計算並進位各來源之補助與自付金額
   * @param {string} date 日期 (YYYY-MM-DD)
   * @param {string} classId 班級 ID
   * @param {string} subsidyCategoryId 補助身分類別 ID
   * @param {number} mealCount 實際用餐餐數 (一般為 1)
   * @return {object} { township, county, school, self_pay, other, total } 各項來源進位後的金額
   */
  function calculateFundingAmounts(date, classId, subsidyCategoryId, mealCount) {
    // 取得當日餐費
    var mealPrice = 60; // 預設值
    try {
      var day = SheetRepository.findById('SchoolDays', 'date', date);
      if (day && day.meal_price) {
        mealPrice = parseFloat(day.meal_price);
      } else {
        mealPrice = parseFloat(Config.getSystemConfig('DEFAULT_MEAL_PRICE', '60'));
      }
    } catch(e) {
      mealPrice = parseFloat(Config.getSystemConfig('DEFAULT_MEAL_PRICE', '60'));
    }

    var rules = getApplicableSubsidyRules(date, subsidyCategoryId);
    var amounts = {
      township: 0,
      county: 0,
      school: 0,
      self_pay: 0,
      other: 0,
      total: mealCount * mealPrice
    };

    var mixedOrder = Config.getSystemConfig('MIXED_RULE_CALCULATION_ORDER', 'percentage_first');
    var allowOverPrice = (Config.getSystemConfig('ALLOW_SUBSIDY_OVER_MEAL_PRICE', 'FALSE') === 'TRUE');
    
    var rawAmounts = { township: 0, county: 0, school: 0, self_pay: 0, other: 0 };

    // 百分比與金額補助混合運算順序
    var percentageRules = rules.filter(function(r) { return r.calculation_type === 'percentage'; });
    var fixedRules = rules.filter(function(r) { return r.calculation_type === 'fixed_amount'; });

    // 輔助計算函數
    function applyRule(r) {
      var raw = calculateRawAmount(mealCount, mealPrice, 
        r.calculation_type === 'percentage' ? parseFloat(r.subsidy_rate) : parseFloat(r.subsidy_amount), 
        r.calculation_type
      );
      rawAmounts[r.funding_source] += raw;
    }

    if (mixedOrder === 'percentage_first') {
      percentageRules.forEach(applyRule);
      fixedRules.forEach(applyRule);
    } else {
      fixedRules.forEach(applyRule);
      percentageRules.forEach(applyRule);
    }

    // 計算各來源之進位後金額
    var sumSubsidy = 0;
    Object.keys(rawAmounts).forEach(function(source) {
      if (source !== 'self_pay') {
        var rounded = applyRounding(rawAmounts[source]);
        amounts[source] = rounded;
        sumSubsidy += rounded;
      }
    });

    // 計算自付額 (總餐費 - 所有補助之加總)
    var selfPayRaw = rawAmounts.self_pay;
    if (selfPayRaw === 0 && sumSubsidy < amounts.total) {
      // 若未明確定義自付額規則，但補助加總小於總餐費，差額自動歸為自付額
      amounts.self_pay = amounts.total - sumSubsidy;
    } else {
      amounts.self_pay = applyRounding(selfPayRaw);
    }

    // 檢查總額是否合理
    var totalCalc = sumSubsidy + amounts.self_pay;
    if (!allowOverPrice && totalCalc > amounts.total) {
      // 限制補助加總不得超過餐費總價，若超出則同比例縮減 (或拋出異常，此處以拋出警示為主)
      throw new Error('計算異常：日期 ' + date + ' 身分 ' + subsidyCategoryId + ' 補助加總金額超過當日餐費金額。');
    }

    return amounts;
  }

  /**
   * 驗證各補助來源加總是否等於總餐費
   * @param {number} totalAmount 總餐費
   * @param {object} fundingAmountsMap 各來源金額 Map
   * @return {boolean} 是否平衡
   */
  function validateFundingTotal(totalAmount, fundingAmountsMap) {
    var sum = 0;
    Object.keys(fundingAmountsMap).forEach(function(key) {
      if (key !== 'total') {
        sum += parseFloat(fundingAmountsMap[key] || 0);
      }
    });
    return Math.abs(sum - totalAmount) < 0.0001;
  }

  return {
    calculateRawAmount: calculateRawAmount,
    applyRounding: applyRounding,
    getStudentSubsidyCategoryAtDate: getStudentSubsidyCategoryAtDate,
    getApplicableSubsidyRules: getApplicableSubsidyRules,
    calculateFundingAmounts: calculateFundingAmounts,
    validateFundingTotal: validateFundingTotal
  };
})();
