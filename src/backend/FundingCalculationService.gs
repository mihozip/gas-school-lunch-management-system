/**
 * FundingCalculationService.gs
 * 補助分攤運算與財務對帳服務 (Phase 5)
 */

var FundingCalculationService = (function() {

  /**
   * 執行指定月份的補助分攤計算
   */
  function calculateMonthlyFunding(yearMonth) {
    AuthService.requireAnyRole(['system_admin', 'lunch_admin']);
    var identity = AuthService.getCurrentIdentity();
    var currentDateTime = Utils.formatDateTime(new Date());

    return LockServiceHelper.runWithLock(function() {
      // 1. 取得該月份所有的有效 DailyMealLedger 記錄
      var start = yearMonth + '-01';
      var lastDay = new Date(parseInt(yearMonth.substring(0, 4), 10), parseInt(yearMonth.substring(5, 7), 10), 0).getDate();
      var end = yearMonth + '-' + Utils.padZero(lastDay);

      // 取得當前有效的 Meal Calculation Run ID
      var currentMealRuns = SheetRepository.findRecords('CalculationRuns', function(x) {
        return x.target_month === yearMonth && x.is_current === true && x.status.indexOf('completed') === 0;
      });

      if (currentMealRuns.length === 0) {
        throw new Error('🛑 對帳錯誤：當月份尚無有效的正式餐數計算批次，請先前往「每日計算」完成計算。');
      }

      // 檢查是否中途資料來源發生改變
      var beforeHash = calculateFundingSourceHash(yearMonth);

      var nextRunId = 'FRUN_' + new Date().getTime() + '_' + Math.floor(Math.random() * 100);
      var currentVersion = 1;
      
      // 取得新版號
      var oldRuns = SheetRepository.findRecords('MonthClosings', function(x) {
        return x.year_month === yearMonth && x.status !== 'failed';
      });
      if (oldRuns.length > 0) {
        var maxVer = 0;
        oldRuns.forEach(function(x) {
          var v = parseInt(x.closing_version, 10) || 0;
          if (v > maxVer) maxVer = v;
        });
        currentVersion = maxVer + 1;
      }

      var ledgers = SheetRepository.findRecords('DailyMealLedger', function(x) {
        return x.date >= start && x.date <= end && x.eligible_meal_count === 1;
      });

      var allocations = [];
      var issues = [];

      // 2. 逐筆 Ledger 進行補助分攤計算
      ledgers.forEach(function(ledgerRow) {
        try {
          var rowAllocations = calculateFundingForLedgerRow(ledgerRow, nextRunId, currentVersion, issues);
          allocations = allocations.concat(rowAllocations);
        } catch (e) {
          // 捕捉運算異常，寫入 Issues
          issues.push({
            issue_id: 'ISSUE_F_' + new Date().getTime() + '_' + Math.floor(Math.random() * 100),
            calculation_run_id: nextRunId,
            date: ledgerRow.date,
            class_id: ledgerRow.class_id,
            student_id: ledgerRow.student_id,
            issue_code: e.code || 'FUNDING_ALLOCATION_NOT_BALANCED',
            severity: 'blocking',
            message: e.message,
            source_sheet: 'DailyMealLedger',
            source_record_id: ledgerRow.ledger_id,
            status: 'open',
            resolution_note: '',
            resolved_by: '',
            resolved_at: '',
            created_at: currentDateTime
          });
        }
      });

      // 3. 檢查是否有任何 blocking issues
      var hasBlocking = issues.some(function(i) { return i.severity === 'blocking'; });

      // 檢查計算前後 Hash 是否變動
      var afterHash = calculateFundingSourceHash(yearMonth);
      if (beforeHash !== afterHash) {
        var err = new Error('計算中途補助規則或學員歷程被修改，請重新執行。');
        err.code = 'FUNDING_SOURCE_CHANGED_DURING_RUN';
        throw err;
      }

      if (hasBlocking) {
        // 寫入 Issues
        issues.forEach(function(iss) {
          SheetRepository.appendRecord('CalculationIssues', iss);
        });
        
        var err = new Error('運算過程中偵測到阻斷性財務規則錯誤 (Blocking Issues)，分攤計算終止。');
        err.code = 'BLOCKING_ISSUES_FOUND';
        throw err;
      }

      // 4. 清除該月份舊版之分攤明細 (is_current = false 在彙總時連動，我們先 appendLedger)
      var ssId = Config.getSpreadsheetId();
      var shAlloc = SpreadsheetApp.openById(ssId).getSheetByName('FundingAllocationLedger');
      
      // 為求乾淨，如果是同一版本的重新預估，我們直接刪除舊的分配紀錄
      var rangeAlloc = shAlloc.getDataRange();
      var valsAlloc = rangeAlloc.getValues();
      for (var idx = valsAlloc.length - 1; idx >= 1; idx--) {
        var rowYearMonth = valsAlloc[idx][5]; // year_month 欄位
        if (rowYearMonth === yearMonth) {
          shAlloc.deleteRow(idx + 1);
        }
      }

      // 5. 正式寫入 FundingAllocationLedger
      allocations.forEach(function(alloc) {
        SheetRepository.appendRecord('FundingAllocationLedger', alloc);
      });

      // 6. 彙總到 MonthlyFundingSummary
      var fundingSummaries = aggregateMonthlyFunding(allocations, nextRunId, currentVersion);
      writeMonthlyFundingSummaries(fundingSummaries, yearMonth);

      // 7. 更新 MonthlyMealSummary 的補助金額欄位 (同時寫入元與 minor 單位)
      updateMonthlyMealSummaryAmounts(yearMonth, allocations);

      // 8. 寫入警告型問題 (例如自付額非 0)
      issues.forEach(function(iss) {
        SheetRepository.appendRecord('CalculationIssues', iss);
      });

      AuditService.log({
        action: 'CALCULATE_MONTHLY_FUNDING',
        module: 'calculation',
        recordId: nextRunId,
        reason: '完成月份補助金額分攤計算：' + yearMonth + '，共分攤 ' + ledgers.length + ' 筆用餐紀錄，版本 v' + currentVersion
      });

      return {
        success: true,
        runId: nextRunId,
        version: currentVersion,
        allocationsCount: allocations.length,
        summariesCount: fundingSummaries.length,
        warningsCount: issues.length
      };

    });
  }
  /**
   * 驗證已取得的補助規則陣列是否合法
   * @param {Array} rules 規則陣列
   * @param {string} subsidyCategoryId 補助身分分類 ID
   * @param {string} dateStr 日期字串 YYYY-MM-DD
   * @throws {Error} 若規則不合法
   */
  function validateApplicableFundingRules(rules, subsidyCategoryId, dateStr) {
    if (!Array.isArray(rules) || rules.length === 0) {
      var err = new Error('找不到身分 ' + subsidyCategoryId + ' 於 ' + dateStr + ' 的補助規則設定。');
      err.code = 'FUNDING_RULE_NOT_FOUND';
      throw err;
    }

    var seenSources = {};
    rules.forEach(function(rule) {
      // 每筆規則必須有 rule_id
      if (!rule.rule_id) {
        var err = new Error('補助規則缺少 rule_id。');
        err.code = 'FUNDING_RULE_INVALID';
        throw err;
      }
      // subsidy_category_id 必須與 ledgerRow 相符
      if (rule.subsidy_category_id !== subsidyCategoryId) {
        var err = new Error('補助規則 ' + rule.rule_id + ' 的 subsidy_category_id (' + rule.subsidy_category_id + ') 與目標身分 (' + subsidyCategoryId + ') 不符。');
        err.code = 'FUNDING_RULE_CATEGORY_MISMATCH';
        throw err;
      }
      // enabled 必須為 true
      if (rule.enabled !== true) {
        var err = new Error('補助規則 ' + rule.rule_id + ' 未啟用 (enabled !== true)。');
        err.code = 'FUNDING_RULE_DISABLED';
        throw err;
      }
      // 日期區間檢查
      if (dateStr < rule.effective_start_date || dateStr > rule.effective_end_date) {
        var err = new Error('補助規則 ' + rule.rule_id + ' 不適用於日期 ' + dateStr + '。');
        err.code = 'FUNDING_RULE_DATE_OUT_OF_RANGE';
        throw err;
      }
      // 相同 funding_source 不得重複
      if (seenSources[rule.funding_source]) {
        var err = new Error('偵測到重複生效的補助來源規則：' + rule.funding_source);
        err.code = 'FUNDING_RULE_OVERLAP';
        throw err;
      }
      seenSources[rule.funding_source] = true;
    });
  }

  /**
   * 針對單一 DailyMealLedger 逐餐計算補助分攤明細
   * @param {Object} ledgerRow 每日餐費明細列
   * @param {string} runId 計算執行 ID
   * @param {number} version 計算版本
   * @param {Array} issuesList 問題清單
   * @param {Object} [options] 可選參數，支援 rulesOverride
   */
  function calculateFundingForLedgerRow(ledgerRow, runId, version, issuesList, options) {
    options = options || {};
    var dateStr = ledgerRow.date;
    var grossMinor = MoneyService.yuanToMinorStrict(ledgerRow.meal_price_snapshot, 'meal_price_snapshot');

    // 1. 取得該日期與該身分適用的補助規則
    var rules;

    if (options && Array.isArray(options.rulesOverride)) {
      if (!Config.getTestMode()) {
        var overrideErr = new Error('rulesOverride 僅允許在自動測試模式使用');
        overrideErr.code = 'TEST_OVERRIDE_NOT_ALLOWED';
        throw overrideErr;
      }
      rules = options.rulesOverride;
    } else {
      rules = getApplicableFundingRules(ledgerRow.subsidy_category_id, dateStr);
    }

    validateApplicableFundingRules(rules, ledgerRow.subsidy_category_id, dateStr);

    // 2. 依計算順序 (EXPLICIT_ORDER 或 MIXED_RULE_CALCULATION_ORDER) 排序規則
    var sortedRules = sortRules(rules);

    var allocations = [];
    var sumFixedMinor = 0;
    var percentageBaseMode = Config.getSystemConfig('PERCENTAGE_BASE_MODE', 'GROSS_AMOUNT');

    // 3. 逐條規則計算 Raw Amount (分數或小數)
    sortedRules.forEach(function(rule) {
      var bps = 0;
      var fixedMinor = 0;

      if (rule.calculation_type === 'percentage') {
        var bpsVal = rule.subsidy_rate;
        if (bpsVal === undefined || bpsVal === null || bpsVal === '') {
          var err = new Error('🛑 補助比例 (subsidy_rate) 必填。');
          err.code = 'SUBSIDY_RATE_MISSING';
          throw err;
        }
        bps = Number(bpsVal);
        if (!Number.isFinite(bps) || !Number.isInteger(bps)) {
          var err = new Error('🛑 費率必須為安全整數，實際得到：' + bpsVal);
          err.code = 'SUBSIDY_RATE_INVALID';
          throw err;
        }
        SubsidyRuleService.validateRateBasisPoints(bps);
        fixedMinor = 0;
      } else if (rule.calculation_type === 'fixed_amount') {
        var amtVal = rule.subsidy_amount;
        if (amtVal === undefined || amtVal === null || amtVal === '') {
          var err = new Error('🛑 固定補助金額 (subsidy_amount) 必填。');
          err.code = 'SUBSIDY_AMOUNT_MISSING';
          throw err;
        }
        fixedMinor = MoneyService.yuanToMinorStrict(amtVal, 'subsidy_amount');
        bps = 0;
      } else {
        var err = new Error('🛑 未知的補助計算類型：' + rule.calculation_type);
        err.code = 'CALCULATION_TYPE_INVALID';
        throw err;
      }

      var alloc = {
        allocation_id: 'ALC_' + ledgerRow.ledger_id.substring(7) + '_' + rule.funding_source + '_' + Math.floor(Math.random() * 100),
        funding_calculation_run_id: runId,
        meal_calculation_run_id: ledgerRow.calculation_run_id,
        closing_id: '',
        calculation_version: version,
        year_month: dateStr.substring(0, 7),
        date: dateStr,
        student_id: ledgerRow.student_id,
        class_id: ledgerRow.class_id,
        subsidy_category_id: ledgerRow.subsidy_category_id,
        daily_ledger_id: ledgerRow.ledger_id,
        funding_source: rule.funding_source,
        subsidy_rule_id: rule.rule_id,
        calculation_type: rule.calculation_type,
        calculation_order: rule.calculation_order || 1,
        gross_amount_minor: grossMinor,
        rate_basis_points: bps,
        fixed_amount_minor: fixedMinor,
        raw_amount_numerator: 0,
        raw_amount_denominator: 10000,
        amount_before_rounding: 0,
        rounded_amount_minor: 0,
        residual_adjustment_minor: 0,
        final_amount_minor: 0,
        rule_snapshot_json: JSON.stringify({
          rule_id: rule.rule_id,
          category: rule.subsidy_category_id,
          funding_source: rule.funding_source,
          calculation_type: rule.calculation_type,
          rate_basis_points: bps,
          fixed_amount_minor: fixedMinor,
          effective_start_date: rule.effective_start_date,
          effective_end_date: rule.effective_end_date,
          calculation_order: rule.calculation_order,
          rule_version: 1
        }),
        source_hash: '',
        calculation_status: 'draft',
        created_at: Utils.formatDateTime(new Date())
      };

      if (rule.calculation_type === 'fixed_amount') {
        if (fixedMinor > grossMinor) {
          var err = new Error('固定補助金額 ' + MoneyService.minorToYuan(fixedMinor) + ' 超過當日餐費 ' + MoneyService.minorToYuan(grossMinor));
          err.code = 'FUNDING_TOTAL_EXCEEDS_GROSS';
          throw err;
        }
        alloc.raw_amount_numerator = fixedMinor;
        alloc.raw_amount_denominator = 1;
        alloc.amount_before_rounding = fixedMinor;
        sumFixedMinor += fixedMinor;
      } else if (rule.calculation_type === 'percentage') {
        SubsidyRuleService.validateRateBasisPoints(bps);
        
        var baseMinor = grossMinor;
        if (percentageBaseMode === 'REMAINING_AFTER_FIXED') {
          // 扣除固定金額後之餘額為比例基礎
          // 此處需先累加已算完的固定金額
          baseMinor = grossMinor - sumFixedMinor;
          if (baseMinor < 0) baseMinor = 0;
        }

        alloc.raw_amount_numerator = baseMinor * bps;
        alloc.raw_amount_denominator = 10000;
        alloc.amount_before_rounding = (baseMinor * bps) / 10000;
      }

      // 4. 進位計算 (DAILY_ROUND 逐餐進位，MONTHLY_ROUND 暫存 rounded 等待月結時調整)
      var rounded = MoneyService.divideAndRound(alloc.raw_amount_numerator, alloc.raw_amount_denominator, Config.getSystemConfig('ROUNDING_MODE', 'HALF_UP'));
      alloc.rounded_amount_minor = rounded;
      alloc.final_amount_minor = rounded;

      // Phase 5.5 新增計算與結算分流
      alloc.calculation_amount_minor = rounded;
      alloc.settlement_amount_minor = MoneyService.convertCalculationToSettlement(rounded);
      alloc.settlement_residual_minor = 0;

      allocations.push(alloc);
    });

    // 5. 尾差處理 (以確保各來源分攤總額與餐費 minor 元件絕對相等)
    var roundingRule = Config.getSystemConfig('ROUNDING_RULE', 'DAILY_ROUND');
    if (roundingRule === 'DAILY_ROUND') {
      // 5A. 計算精度尾差調整
      MoneyService.allocateResidual(grossMinor, allocations, Config.getSystemConfig('ROUNDING_RESIDUAL_POLICY', 'SELF_PAY'), Config.getSystemConfig('ROUNDING_RESIDUAL_SOURCE', 'township'));
      allocations.forEach(function(a) { a.calculation_amount_minor = a.final_amount_minor; });

      // 5B. 結算精度尾差調整
      var totalSettlementMinor = MoneyService.convertCalculationToSettlement(grossMinor);
      MoneyService.calculateSettlementResidual(totalSettlementMinor, allocations, Config.getSystemConfig('ROUNDING_RESIDUAL_POLICY', 'SELF_PAY'), Config.getSystemConfig('ROUNDING_RESIDUAL_SOURCE', 'township'));
      
      // 寫入 warning issue (若有自付額且非 0，建立提示警告)
      var selfPayAlloc = allocations.filter(function(x) { return x.funding_source === 'self_pay'; })[0];
      if (selfPayAlloc && selfPayAlloc.final_amount_minor > 0) {
        issuesList.push(createIssue(runId, dateStr, ledgerRow.class_id, ledgerRow.student_id, 'SELF_PAY_AMOUNT_NONZERO', 'warning', '該生今日有自付額：$' + MoneyService.minorToYuan(selfPayAlloc.final_amount_minor) + ' 元。', 'FundingAllocationLedger', ''));
      }
    }

    // 6. 平衡與交叉校驗
    var totalSettlementMinor = MoneyService.convertCalculationToSettlement(grossMinor);
    var checkReconciliation = MoneyService.reconcileCalculationAndSettlement(allocations, grossMinor, totalSettlementMinor);
    if (!checkReconciliation.valid) {
      var err = new Error(checkReconciliation.reason);
      err.code = 'FUNDING_ALLOCATION_NOT_BALANCED';
      throw err;
    }

    return allocations;
  }

  function getApplicableFundingRules(subsidyCategoryId, dateStr) {
    var rules = SheetRepository.findRecords('SubsidyRules', function(x) {
      return x.subsidy_category_id === subsidyCategoryId && 
             x.enabled === true && 
             dateStr >= x.effective_start_date && 
             dateStr <= x.effective_end_date;
    });

    return rules;
  }

  function sortRules(rules) {
    var mixedOrder = Config.getSystemConfig('MIXED_RULE_CALCULATION_ORDER', 'PERCENTAGE_THEN_FIXED');
    
    var list = JSON.parse(JSON.stringify(rules));
    
    if (mixedOrder === 'EXPLICIT_ORDER') {
      list.sort(function(a, b) { return (a.calculation_order || 1) - (b.calculation_order || 1); });
    } else if (mixedOrder === 'FIXED_THEN_PERCENTAGE') {
      list.sort(function(a, b) {
        if (a.calculation_type === 'fixed_amount' && b.calculation_type === 'percentage') return -1;
        if (a.calculation_type === 'percentage' && b.calculation_type === 'fixed_amount') return 1;
        return 0;
      });
    } else {
      // PERCENTAGE_THEN_FIXED
      list.sort(function(a, b) {
        if (a.calculation_type === 'percentage' && b.calculation_type === 'fixed_amount') return -1;
        if (a.calculation_type === 'fixed_amount' && b.calculation_type === 'percentage') return 1;
        return 0;
      });
    }
    return list;
  }

  /**
   * 彙總至 MonthlyFundingSummary
   */
  function aggregateMonthlyFunding(allocations, runId, version) {
    var groups = {};

    allocations.forEach(function(a) {
      // 取得膳食別 (回溯 Ledger 取得)
      var ledger = SheetRepository.findById('DailyMealLedger', 'ledger_id', a.daily_ledger_id);
      var dietaryType = ledger ? ledger.dietary_type : '葷食';

      var key = a.year_month + '_' + a.class_id + '_' + a.subsidy_category_id + '_' + dietaryType + '_' + a.funding_source;
      if (!groups[key]) {
        groups[key] = {
          year_month: a.year_month,
          class_id: a.class_id,
          subsidy_category_id: a.subsidy_category_id,
          dietary_type: dietaryType,
          funding_source: a.funding_source,
          meal_count: 0,
          gross_amount_minor: 0,
          calculated_amount_minor: 0,
          residual_adjustment_minor: 0,
          final_amount_minor: 0,
          calculation_total_minor: 0,
          settlement_total_minor: 0,
          settlement_residual_minor: 0
        };
      }

      var g = groups[key];
      g.meal_count++;
      g.gross_amount_minor += a.gross_amount_minor;
      g.calculated_amount_minor += a.rounded_amount_minor;
      g.residual_adjustment_minor += a.residual_adjustment_minor;
      g.final_amount_minor += a.final_amount_minor;
      g.calculation_total_minor += MoneyService.firstPresentValue(a, ['calculation_amount_minor'], 0);
      g.settlement_total_minor += MoneyService.firstPresentValue(a, ['settlement_amount_minor'], 0);
      g.settlement_residual_minor += MoneyService.firstPresentValue(a, ['settlement_residual_minor'], 0);
    });

    var result = [];
    for (var k in groups) {
      var g = groups[k];
      result.push({
        funding_summary_id: 'FSUM_' + g.year_month.replace('-', '') + '_' + Utils.md5(k).substring(0, 8),
        funding_calculation_run_id: runId,
        closing_id: '',
        year_month: g.year_month,
        class_id: g.class_id,
        subsidy_category_id: g.subsidy_category_id,
        dietary_type: g.dietary_type,
        funding_source: g.funding_source,
        meal_count: g.meal_count,
        gross_amount_minor: g.gross_amount_minor,
        calculated_amount_minor: g.calculated_amount_minor,
        residual_adjustment_minor: g.residual_adjustment_minor,
        final_amount_minor: g.final_amount_minor,
        calculation_version: version,
        source_hash: '',
        reconciliation_status: 'reconciled',
        calculated_by: AuthService.getCurrentIdentity().email,
        calculated_at: Utils.formatDateTime(new Date()),
        is_current: true,
        calculation_total_minor: g.calculation_total_minor,
        settlement_total_minor: g.settlement_total_minor,
        settlement_residual_minor: g.settlement_residual_minor
      });
    }

    return result;
  }

  function writeMonthlyFundingSummaries(summaries, yearMonth) {
    var old = SheetRepository.findRecords('MonthlyFundingSummary', function(x) {
      return x.year_month === yearMonth && x.is_current === true;
    });
    old.forEach(function(o) {
      o.is_current = false;
      SheetRepository.upsertRecord('MonthlyFundingSummary', 'funding_summary_id', o.funding_summary_id, o);
    });

    summaries.forEach(function(s) {
      SheetRepository.appendRecord('MonthlyFundingSummary', s);
    });
  }

  /**
   * 財務計算結束後，回填 MonthlyMealSummary 上的機關分攤欄位
   */
  function updateMonthlyMealSummaryAmounts(yearMonth, allocations) {
    var oldSummaries = SheetRepository.findRecords('MonthlyMealSummary', function(x) {
      return x.year_month === yearMonth && x.is_current === true;
    });

    oldSummaries.forEach(function(m) {
      // 篩選出符合此 class_id, subsidy_category_id, dietary_type 的分攤明細
      var filtered = allocations.filter(function(a) {
        // 需比對膳食別
        var ledger = SheetRepository.findById('DailyMealLedger', 'ledger_id', a.daily_ledger_id);
        var dietaryType = ledger ? ledger.dietary_type : '葷食';
        return a.class_id === m.class_id && 
               a.subsidy_category_id === m.subsidy_category_id && 
               dietaryType === m.dietary_type;
      });

      var townshipSet = MoneyService.sumMinorAmounts(filtered.filter(function(x) { return x.funding_source === 'township'; }).map(function(x) { return MoneyService.firstPresentValue(x, ['settlement_amount_minor'], 0); }));
      var countySet = MoneyService.sumMinorAmounts(filtered.filter(function(x) { return x.funding_source === 'county'; }).map(function(x) { return MoneyService.firstPresentValue(x, ['settlement_amount_minor'], 0); }));
      var schoolSet = MoneyService.sumMinorAmounts(filtered.filter(function(x) { return x.funding_source === 'school'; }).map(function(x) { return MoneyService.firstPresentValue(x, ['settlement_amount_minor'], 0); }));
      var selfPaySet = MoneyService.sumMinorAmounts(filtered.filter(function(x) { return x.funding_source === 'self_pay'; }).map(function(x) { return MoneyService.firstPresentValue(x, ['settlement_amount_minor'], 0); }));
      var otherSet = MoneyService.sumMinorAmounts(filtered.filter(function(x) { return x.funding_source === 'other'; }).map(function(x) { return MoneyService.firstPresentValue(x, ['settlement_amount_minor'], 0); }));
      
      var totalSetMinor = townshipSet + countySet + schoolSet + selfPaySet + otherSet;

      // 寫入 minor 金額 (結算單位)
      m.township_subsidy_minor = townshipSet;
      m.county_subsidy_minor = countySet;
      m.school_subsidy_minor = schoolSet;
      m.self_pay_amount_minor = selfPaySet;
      m.other_amount_minor = otherSet;
      m.total_amount_minor = totalSetMinor;

      // 寫入元顯示金額 (依結算精度格式化字串)
      m.township_subsidy = MoneyService.formatSettlementAmount(townshipSet);
      m.county_subsidy = MoneyService.formatSettlementAmount(countySet);
      m.school_subsidy = MoneyService.formatSettlementAmount(schoolSet);
      m.self_pay_amount = MoneyService.formatSettlementAmount(selfPaySet);
      m.other_amount = MoneyService.formatSettlementAmount(otherSet);
      m.total_amount = MoneyService.formatSettlementAmount(totalSetMinor);
      
      m.funding_calculation_status = 'CALCULATED';

      SheetRepository.upsertRecord('MonthlyMealSummary', 'monthly_summary_id', m.monthly_summary_id, m);
    });
  }

  /**
   * 計算特定月份補助分攤的規則與配置來源穩定雜湊值 (Source Hash)
   */
  function calculateFundingSourceHash(yearMonth) {
    var payload = {
      rules: SheetRepository.getAllRecords('SubsidyRules').map(function(x) {
        return { rule_id: x.rule_id, rate: x.subsidy_rate, amount: x.subsidy_amount, type: x.calculation_type, enabled: String(x.enabled) };
      }).sort(function(a,b) { return a.rule_id.localeCompare(b.rule_id); }),
      
      ledgers: SheetRepository.findRecords('DailyMealLedger', function(x) {
        return x.date.substring(0, 7) === yearMonth;
      }).map(function(x) {
        return { ledger_id: x.daily_ledger_id, eligible: x.eligible_meal_count, price: x.meal_price_snapshot };
      }).sort(function(a,b) { return a.ledger_id.localeCompare(b.ledger_id); }),
      
      config: SheetRepository.getAllRecords('SystemConfig').map(function(x) {
        return { key: x.config_key, value: x.config_value };
      }).sort(function(a,b) { return a.key.localeCompare(b.key); })
    };

    var jsonStr = JSON.stringify(payload);
    var rawHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, jsonStr, Utilities.Charset.UTF_8);
    var hexStr = '';
    for (var i = 0; i < rawHash.length; i++) {
      var byteVal = rawHash[i];
      if (byteVal < 0) byteVal += 256;
      var byteString = byteVal.toString(16);
      if (byteString.length == 1) byteString = '0' + byteString;
      hexStr += byteString;
    }
    return hexStr;
  }

  function getFundingCalculationResult(yearMonth) {
    return SheetRepository.findRecords('MonthlyFundingSummary', function(x) {
      return x.year_month === yearMonth && x.is_current === true;
    });
  }

  function createIssue(runId, date, classId, studentId, code, severity, msg, srcSheet, srcRecordId) {
    return {
      issue_id: 'ISSUE_F_' + new Date().getTime() + '_' + Math.floor(Math.random() * 100),
      calculation_run_id: runId,
      date: date,
      class_id: classId || '',
      student_id: studentId || '',
      issue_code: code,
      severity: severity,
      message: msg,
      source_sheet: srcSheet || '',
      source_record_id: srcRecordId || '',
      status: 'open',
      resolution_note: '',
      resolved_by: '',
      resolved_at: '',
      created_at: Utils.formatDateTime(new Date())
    };
  }

  return {
    calculateMonthlyFunding: calculateMonthlyFunding,
    calculateFundingForLedgerRow: calculateFundingForLedgerRow,
    getApplicableFundingRules: getApplicableFundingRules,
    calculateFundingSourceHash: calculateFundingSourceHash,
    getFundingCalculationResult: getFundingCalculationResult
  };
})();
