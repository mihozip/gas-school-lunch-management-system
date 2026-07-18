/**
 * AuditService.gs
 * 稽核日誌記錄服務
 */

var AuditService = (function() {

  /**
   * 遮蔽敏感個資 (如身分證字號或特定個資)
   * @param {object} data 原始資料物件
   * @return {object} 遮蔽後的資料物件
   */
  function sanitizePayload(data) {
    if (!data) return null;
    var sanitized = JSON.parse(JSON.stringify(data)); // 深拷貝
    
    // 檢查是否有身分證欄位 (此系統目前無此欄位，但預留防護)
    var sensitiveKeys = ['id_number', 'national_id', 'password', 'token', 'oauth_token', 'session_token'];
    
    Object.keys(sanitized).forEach(function(key) {
      if (sensitiveKeys.indexOf(key.toLowerCase()) !== -1) {
        sanitized[key] = '***MASKED***';
      }
      
      // 遮蔽部分身分證字號格式的欄位 (正規表示式檢查)
      if (typeof sanitized[key] === 'string' && /^[A-Z][12]\d{8}$/.test(sanitized[key])) {
        sanitized[key] = sanitized[key].substring(0, 3) + '*****' + sanitized[key].substring(8);
      }
    });

    return sanitized;
  }

  /**
   * 寫入一筆稽核日誌
   * @param {object} params { action, module, recordId, beforeData, afterData, reason }
   */
  function log({ action, module, recordId, beforeData, afterData, reason }) {
    try {
      var identity = AuthService.getCurrentIdentity();
      var userEmail = identity.email || 'system_fallback';
      var currentDateTime = Utils.formatDateTime(new Date());
      var logId = Utils.generateUUID();

      var beforeStr = beforeData ? JSON.stringify(sanitizePayload(beforeData)) : '';
      var afterStr = afterData ? JSON.stringify(sanitizePayload(afterData)) : '';

      // 防公式注入 (Sanitize inputs)
      var logRecord = {
        log_id: logId,
        timestamp: currentDateTime,
        user_email: userEmail,
        action: action,
        module: module,
        record_id: recordId || '',
        before_data: beforeStr,
        after_data: afterStr,
        reason: reason || '',
        ip_or_session: '', // 預留 Session 資訊
        calculation_version: '' // 預留計算版本
      };

      SheetRepository.appendRecord('AuditLogs', logRecord);
    } catch (e) {
      // 避免寫入稽核日誌失敗導致整個業務流程崩潰，但要在 Logger 留下記錄
      Logger.log('[AuditLogs 錯誤] 寫入日誌失敗: ' + e.message);
    }
  }

  return {
    log: log,
    sanitizePayload: sanitizePayload
  };
})();
