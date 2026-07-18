/**
 * TriggerService.gs
 * 自動化定時排程運算服務 (Phase 4)
 */

var TriggerService = (function() {

  /**
   * 安裝每日定時統計排程
   */
  function installDailyCalculationTrigger() {
    AuthService.requireRole('system_admin');
    
    // 取得設定的觸發時間 (時)
    var triggerHourStr = Config.get('DAILY_CALCULATION_TRIGGER_HOUR') || '10';
    var triggerHour = parseInt(triggerHourStr, 10);
    if (isNaN(triggerHour) || triggerHour < 0 || triggerHour > 23) {
      triggerHour = 10;
    }

    // 防止重複安裝同名 Trigger
    var existing = getActiveTrigger();
    if (existing) {
      throw new Error('🛑 排程 Trigger 已經安裝，請勿重複建立。當前設定執行時間為每日 ' + triggerHour + ':00 前後。');
    }

    // 建立每日排程 Trigger (因 Apps Script 限制，時間範圍為指定的 Hour 區間內)
    var trigger = ScriptApp.newTrigger('runScheduledDailyCalculation')
      .timeBased()
      .everyDays(1)
      .atHour(triggerHour)
      .create();

    AuditService.log({
      action: 'INSTALL_TRIGGER',
      module: 'trigger',
      reason: '成功安裝每日餐數統計定時排程，設定時間為每日 ' + triggerHour + ':00 區間。'
    });

    return {
      triggerId: trigger.getUniqueId(),
      hour: triggerHour
    };
  }

  /**
   * 移除定時排程
   */
  function removeDailyCalculationTrigger() {
    AuthService.requireRole('system_admin');
    var triggers = ScriptApp.getProjectTriggers();
    var count = 0;

    triggers.forEach(function(t) {
      if (t.getHandlerFunction() === 'runScheduledDailyCalculation') {
        ScriptApp.deleteTrigger(t);
        count++;
      }
    });

    AuditService.log({
      action: 'REMOVE_TRIGGER',
      module: 'trigger',
      reason: '已成功移除所有每日定時統計排程，共清除 ' + count + ' 個 Trigger。'
    });

    return { success: true, removedCount: count };
  }

  /**
   * 列出目前專案中 active 的排程資訊
   */
  function listProjectTriggers() {
    var triggers = ScriptApp.getProjectTriggers();
    var list = [];
    triggers.forEach(function(t) {
      list.push({
        id: t.getUniqueId(),
        handler: t.getHandlerFunction(),
        source: String(t.getTriggerSource())
      });
    });
    return list;
  }

  function getActiveTrigger() {
    var triggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === 'runScheduledDailyCalculation') {
        return triggers[i];
      }
    }
    return null;
  }

  /**
   * 定時排程主入口點 (Script 觸發)
   */
  function runScheduledDailyCalculation() {
    var todayStr = Utils.formatDate(new Date());
    Logger.log('⏰ 啟動排程定時統計任務，目標日期：' + todayStr);

    // 檢查今天是否為供餐日，非供餐日則不需進行排程計算
    if (!SchoolDaysService.isMealDay(todayStr)) {
      Logger.log('今日非供餐日，排程跳過。');
      return;
    }

    try {
      var res = DailyMealCalculationService.calculateDate(todayStr);
      Logger.log('排程計算完成：' + JSON.stringify(res));
    } catch(e) {
      Logger.log('🛑 排程計算發生阻斷性異常，錯誤：' + e.message);
    }
  }

  return {
    installDailyCalculationTrigger: installDailyCalculationTrigger,
    removeDailyCalculationTrigger: removeDailyCalculationTrigger,
    listProjectTriggers: listProjectTriggers,
    runScheduledDailyCalculation: runScheduledDailyCalculation
  };
})();

/**
 * 給 Apps Script 定時 Trigger 呼叫的全局 Function
 */
function runScheduledDailyCalculation() {
  TriggerService.runScheduledDailyCalculation();
}
