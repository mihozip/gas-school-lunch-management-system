/**
 * LockService.gs
 * 提供執行緒安全鎖，避免並行寫入衝突
 */

var LockServiceHelper = (function() {
  var LOCK_TIMEOUT_MS = 10000; // 10秒鎖定超時

  /**
   * 使用並行鎖執行指定的函數
   * @param {function} fn 要執行的函數
   * @return {any} 函數執行結果
   */
  function runWithLock(fn) {
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(LOCK_TIMEOUT_MS);
    } catch (e) {
      throw new Error('系統並行處理繁忙，請稍後再試 (Lock timeout)');
    }

    try {
      var result = fn();
      SpreadsheetApp.flush(); // 強制同步寫入試算表
      return result;
    } finally {
      lock.releaseLock();
    }
  }

  return {
    runWithLock: runWithLock
  };
})();
