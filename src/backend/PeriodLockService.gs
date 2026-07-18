/**
 * PeriodLockService.gs
 * 歷史期間防篡改鎖定服務 (Phase 5)
 */

var PeriodLockService = (function() {

  /**
   * 檢查特定日期是否處於已月結鎖定 (closed) 的區間中
   * @param {string} dateStr YYYY-MM-DD
   * @return {boolean} 是否被鎖定
   */
  function isPeriodClosed(dateStr) {
    if (!dateStr) return false;
    var yearMonth = dateStr.substring(0, 7);
    
    try {
      var record = SheetRepository.findRecords('MonthClosings', function(x) {
        return x.year_month === yearMonth && x.status === 'closed' && x.is_current === true;
      })[0];
      return !!record;
    } catch(e) {
      // 容忍表未建立或為空
      return false;
    }
  }

  /**
   * 驗證特定日期是否可寫入，若已鎖定則拋出 PERIOD_CLOSED 異常
   */
  function assertDateWritable(dateStr) {
    if (isPeriodClosed(dateStr)) {
      var err = new Error('🛑 安全防護阻擋：日期 ' + dateStr + ' 所屬的月份已執行月結歸檔 (closed)，鎖定期間禁止任何資料異動寫入！');
      err.code = 'PERIOD_CLOSED';
      throw err;
    }
  }

  /**
   * 驗證特定日期範圍內是否可寫入
   */
  function assertRangeWritable(startDate, endDate) {
    if (!startDate) return;
    
    var start = new Date(startDate);
    // 若結束日期未填，預估限制 9999-12-31，此時需至少驗證開始日期
    var end = endDate ? new Date(endDate) : new Date(startDate);

    var current = new Date(start.getTime());
    while (current <= end) {
      var dateStr = Utils.formatDate(current);
      assertDateWritable(dateStr);
      
      // 按月累加，提升效率 (無須天天校驗，只需確認月份不重疊即可)
      current.setMonth(current.getMonth() + 1);
      current.setDate(1);
    }
  }

  /**
   * 驗證規則時間範圍是否可寫入 (若與任何已 closed 月份重疊，則阻斷)
   */
  function assertRuleWritable(startDate, endDate) {
    if (!startDate) return;
    
    var closedMonths = [];
    try {
      closedMonths = SheetRepository.findRecords('MonthClosings', function(x) {
        return x.status === 'closed' && x.is_current === true;
      });
    } catch(e) {
      return; // 容忍表未建立
    }

    if (closedMonths.length === 0) return;

    var ruleStart = startDate;
    var ruleEnd = endDate || '9999-12-31';

    closedMonths.forEach(function(m) {
      var ym = m.year_month;
      var monthStart = ym + '-01';
      var parts = ym.split('-');
      var y = parseInt(parts[0], 10);
      var mon = parseInt(parts[1], 10);
      var lastDay = new Date(y, mon, 0).getDate();
      var monthEnd = ym + '-' + Utils.padZero(lastDay);

      if (ruleStart <= monthEnd && ruleEnd >= monthStart) {
        var err = new Error('🛑 安全防護阻擋：此規則的生效時間 ' + ruleStart + ' ~ ' + ruleEnd + ' 與已關帳月結的月份 ' + ym + ' 重疊，禁止異動！');
        err.code = 'PERIOD_CLOSED';
        throw err;
      }
    });
  }

  return {
    isPeriodClosed: isPeriodClosed,
    assertDateWritable: assertDateWritable,
    assertRangeWritable: assertRangeWritable,
    assertRuleWritable: assertRuleWritable,
    assertRecordWritable: function(dateStr) { assertDateWritable(dateStr); }
  };
})();
