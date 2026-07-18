/**
 * SubsidyRuleService.gs
 * 補助規則與比例轉換服務 (Phase 4.5 & 5)
 */

var SubsidyRuleService = (function() {

  /**
   * 驗證費率 Basis Points 是否合規 (0 至 10000 之間整數)
   */
  function validateRateBasisPoints(rateBps) {
    var value = Number(rateBps);
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0 || value > 10000) {
      var err = new Error('🛑 財務錯誤：費率 BPS 必須介於 0 至 10000 之間的整數。實際值: ' + rateBps);
      err.code = 'FUNDING_RATE_INVALID';
      throw err;
    }
  }



  function createSubsidyRule(ruleData) {
    AuthService.requireRole('system_admin');
    PeriodLockService.assertRuleWritable(ruleData.effective_start_date, ruleData.effective_end_date);
    
    if (ruleData.calculation_type === 'percentage') {
      validateRateBasisPoints(ruleData.subsidy_rate);
    }
    
    var ruleId = ruleData.rule_id || 'RULE_' + new Date().getTime();
    var record = {
      rule_id: ruleId,
      subsidy_category_id: ruleData.subsidy_category_id,
      funding_source: ruleData.funding_source,
      subsidy_rate: Number(ruleData.subsidy_rate) || 0,
      subsidy_amount: parseFloat(ruleData.subsidy_amount) || 0,
      calculation_type: ruleData.calculation_type,
      effective_start_date: ruleData.effective_start_date,
      effective_end_date: ruleData.effective_end_date,
      enabled: ruleData.enabled !== false,
      note: ruleData.note || ''
    };
    
    SheetRepository.appendRecord('SubsidyRules', record);
    return record;
  }

  /**
   * 更新補助規則
   */
  function updateSubsidyRule(ruleId, ruleData) {
    AuthService.requireRole('system_admin');
    var old = SheetRepository.findById('SubsidyRules', 'rule_id', ruleId);
    if (!old) throw new Error('找不到該補助規則：' + ruleId);

    // 檢查舊區間與新區間是否安全
    PeriodLockService.assertRuleWritable(old.effective_start_date, old.effective_end_date);
    PeriodLockService.assertRuleWritable(ruleData.effective_start_date, ruleData.effective_end_date);

    if (ruleData.calculation_type === 'percentage') {
      validateRateBasisPoints(ruleData.subsidy_rate);
    }

    old.subsidy_category_id = ruleData.subsidy_category_id;
    old.funding_source = ruleData.funding_source;
    old.subsidy_rate = Number(ruleData.subsidy_rate) || 0;
    old.subsidy_amount = parseFloat(ruleData.subsidy_amount) || 0;
    old.calculation_type = ruleData.calculation_type;
    old.effective_start_date = ruleData.effective_start_date;
    old.effective_end_date = ruleData.effective_end_date;
    old.enabled = ruleData.enabled !== false;
    old.note = ruleData.note || '';

    SheetRepository.upsertRecord('SubsidyRules', 'rule_id', ruleId, old);
    return old;
  }

  /**
   * 停用或刪除補助規則
   */
  function deleteSubsidyRule(ruleId) {
    AuthService.requireRole('system_admin');
    var old = SheetRepository.findById('SubsidyRules', 'rule_id', ruleId);
    if (!old) throw new Error('找不到該補助規則：' + ruleId);

    PeriodLockService.assertRuleWritable(old.effective_start_date, old.effective_end_date);
    
    // 軟刪除 (停用)
    old.enabled = false;
    SheetRepository.upsertRecord('SubsidyRules', 'rule_id', ruleId, old);
    return old;
  }

  function getLegacyFormatSetting() {
    return Config.get('SUBSIDY_RATE_LEGACY_FORMAT') || 'UNKNOWN';
  }

  function convertRawRateToBps(rawVal, format) {
    var str = String(rawVal).trim();
    if (format === 'UNKNOWN') {
      throw new Error('未設定舊版費率格式 (UNKNOWN)，拒絕遷移。');
    }
    
    var cleanStr = str.replace(/%/g, '').trim();
    var num = parseFloat(cleanStr);
    if (isNaN(num)) {
      throw new Error('數值無法解析為數字: ' + rawVal);
    }
    
    var bps = 0;
    if (format === 'DECIMAL_0_TO_1') {
      bps = Math.round(num * 10000);
    } else if (format === 'PERCENT_0_TO_100') {
      bps = Math.round(num * 100);
    } else if (format === 'BASIS_POINTS') {
      bps = Math.round(num);
    } else if (format === 'EXPLICIT_PER_ROW') {
      if (str.indexOf('%') !== -1) {
        bps = Math.round(num * 100);
      } else if (num > 1.0) {
        bps = Math.round(num * 100);
      } else {
        bps = Math.round(num * 10000);
      }
    }
    
    if (bps < 0 || bps > 10000) {
      throw new Error('計算出費率 BPS 超出範圍 (0-10000): ' + bps);
    }
    
    return bps;
  }

  function previewSubsidyRateMigration() {
    var format = getLegacyFormatSetting();
    var rules = SheetRepository.all('SubsidyRules');
    
    var list = [];
    rules.forEach(function(r) {
      if (r.calculation_type !== 'percentage') return;
      
      var rawRate = r.subsidy_rate;
      var predictedBps = 0;
      var isValid = true;
      var warning = '';
      var error = '';
      
      try {
        predictedBps = convertRawRateToBps(rawRate, format);
        if (predictedBps === 0) {
          warning = '預估 Basis Points 為 0，請確認是否正確。';
        }
      } catch (e) {
        isValid = false;
        error = e.message;
      }
      
      list.push({
        rule_id: r.rule_id,
        raw_rate: rawRate,
        legacy_format: format,
        predicted_bps: predictedBps,
        is_valid: isValid,
        warning: warning,
        error: error
      });
    });
    
    return list;
  }

  function validateSubsidyRateMigration() {
    var previews = previewSubsidyRateMigration();
    var invalidCount = previews.filter(function(x) { return !x.is_valid; }).length;
    return {
      valid: invalidCount === 0 && previews.length > 0,
      totalCount: previews.length,
      invalidCount: invalidCount,
      previews: previews
    };
  }

  function executeSubsidyRateMigration(confirmText) {
    AuthService.requireRole('system_admin');
    if (confirmText !== 'CONFIRM RATE MIGRATION') {
      throw new Error('請輸入確認文字：CONFIRM RATE MIGRATION');
    }
    
    var validation = validateSubsidyRateMigration();
    if (!validation.valid) {
      throw new Error('遷移驗證失敗，存在無效資料，無法執行遷移。');
    }
    
    var format = getLegacyFormatSetting();
    var beforeData = [];
    var afterData = [];
    
    var migrationId = 'MIG_' + new Date().getTime();
    var rules = SheetRepository.all('SubsidyRules');
    
    rules.forEach(function(r) {
      if (r.calculation_type !== 'percentage') return;
      
      beforeData.push(JSON.parse(JSON.stringify(r)));
      
      var bps = convertRawRateToBps(r.subsidy_rate, format);
      r.subsidy_rate = bps;
      
      afterData.push(JSON.parse(JSON.stringify(r)));
      SheetRepository.upsertRecord('SubsidyRules', 'rule_id', r.rule_id, r);
    });
    
    var metadata = {
      migration_id: migrationId,
      before_data: JSON.stringify(beforeData),
      after_data: JSON.stringify(afterData),
      executed_by: AuthService.getCurrentIdentity().email,
      executed_at: Utils.formatDateTime(new Date()),
      rollback_status: 'active'
    };
    
    PropertiesService.getScriptProperties().setProperty('LUNCH_MIG_' + migrationId, JSON.stringify(metadata));
    
    var ssId = Config.getSpreadsheetId();
    var configSheet = SpreadsheetApp.openById(ssId).getSheetByName('SystemConfig');
    configSheet.appendRow(['RATE_STORAGE_FORMAT', 'BASIS_POINTS', '費率保存格式', metadata.executed_at, metadata.executed_by]);
    configSheet.appendRow(['SUBSIDY_RATE_MIGRATED_AT', metadata.executed_at, '費率遷移時間', metadata.executed_at, metadata.executed_by]);
    configSheet.appendRow(['SUBSIDY_RATE_MIGRATED_BY', metadata.executed_by, '費率遷移執行人', metadata.executed_at, metadata.executed_by]);
    configSheet.appendRow(['SUBSIDY_RATE_MIGRATION_ID', migrationId, '費率遷移批次 ID', metadata.executed_at, metadata.executed_by]);
    
    AuditService.log({
      action: 'EXECUTE_SUBSIDY_RATE_MIGRATION',
      module: 'rules',
      recordId: migrationId,
      beforeData: beforeData,
      afterData: afterData,
      reason: '執行補助費率 Basis Points 統一遷移，批次 ID：' + migrationId
    });
    
    Config.clearAllCache();
    return {
      success: true,
      migrationId: migrationId,
      migratedCount: beforeData.length
    };
  }

  function rollbackSubsidyRateMigration(migrationId) {
    AuthService.requireRole('system_admin');
    var rawMetadata = PropertiesService.getScriptProperties().getProperty('LUNCH_MIG_' + migrationId);
    if (!rawMetadata) {
      throw new Error('找不到指定的遷移紀錄：' + migrationId);
    }
    
    var metadata = JSON.parse(rawMetadata);
    if (metadata.rollback_status === 'rolled_back') {
      throw new Error('該遷移紀錄已被回滾過：' + migrationId);
    }
    
    var beforeData = JSON.parse(metadata.before_data);
    beforeData.forEach(function(r) {
      SheetRepository.upsertRecord('SubsidyRules', 'rule_id', r.rule_id, r);
    });
    
    metadata.rollback_status = 'rolled_back';
    metadata.rolled_back_at = Utils.formatDateTime(new Date());
    metadata.rolled_back_by = AuthService.getCurrentIdentity().email;
    PropertiesService.getScriptProperties().setProperty('LUNCH_MIG_' + migrationId, JSON.stringify(metadata));
    
    AuditService.log({
      action: 'ROLLBACK_SUBSIDY_RATE_MIGRATION',
      module: 'rules',
      recordId: migrationId,
      afterData: beforeData,
      reason: '回滾補助費率 Basis Points 遷移，批次 ID：' + migrationId
    });
    
    Config.clearAllCache();
    return {
      success: true,
      migrationId: migrationId,
      restoredCount: beforeData.length
    };
  }

  function exportSubsidyRateMigrationReport(migrationId) {
    var rawMetadata = PropertiesService.getScriptProperties().getProperty('LUNCH_MIG_' + migrationId);
    if (!rawMetadata) {
      throw new Error('找不到指定的遷移紀錄：' + migrationId);
    }
    return JSON.parse(rawMetadata);
  }

  return {
    validateRateBasisPoints: validateRateBasisPoints,
    createSubsidyRule: createSubsidyRule,
    updateSubsidyRule: updateSubsidyRule,
    deleteSubsidyRule: deleteSubsidyRule,
    previewSubsidyRateMigration: previewSubsidyRateMigration,
    validateSubsidyRateMigration: validateSubsidyRateMigration,
    executeSubsidyRateMigration: executeSubsidyRateMigration,
    rollbackSubsidyRateMigration: rollbackSubsidyRateMigration,
    exportSubsidyRateMigrationReport: exportSubsidyRateMigrationReport
  };
})();
