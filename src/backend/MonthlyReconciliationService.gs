/**
 * MonthlyReconciliationService.gs
 * 月度餐數對帳與預覽對帳服務 (Phase 4)
 */

var MonthlyReconciliationService = (function() {

  /**
   * 預覽指定月份對帳狀況，建立草稿/計算狀態的月結紀錄
   */
  function previewMonth(yearMonth) {
    AuthService.requireAnyRole(['system_admin', 'lunch_admin', 'accountant']);
    var identity = AuthService.getCurrentIdentity();
    var currentDateTime = Utils.formatDateTime(new Date());

    return LockService.runWithLock(function() {
      // 1. 取得完整度資訊
      var completeness = validateMonthCompleteness(yearMonth);
      
      // 2. 彙總月餐數與金額 (以 class_id, subsidy_category_id, dietary_type 彙總)
      var monthlySummaries = aggregateMonthlyMealCounts(yearMonth);

      // 3. 取得對帳狀態
      var reconStatus = 'reconciled';
      if (!completeness.isComplete) {
        reconStatus = 'incomplete';
      }
      
      // 檢查是否有未解決的 blocking issues
      var openIssues = listOpenCalculationIssues(yearMonth);
      var hasBlocking = openIssues.some(function(i) { return i.severity === 'blocking'; });
      if (hasBlocking) {
        reconStatus = 'warning';
      }

      // 檢查 Ledger 與 DailyMealSummary 加總是否一致
      var comparison = compareLedgerAndSummary(yearMonth);
      if (!comparison.isMatch) {
        reconStatus = 'warning';
      }

      var finalSummaries = [];

      // 4. 準備寫入 (僅寫入草稿或計算狀態，不執行 closed)
      monthlySummaries.forEach(function(g) {
        var record = {
          monthly_summary_id: 'MSUM_' + yearMonth.replace('-', '') + '_' + Utils.md5(g.class_id + '_' + g.subsidy_category_id + '_' + g.dietary_type).substring(0, 8),
          calculation_run_id: 'RUN_PREV_' + new Date().getTime(),
          year_month: yearMonth,
          class_id: g.class_id,
          subsidy_category_id: g.subsidy_category_id,
          dietary_type: g.dietary_type,
          meal_day_count: completeness.mealDaysCount,
          roster_meal_count: g.roster_meal_count,
          suspension_count: g.suspension_count,
          exception_count: g.exception_count,
          actual_meal_count: g.actual_meal_count,
          gross_meal_amount: g.gross_meal_amount,
          funding_calculation_status: 'NOT_CALCULATED', // 本階段保持 NOT_CALCULATED
          reconciliation_status: reconStatus,
          source_hash: '',
          calculation_version: 1,
          calculated_by: identity.email,
          calculated_at: currentDateTime,
          is_current: true,
          township_subsidy: 0,
          county_subsidy: 0,
          school_subsidy: 0,
          self_pay_amount: 0,
          total_amount: g.gross_meal_amount,
          closing_status: 'calculated', // 不得進入 closed
          closed_by: '',
          closed_at: ''
        };

        // 清除該月舊的預覽 (is_current = false)
        var old = SheetRepository.findRecords('MonthlyMealSummary', function(x) {
          return x.year_month === yearMonth && x.class_id === g.class_id && x.subsidy_category_id === g.subsidy_category_id && x.dietary_type === g.dietary_type && x.is_current === true;
        });
        old.forEach(function(o) {
          o.is_current = false;
          SheetRepository.upsertRecord('MonthlyMealSummary', 'monthly_summary_id', o.monthly_summary_id, o);
        });

        SheetRepository.appendRecord('MonthlyMealSummary', record);
        finalSummaries.push(record);
      });

      return {
        yearMonth: yearMonth,
        completeness: completeness,
        reconciliationStatus: reconStatus,
        comparison: comparison,
        openIssuesCount: openIssues.length,
        summaries: finalSummaries
      };

    }).error;
  }

  /**
   * 驗證月份點名登記完整度 (回傳供餐日、預期確認數、已確認數、未確認清單)
   */
  function validateMonthCompleteness(yearMonth) {
    var start = yearMonth + '-01';
    var lastDay = new Date(parseInt(yearMonth.substring(0, 4), 10), parseInt(yearMonth.substring(5, 7), 10), 0).getDate();
    var end = yearMonth + '-' + Utils.padZero(lastDay);

    var mealDays = SchoolDaysService.listSchoolDays().filter(function(x) {
      return x.date >= start && x.date <= end && (x.is_meal_day === true || x.is_meal_day === 'TRUE');
    });

    var activeClasses = SheetRepository.getAllRecords('Classes').filter(function(c) {
      return c.enabled === true || c.enabled === 'TRUE';
    });

    var expectedConfirmations = mealDays.length * activeClasses.length;
    var actualConfirmations = 0;
    var missingList = [];

    mealDays.forEach(function(d) {
      activeClasses.forEach(function(c) {
        var conf = SheetRepository.findRecords('DailyClassConfirmations', function(x) {
          return x.date === d.date && x.class_id === c.class_id;
        })[0];
        
        if (conf && (conf.confirm_status === 'confirmed' || conf.confirm_status === 'locked')) {
          actualConfirmations++;
        } else {
          missingList.push({
            date: d.date,
            class_id: c.class_id,
            class_name: c.class_name,
            teacher_name: c.teacher_name,
            status: conf ? conf.confirm_status : 'not_started'
          });
        }
      });
    });

    return {
      mealDaysCount: mealDays.length,
      expectedCount: expectedConfirmations,
      actualCount: actualConfirmations,
      isComplete: actualConfirmations === expectedConfirmations,
      missingConfirmations: missingList
    };
  }

  /**
   * 彙總指定月餐數 (從 DailyMealSummary 彙總)
   */
  function aggregateMonthlyMealCounts(yearMonth) {
    var start = yearMonth + '-01';
    var lastDay = new Date(parseInt(yearMonth.substring(0, 4), 10), parseInt(yearMonth.substring(5, 7), 10), 0).getDate();
    var end = yearMonth + '-' + Utils.padZero(lastDay);

    var dailySummaries = SheetRepository.findRecords('DailyMealSummary', function(x) {
      return x.date >= start && x.date <= end && x.is_current === true;
    });

    var groups = {};
    dailySummaries.forEach(function(d) {
      var key = d.class_id + '_' + d.subsidy_category_id + '_' + d.dietary_type;
      if (!groups[key]) {
        groups[key] = {
          class_id: d.class_id,
          subsidy_category_id: d.subsidy_category_id,
          dietary_type: d.dietary_type,
          roster_meal_count: 0,
          suspension_count: 0,
          exception_count: 0,
          actual_meal_count: 0,
          gross_meal_amount: 0
        };
      }

      var g = groups[key];
      g.roster_meal_count += (parseInt(d.roster_count, 10) || 0);
      g.suspension_count += (parseInt(d.suspension_count, 10) || 0);
      g.exception_count += (parseInt(d.exception_count, 10) || 0);
      g.actual_meal_count += (parseInt(d.actual_meal_count, 10) || 0);
      g.gross_meal_amount += (parseFloat(d.gross_meal_amount) || 0);
    });

    var result = [];
    for (var k in groups) {
      result.push(groups[k]);
    }
    return result;
  }

  /**
   * 對照該月 Ledger 與 DailyMealSummary 是否加總一致
   */
  function compareLedgerAndSummary(yearMonth) {
    var start = yearMonth + '-01';
    var lastDay = new Date(parseInt(yearMonth.substring(0, 4), 10), parseInt(yearMonth.substring(5, 7), 10), 0).getDate();
    var end = yearMonth + '-' + Utils.padZero(lastDay);

    var ledgers = SheetRepository.findRecords('DailyMealLedger', function(x) {
      return x.date >= start && x.date <= end && x.calculation_status !== 'failed';
    });

    var dailySummaries = SheetRepository.findRecords('DailyMealSummary', function(x) {
      return x.date >= start && x.date <= end && x.is_current === true;
    });

    var ledgerTotal = 0;
    ledgers.forEach(function(l) {
      ledgerTotal += (parseInt(l.eligible_meal_count, 10) || 0);
    });

    var summaryTotal = 0;
    dailySummaries.forEach(function(d) {
      summaryTotal += (parseInt(d.actual_meal_count, 10) || 0);
    });

    return {
      ledgerTotal: ledgerTotal,
      summaryTotal: summaryTotal,
      isMatch: ledgerTotal === summaryTotal
    };
  }

  /**
   * 搜尋該月未解決的 calculation issues
   */
  function listOpenCalculationIssues(yearMonth) {
    var start = yearMonth + '-01';
    var lastDay = new Date(parseInt(yearMonth.substring(0, 4), 10), parseInt(yearMonth.substring(5, 7), 10), 0).getDate();
    var end = yearMonth + '-' + Utils.padZero(lastDay);

    return SheetRepository.findRecords('CalculationIssues', function(x) {
      return x.date >= start && x.date <= end && x.status === 'open';
    });
  }

  function generateReconciliationChecksum(yearMonth) {
    var comp = compareLedgerAndSummary(yearMonth);
    return Utils.md5(yearMonth + '_' + comp.ledgerTotal + '_' + comp.summaryTotal);
  }

  return {
    previewMonth: previewMonth,
    validateMonthCompleteness: validateMonthCompleteness,
    aggregateMonthlyMealCounts: aggregateMonthlyMealCounts,
    compareLedgerAndSummary: compareLedgerAndSummary,
    listOpenCalculationIssues: listOpenCalculationIssues,
    generateReconciliationChecksum: generateReconciliationChecksum
  };
})();
