/**
 * SetupService.gs
 * 系統初始化與狀態檢查服務
 */

var SetupService = (function() {
  var CURRENT_SCHEMA_VERSION = '5.0';
  
  var DATABASE_SCHEMAS = {
    'SystemConfig': ['config_key', 'config_value', 'description', 'updated_at', 'updated_by'],
    'Users': ['user_id', 'email', 'name', 'role', 'class_id', 'enabled', 'created_at', 'updated_at'],
    'Classes': ['class_id', 'school_year', 'grade', 'class_name', 'class_code', 'class_type', 'teacher_name', 'teacher_email', 'display_order', 'enabled', 'created_at', 'created_by', 'updated_at', 'updated_by'],
    'Students': ['student_id', 'student_number', 'school_year', 'class_id', 'seat_number', 'student_name', 'subsidy_category_id', 'dietary_type', 'meal_status', 'start_date', 'end_date', 'enabled', 'note', 'created_at', 'created_by', 'updated_at', 'updated_by'],
    'StudentClassHistory': ['history_id', 'student_id', 'class_id', 'effective_start_date', 'effective_end_date', 'change_reason', 'enabled', 'created_by', 'created_at', 'updated_by', 'updated_at'],
    'StudentSubsidyHistory': ['history_id', 'student_id', 'subsidy_category_id', 'effective_start_date', 'effective_end_date', 'change_reason', 'source_document_no', 'enabled', 'created_by', 'created_at', 'updated_by', 'updated_at'],
    'SubsidyCategories': ['subsidy_category_id', 'category_name', 'description', 'general_student_flag', 'enabled', 'display_order'],
    'SubsidyRules': ['rule_id', 'subsidy_category_id', 'funding_source', 'subsidy_rate', 'subsidy_amount', 'calculation_type', 'effective_start_date', 'effective_end_date', 'enabled', 'note'],
    'SchoolDays': ['date', 'school_year', 'semester', 'is_meal_day', 'meal_price', 'day_type', 'description', 'locked', 'updated_at', 'created_by', 'created_at', 'updated_by', 'lock_reason'],
    'MealExceptions': ['exception_id', 'date', 'student_id', 'class_id', 'exception_type', 'reason', 'meal_count', 'status', 'created_by', 'created_at', 'updated_by', 'updated_at', 'source_type', 'source_record_id', 'confirmation_id', 'enabled', 'deleted_by', 'deleted_at', 'deletion_reason'],
    'MealSuspensionPeriods': ['suspension_id', 'student_id', 'suspension_type', 'effective_start_date', 'effective_end_date', 'reason', 'source_document_no', 'approval_status', 'enabled', 'created_by', 'created_at', 'updated_by', 'updated_at', 'cancelled_by', 'cancelled_at', 'cancellation_reason'],
    'DailyClassConfirmations': ['confirmation_id', 'date', 'class_id', 'expected_student_count', 'exception_count', 'actual_meal_count', 'confirm_status', 'confirmed_by', 'confirmed_at', 'reopened_by', 'reopened_at', 'reopen_reason'],
    'DailyConfirmationHistory': ['history_id', 'confirmation_id', 'action', 'before_status', 'after_status', 'reason', 'acted_by', 'acted_at'],
    'DailyMealSummary': ['summary_id', 'calculation_run_id', 'calculation_version', 'date', 'class_id', 'subsidy_category_id', 'dietary_type', 'roster_count', 'inactive_count', 'suspension_count', 'exception_count', 'actual_meal_count', 'meal_price', 'gross_meal_amount', 'confirmation_status', 'source_hash', 'calculation_status', 'calculated_at', 'calculated_by', 'is_current', 'township_amount', 'county_amount', 'school_amount', 'self_pay_amount', 'funding_calculation_status'],
    'MonthlyMealSummary': ['monthly_summary_id', 'calculation_run_id', 'year_month', 'class_id', 'subsidy_category_id', 'dietary_type', 'meal_day_count', 'roster_meal_count', 'suspension_count', 'exception_count', 'actual_meal_count', 'gross_meal_amount', 'funding_calculation_status', 'reconciliation_status', 'source_hash', 'calculation_version', 'calculated_by', 'calculated_at', 'is_current', 'township_subsidy', 'county_subsidy', 'school_subsidy', 'self_pay_amount', 'total_amount', 'closing_status', 'closed_by', 'closed_at', 'township_subsidy_minor', 'county_subsidy_minor', 'school_subsidy_minor', 'self_pay_amount_minor', 'other_amount_minor', 'total_amount_minor'],
    'Reports': ['report_id', 'year_month', 'report_type', 'report_name', 'file_id', 'file_url', 'generated_by', 'generated_at', 'calculation_version', 'archived'],
    'ImportBatches': ['import_batch_id', 'import_type', 'original_filename', 'total_rows', 'create_count', 'update_count', 'skip_count', 'error_count', 'status', 'started_by', 'started_at', 'completed_at', 'failed_at', 'error_message', 'rollback_status', 'payload_hash'],
    'ImportBatchItems': ['import_batch_item_id', 'import_batch_id', 'source_row_number', 'student_id', 'action_type', 'target_sheet', 'target_record_id', 'before_data', 'after_data', 'operation_status', 'committed_at', 'rolled_back_at', 'rollback_status', 'error_message', 'created_at'],
    'DailyMealLedger': ['ledger_id', 'calculation_run_id', 'calculation_version', 'date', 'student_id', 'student_number_snapshot', 'student_name_masked', 'class_id', 'class_code_snapshot', 'subsidy_category_id', 'subsidy_category_snapshot', 'dietary_type', 'meal_day_flag', 'student_active_flag', 'class_history_valid_flag', 'subsidy_history_valid_flag', 'suspension_flag', 'suspension_id', 'manual_exception_flag', 'exception_id', 'exclusion_type', 'exclusion_reason', 'eligible_meal_count', 'meal_price_snapshot', 'gross_meal_amount', 'source_hash', 'calculation_status', 'created_at'],
    'CalculationRuns': ['calculation_run_id', 'calculation_type', 'scope_start_date', 'scope_end_date', 'target_month', 'calculation_version', 'status', 'source_hash', 'source_record_count', 'ledger_count', 'summary_count', 'issue_count', 'started_by', 'started_at', 'completed_at', 'failed_at', 'error_code', 'error_message', 'previous_run_id', 'superseded_by_run_id', 'is_current', 'note'],
    'CalculationIssues': ['issue_id', 'calculation_run_id', 'date', 'class_id', 'student_id', 'issue_code', 'severity', 'message', 'source_sheet', 'source_record_id', 'status', 'resolution_note', 'resolved_by', 'resolved_at', 'created_at'],
    'FundingAllocationLedger': ['allocation_id', 'funding_calculation_run_id', 'meal_calculation_run_id', 'closing_id', 'calculation_version', 'year_month', 'date', 'student_id', 'class_id', 'subsidy_category_id', 'daily_ledger_id', 'funding_source', 'subsidy_rule_id', 'calculation_type', 'calculation_order', 'gross_amount_minor', 'rate_basis_points', 'fixed_amount_minor', 'raw_amount_numerator', 'raw_amount_denominator', 'amount_before_rounding', 'rounded_amount_minor', 'residual_adjustment_minor', 'final_amount_minor', 'rule_snapshot_json', 'source_hash', 'calculation_status', 'created_at', 'calculation_amount_minor', 'settlement_amount_minor', 'settlement_residual_minor'],
    'MonthlyFundingSummary': ['funding_summary_id', 'funding_calculation_run_id', 'closing_id', 'year_month', 'class_id', 'subsidy_category_id', 'dietary_type', 'funding_source', 'meal_count', 'gross_amount_minor', 'calculated_amount_minor', 'residual_adjustment_minor', 'final_amount_minor', 'calculation_version', 'source_hash', 'reconciliation_status', 'calculated_by', 'calculated_at', 'is_current', 'calculation_total_minor', 'settlement_total_minor', 'settlement_residual_minor'],
    'MonthClosings': ['closing_id', 'year_month', 'closing_version', 'status', 'meal_reconciliation_run_id', 'funding_calculation_run_id', 'meal_source_hash', 'funding_source_hash', 'meal_count_total', 'gross_amount_minor', 'allocated_amount_minor', 'residual_amount_minor', 'open_issue_count', 'warning_count', 'blocking_issue_count', 'prepared_by', 'prepared_at', 'validated_by', 'validated_at', 'closed_by', 'closed_at', 'reopened_by', 'reopened_at', 'reopen_reason', 'supersedes_closing_id', 'superseded_by_closing_id', 'is_current', 'closing_manifest_file_id', 'note', 'artifact_status'],
    'ClosingArtifacts': ['artifact_id', 'closing_id', 'year_month', 'artifact_type', 'file_name', 'file_id', 'file_url', 'mime_type', 'sha256_hash', 'file_size', 'calculation_version', 'generated_by', 'generated_at', 'archived', 'note'],
    'ReportTemplates': ['template_id', 'report_type', 'template_name', 'template_version', 'template_format', 'template_file_id', 'template_file_url', 'mapping_json', 'page_settings_json', 'effective_start_date', 'effective_end_date', 'enabled', 'status', 'created_by', 'created_at', 'approved_by', 'approved_at', 'supersedes_template_id', 'note', 'privacy_level'],
    'ReportGenerationRuns': ['report_run_id', 'closing_id', 'closing_version', 'year_month', 'report_type', 'template_id', 'template_version', 'status', 'data_source_hash', 'report_hash', 'output_file_id', 'output_file_url', 'output_mime_type', 'page_count', 'file_size', 'started_by', 'started_at', 'completed_at', 'failed_at', 'error_code', 'error_message', 'retry_of_run_id', 'is_current'],
    'ApprovalRecords': ['approval_id', 'closing_id', 'report_run_id', 'approval_stage', 'approver_role', 'approver_email', 'approver_name', 'decision', 'comment', 'acted_at', 'source_hash', 'created_at'],
    'AuditLogs': ['log_id', 'timestamp', 'user_email', 'action', 'module', 'record_id', 'before_data', 'after_data', 'reason', 'ip_or_session', 'calculation_version']
  };

  /**
   * 取得系統狀態與完整度資訊
   * @return {object} 狀態資訊
   */
  function getSystemStatus() {
    var identity = AuthService.getCurrentIdentity();
    var diagnostic = AuthService.getAuthorizationDiagnostic();
    
    var status = {
      isInitialized: false,
      schemaVersion: {
        current: CURRENT_SCHEMA_VERSION,
        installed: 'N/A'
      },
      sheetsCount: { expected: 29, current: 0 },
      sheetsStatus: {},
      requiredConfigComplete: false,
      timezoneCheck: {
        scriptTimeZone: diagnostic.scriptTimeZone,
        spreadsheetTimeZone: diagnostic.spreadsheetTimeZone,
        matches: diagnostic.scriptTimeZone === 'Asia/Taipei' && diagnostic.spreadsheetTimeZone === 'Asia/Taipei'
      },
      folderStatus: {
        readable: diagnostic.reportFolderReadable,
        writable: diagnostic.reportFolderWritable
      },
      currentUserRole: identity.role || 'GUEST',
      warnings: [],
      blockingIssues: [],
      statusLevel: 'healthy' // healthy, warning, blocking
    };

    // 檢查登入 Email
    if (!identity.email) {
      status.blockingIssues.push('無法取得使用者 Email，這可能是由於存取權限受限或未完成 Google 授權。');
      status.statusLevel = 'blocking';
    } else if (!identity.role) {
      status.warnings.push('當前使用者 Email (' + identity.email + ') 未在 Users 表中授權角色，無法存取核心系統。');
      if (status.statusLevel !== 'blocking') status.statusLevel = 'warning';
    }

    // 檢查試算表可讀性與工作表結構
    var ssId = Config.getSpreadsheetId();
    if (!ssId || !diagnostic.spreadsheetReadable) {
      status.blockingIssues.push('無法開啟資料庫試算表，請確認 DATABASE_SPREADSHEET_ID 設定。');
      status.statusLevel = 'blocking';
    } else {
      try {
        var ss = SpreadsheetApp.openById(ssId);
        var currentSheets = ss.getSheets().map(function(s) { return s.getName(); });
        status.sheetsCount.current = currentSheets.length;

        var totalExpectedSheets = Object.keys(DATABASE_SCHEMAS);
        var sheetsOkCount = 0;

        totalExpectedSheets.forEach(function(sheetName) {
          var expectedHeaders = DATABASE_SCHEMAS[sheetName];
          if (currentSheets.indexOf(sheetName) === -1) {
            status.sheetsStatus[sheetName] = { exists: false, headersOk: false, missingHeaders: expectedHeaders };
            status.warnings.push('缺少必要的工作表：' + sheetName);
          } else {
            var validation = SheetRepository.validateHeaders(sheetName, expectedHeaders);
            status.sheetsStatus[sheetName] = {
              exists: true,
              headersOk: validation.valid,
              missingHeaders: validation.missing
            };
            if (validation.valid) {
              sheetsOkCount++;
            } else {
              status.warnings.push('工作表 ' + sheetName + ' 欄位不完整，缺少：' + validation.missing.join(', '));
            }
          }
        });

        if (sheetsOkCount === totalExpectedSheets.length) {
          status.isInitialized = true;
        }

        // 讀取已安裝的 Schema 版本
        var installedVer = Config.getSystemConfig('SCHEMA_VERSION');
        if (installedVer) {
          status.schemaVersion.installed = installedVer;
        }
      } catch (e) {
        status.blockingIssues.push('分析試算表結構失敗：' + e.message);
        status.statusLevel = 'blocking';
      }
    }

    // 檢查系統時區
    if (!status.timezoneCheck.matches) {
      status.warnings.push('時區未完全設定為 Asia/Taipei。目前 Script 時區: ' + status.timezoneCheck.scriptTimeZone + ', Spreadsheet 時區: ' + status.timezoneCheck.spreadsheetTimeZone);
      if (status.statusLevel !== 'blocking') status.statusLevel = 'warning';
    }

    // 檢查報表資料夾權限
    var folderId = Config.getReportRootFolderId();
    if (!folderId) {
      status.warnings.push('未設定報表根資料夾 (REPORT_ROOT_FOLDER_ID)，月結時將無法產出檔案並存入雲端硬碟。');
      if (status.statusLevel !== 'blocking') status.statusLevel = 'warning';
    } else if (!status.folderStatus.writable) {
      status.blockingIssues.push('報表資料夾不具備寫入權限，請確認分享設定。');
      status.statusLevel = 'blocking';
    }

    // 檢查 SchoolDays 日期重複問題
    if (status.isInitialized && SheetRepository.sheetExists('SchoolDays')) {
      var duplicates = SchoolDaysService.findDuplicateSchoolDays();
      if (duplicates.length > 0) {
        status.blockingIssues.push('🛑 日曆資料異常：日曆 (SchoolDays) 中包含重複的日期設定：' + duplicates.join(', ') + '。請執行資料合併清理，否則將禁止進行任何正式餐數統計！');
        status.statusLevel = 'blocking';
      }
    }

    // 檢查必填 SystemConfig 完整性
    var checkConfig = Config.checkRequiredSettings();
    if (checkConfig.missingConfig.length > 0) {
      status.warnings.push('系統設定 (SystemConfig) 缺少必填參數：' + checkConfig.missingConfig.join(', '));
      if (status.statusLevel !== 'blocking') status.statusLevel = 'warning';
    } else if (status.isInitialized) {
      status.requiredConfigComplete = true;
    }

    if (status.blockingIssues.length > 0) {
      status.statusLevel = 'blocking';
    } else if (status.warnings.length > 0) {
      status.statusLevel = 'warning';
    }

    return status;
  }

  /**
   * 執行系統初始化精靈
   * @param {object} settings 初始設定資料 { schoolName, schoolYear, semester, defaultPrice, adminEmail }
   * @return {object} 執行報告
   */
  function runInitializeWizard(settings) {
    // 僅限系統部署者 (Bootstrapper) 或已授權之管理員執行
    var identity = AuthService.getCurrentIdentity();
    if (!identity.isBootstrapper && identity.role !== 'system_admin') {
      throw new Error('僅有最高管理員或系統部署者能執行初始化精靈');
    }

    var report = {
      createdSheets: [],
      updatedSheets: [],
      skippedSheets: [],
      warnings: [],
      errors: [],
      success: true
    };

    var ssId = Config.getSpreadsheetId();
    if (!ssId) {
      throw new Error('請先在 Script Properties 中設定 DATABASE_SPREADSHEET_ID');
    }

    var ss = SpreadsheetApp.openById(ssId);

    // 1. 初始化 14 張工作表
    Object.keys(DATABASE_SCHEMAS).forEach(function(sheetName) {
      var expectedHeaders = DATABASE_SCHEMAS[sheetName];
      var sheet = ss.getSheetByName(sheetName);
      
      if (!sheet) {
        // 建立新工作表
        sheet = ss.insertSheet(sheetName);
        sheet.appendRow(expectedHeaders);
        // 設定首列凍結與格式
        sheet.setFrozenRows(1);
        var headerRange = sheet.getRange(1, 1, 1, expectedHeaders.length);
        headerRange.setFontWeight('bold');
        headerRange.setBackground('#F3F4F6');
        report.createdSheets.push(sheetName);
      } else {
        // 工作表已存在，補足缺失的欄位
        var validation = SheetRepository.validateHeaders(sheetName, expectedHeaders);
        if (!validation.valid) {
          var headerMap = SheetRepository.getHeaderMap(sheetName);
          var lastColumn = sheet.getLastColumn();
          validation.missing.forEach(function(h) {
            lastColumn++;
            sheet.getRange(1, lastColumn).setValue(h);
          });
          // 重新設定格式
          var newHeaderRange = sheet.getRange(1, 1, 1, lastColumn);
          newHeaderRange.setFontWeight('bold');
          newHeaderRange.setBackground('#F3F4F6');
          report.updatedSheets.push(sheetName);
        } else {
          report.skippedSheets.push(sheetName);
        }
      }
    });

    // 2. 寫入基本 SystemConfig
    var userEmail = identity.email || settings.adminEmail || Session.getActiveUser().getEmail();
    var currentDateTime = Utils.formatDateTime(new Date());

    var defaultConfig = {
      'SCHEMA_VERSION': { val: CURRENT_SCHEMA_VERSION, desc: '系統資料結構版本號' },
      'SCHOOL_NAME': { val: settings.schoolName || '示範國民小學', desc: '學校完整名稱' },
      'SCHOOL_CODE': { val: '000000', desc: '學校代碼代號' },
      'SCHOOL_YEAR': { val: settings.schoolYear || '115', desc: '當前學年度' },
      'SEMESTER': { val: settings.semester || '1', desc: '學期 (1 或 2)' },
      'TIMEZONE': { val: 'Asia/Taipei', desc: '系統時區固定台北' },
      'DEFAULT_MEAL_PRICE': { val: settings.defaultPrice || '60', desc: '預設每餐金額' },
      'DAILY_CONFIRM_DEADLINE': { val: '09:00', desc: '導師每日完成登記確認之截止時間 (HH:mm)' },
      'REPORT_FOLDER_ID': { val: Config.getReportRootFolderId() || '', desc: 'Google Drive 報表儲存根資料夾 ID' },
      'CURRENT_MONTH': { val: Utils.formatDate(new Date()).substring(0, 7), desc: '當前處理月份 (YYYY-MM)' },
      'ALLOW_RETROACTIVE_EDIT': { val: 'FALSE', desc: '是否允許導師補登記過往日期的停餐資料 (TRUE/FALSE)' },
      'RETROACTIVE_EDIT_DAYS': { val: '3', desc: '允許補登記的天數 (整數天數)' },
      'ROUNDING_RULE': { val: 'DAILY_ROUND', desc: '四捨五入規則 (DAILY_ROUND: 每日四捨五入, MONTHLY_ROUND: 月底總額四捨五入)' },
      'ROUNDING_MODE': { val: 'HALF_UP', desc: '金額四捨五入模式 (HALF_UP: 四捨五入, FLOOR: 無條件捨去, CEILING: 無條件進位)' },
      'ROUNDING_SCALE': { val: '0', desc: '金額保留之小數點位數 (0, 1, 2)' },
      'ALLOW_SUBSIDY_OVER_MEAL_PRICE': { val: 'FALSE', desc: '是否允許單一學生補助來源加總金額超過當日餐費金額 (TRUE/FALSE)' },
      'MIXED_RULE_CALCULATION_ORDER': { val: 'percentage_first', desc: '混合比例與金額補助規則時的計算順序 (percentage_first 或 fixed_first)' },
      'ENABLE_DIETARY_STATS': { val: 'FALSE', desc: '是否啟用葷素食與乳品等細項餐別統計 (TRUE/FALSE)' },
      'DIETARY_TYPES': { val: '葷食,素食,乳品,豆漿', desc: '膳食分類統計細項種類 (半形逗號分隔)' },
      'INCLUDED_CLASS_TYPES': { val: 'regular,kindergarten,staff', desc: '納入統計與計算的班級類型 (半形逗號分隔)' },
      'REOPEN_CONFIRM_ROLE': { val: 'system_admin,lunch_admin', desc: '有權限重新退回或開放已確認班級的角色' },
      'REPORT_TEMPLATE_TOWNSHIP_ID': { val: '', desc: '公所補助申請書模板 ID' },
      'REPORT_TEMPLATE_COUNTY_ID': { val: '', desc: '縣府補助申請書模板 ID' },
      'STUDENT_UNIQUE_KEY_MODE': { val: 'SCHOOL_YEAR_AND_STUDENT_NUMBER', desc: '學生唯一性判定模式 (SCHOOL_YEAR_AND_STUDENT_NUMBER 或 STUDENT_NUMBER_ONLY 或 CUSTOM_EXTERNAL_ID)' },
      'ENVIRONMENT': { val: 'UAT', desc: '系統執行環境 (UAT, PRODUCTION)' },
      'RATE_STORAGE_FORMAT': { val: 'BASIS_POINTS', desc: '補助率儲存格式 (BASIS_POINTS)' },
      'TEST_SPREADSHEET_ID': { val: '', desc: '自動測試專用之 Google 試算表 ID' }
    };

    var configSheet = ss.getSheetByName('SystemConfig');
    var existingConfig = SheetRepository.getAllRecords('SystemConfig');
    var existingKeys = existingConfig.map(function(c) { return c.config_key; });

    Object.keys(defaultConfig).forEach(function(key) {
      if (existingKeys.indexOf(key) === -1) {
        var conf = defaultConfig[key];
        SheetRepository.appendRecord('SystemConfig', {
          config_key: key,
          config_value: conf.val,
          description: conf.desc,
          updated_at: currentDateTime,
          updated_by: userEmail
        });
      }
    });

    // 清除系統設定快取
    Config.clearAllCache();

    // 3. 建立預設 SubsidyCategories
    var defaultCategories = [
      { id: 'GENERAL', name: '一般學生', flag: true, order: 1 },
      { id: 'LOW_INCOME', name: '低收入戶', flag: false, order: 2 },
      { id: 'MIDDLE_LOW_INCOME', name: '中低收入戶', flag: false, order: 3 },
      { id: 'DISABILITY', name: '身心障礙', flag: false, order: 4 },
      { id: 'INDIGENOUS', name: '原住民', flag: false, order: 5 },
      { id: 'OTHER', name: '其他政策補助身分', flag: false, order: 6 }
    ];

    var existingCategories = SheetRepository.getAllRecords('SubsidyCategories');
    var existingCatIds = existingCategories.map(function(c) { return c.subsidy_category_id; });

    defaultCategories.forEach(function(cat) {
      if (existingCatIds.indexOf(cat.id) === -1) {
        SheetRepository.appendRecord('SubsidyCategories', {
          subsidy_category_id: cat.id,
          category_name: cat.name,
          description: cat.name,
          general_student_flag: cat.flag,
          enabled: true,
          display_order: cat.order
        });
      }
    });

    // 4. 建立預設 SubsidyRules (草稿狀態，預設為 disabled = FALSE)
    var defaultRules = [
      // 一般生公所 50%
      { catId: 'GENERAL', source: 'township', rate: 5000, type: 'percentage', note: '一般學生公所補助 50%' },
      // 一般生縣府 50%
      { catId: 'GENERAL', source: 'county', rate: 5000, type: 'percentage', note: '一般學生縣府補助 50%' },
      // 特殊身分縣府 100%
      { catId: 'LOW_INCOME', source: 'county', rate: 10000, type: 'percentage', note: '低收入戶縣府全額補助 100%' },
      { catId: 'MIDDLE_LOW_INCOME', source: 'county', rate: 10000, type: 'percentage', note: '中低收入戶縣府全額補助 100%' },
      { catId: 'DISABILITY', source: 'county', rate: 10000, type: 'percentage', note: '身心障礙學生縣府全額補助 100%' },
      { catId: 'INDIGENOUS', source: 'county', rate: 10000, type: 'percentage', note: '原住民學生縣府全額補助 100%' }
    ];

    var existingRules = SheetRepository.getAllRecords('SubsidyRules');
    
    if (existingRules.length === 0) {
      defaultRules.forEach(function(rule) {
        SheetRepository.appendRecord('SubsidyRules', {
          rule_id: Utils.generateUUID(),
          subsidy_category_id: rule.catId,
          funding_source: rule.source,
          subsidy_rate: rule.rate,
          subsidy_amount: 0,
          calculation_type: rule.type,
          effective_start_date: '2026-08-01',
          effective_end_date: '2027-07-31',
          enabled: false, // 示範 draft，不直接正式啟用
          note: rule.note
        });
      });
    }

    // 5. 註冊當前執行使用者為第一位 system_admin
    if (userEmail) {
      var existingUser = SheetRepository.findById('Users', 'email', userEmail);
      if (!existingUser) {
        SheetRepository.appendRecord('Users', {
          user_id: Utils.generateUUID(),
          email: userEmail,
          name: settings.adminName || '最高管理員',
          role: 'system_admin',
          class_id: '',
          enabled: true
        });
      }
    }

    // 6. 嘗試建立 Drive 學年度子資料夾
    var folderId = Config.getReportRootFolderId();
    if (folderId && diagnostic.reportFolderWritable) {
      try {
        var rootFolder = DriveApp.getFolderById(folderId);
        var subfolderName = (settings.schoolYear || '115') + '學年度';
        var folders = rootFolder.getFoldersByName(subfolderName);
        if (!folders.hasNext()) {
          rootFolder.createFolder(subfolderName);
        }
      } catch (e) {
        report.warnings.push('建立 Google Drive 學年度子資料夾失敗：' + e.message);
      }
    }

    // 寫入稽核日誌
    try {
      SheetRepository.appendRecord('AuditLogs', {
        log_id: Utils.generateUUID(),
        timestamp: currentDateTime,
        user_email: userEmail,
        action: 'INITIALIZE_SYSTEM',
        module: 'SETUP',
        record_id: ssId,
        before_data: '',
        after_data: JSON.stringify({ schoolName: settings.schoolName, schoolYear: settings.schoolYear }),
        reason: '系統初始化建立資料表',
        ip_or_session: '',
        calculation_version: 0
      });
    } catch (e) {}

    return report;
  }



  function initializeDatabaseForSs(ss, settings) {
    var createdSheets = [];
    var skippedSheets = [];
    
    var currentSheets = ss.getSheets().map(function(s) { return s.getName(); });
    var totalExpectedSheets = Object.keys(DATABASE_SCHEMAS);
    
    totalExpectedSheets.forEach(function(sheetName) {
      var headers = DATABASE_SCHEMAS[sheetName];
      if (currentSheets.indexOf(sheetName) === -1) {
        var sh = ss.insertSheet(sheetName);
        // 設定 Headers
        sh.getRange(1, 1, 1, headers.length).setValues([headers]);
        // 凍結首行
        sh.setFrozenRows(1);
        createdSheets.push(sheetName);
      } else {
        skippedSheets.push(sheetName);
      }
    });

    // 刪除預設的工作表
    var defaultSheet = ss.getSheetByName('工作表1') || ss.getSheetByName('Sheet1');
    if (defaultSheet && ss.getSheets().length > 1) {
      ss.deleteSheet(defaultSheet);
    }
    
    // 寫入 SystemConfig 預設值
    var configs = {
      'SCHOOL_NAME': settings.schoolName || '水月國民小學',
      'SCHOOL_YEAR': String(settings.schoolYear || '115'),
      'SEMESTER': String(settings.semester || '1'),
      'DEFAULT_MEAL_PRICE': String(settings.defaultPrice || '60'),
      'DAILY_CONFIRM_DEADLINE': '09:00',
      'ROUNDING_RULE': 'DAILY_ROUND',
      'ROUNDING_MODE': 'HALF_UP',
      'ROUNDING_SCALE': '0',
      'ALLOW_SUBSIDY_OVER_MEAL_PRICE': 'FALSE',
      'MIXED_RULE_CALCULATION_ORDER': 'percentage_first',
      'ENABLE_DIETARY_STATS': 'TRUE',
      'DIETARY_TYPES': '葷食,素食',
      'INCLUDED_CLASS_TYPES': 'regular,kindergarten,staff',
      'REOPEN_CONFIRM_ROLE': 'system_admin,lunch_admin',
      'SCHEMA_VERSION': CURRENT_SCHEMA_VERSION,
      'RATE_STORAGE_FORMAT': 'BASIS_POINTS',
      'ENVIRONMENT': 'UAT'
    };

    var configSheet = ss.getSheetByName('SystemConfig');
    if (configSheet) {
      var rows = configSheet.getDataRange().getValues();
      var existingKeys = rows.slice(1).map(function(r) { return r[0]; });
      var newRows = [];
      for (var key in configs) {
        if (existingKeys.indexOf(key) === -1) {
          newRows.push([
            key,
            configs[key],
            '初始化預設參數',
            Utils.formatDateTime(new Date()),
            settings.adminEmail
          ]);
        }
      }
      if (newRows.length > 0) {
        configSheet.getRange(configSheet.getLastRow() + 1, 1, newRows.length, 5).setValues(newRows);
      }
    }
    
    // 寫入最高管理員使用者
    var userSheet = ss.getSheetByName('Users');
    if (userSheet) {
      var rows = userSheet.getDataRange().getValues();
      var existingEmails = rows.slice(1).map(function(r) { return String(r[1]).trim().toLowerCase(); });
      var targetEmail = settings.adminEmail ? String(settings.adminEmail).trim().toLowerCase() : '';
      if (targetEmail && existingEmails.indexOf(targetEmail) === -1) {
        userSheet.getRange(userSheet.getLastRow() + 1, 1, 1, 8).setValues([[
          'USER_ADMIN_BOOT',
          settings.adminEmail,
          settings.adminName || '系統管理員',
          'system_admin',
          '',
          true, // enabled
          Utils.formatDateTime(new Date()),
          Utils.formatDateTime(new Date())
        ]]);
      }
    }

    // 寫入預設 Approved 補助身分與規則
    var catSheet = ss.getSheetByName('SubsidyCategories');
    if (catSheet) {
      var rows = catSheet.getDataRange().getValues();
      var existingCatIds = rows.slice(1).map(function(r) { return r[0]; });
      var newCats = [];
      var defaultCats = [
        ['GENERAL', '一般學生', '預設一般用餐學生', true, true, 1],
        ['LOW_INCOME', '低收入戶', '政府全額補助對象', false, true, 2]
      ];
      defaultCats.forEach(function(cat) {
        if (existingCatIds.indexOf(cat[0]) === -1) {
          newCats.push(cat);
        }
      });
      if (newCats.length > 0) {
        catSheet.getRange(catSheet.getLastRow() + 1, 1, newCats.length, 6).setValues(newCats);
      }
    }

    var ruleSheet = ss.getSheetByName('SubsidyRules');
    if (ruleSheet) {
      var rows = ruleSheet.getDataRange().getValues();
      var existingRuleIds = rows.slice(1).map(function(r) { return r[0]; });
      var newRules = [];
      var defaultRules = [
        ['RULE_GEN_TOWN', 'GENERAL', 'township', '5000', '0.00', 'percentage', '2026-01-01', '2099-12-31', true, '公所分攤50%'],
        ['RULE_GEN_COUNTY', 'GENERAL', 'county', '5000', '0.00', 'percentage', '2026-01-01', '2099-12-31', true, '縣府分攤50%'],
        ['RULE_LOW_INC', 'LOW_INCOME', 'county', '10000', '0.00', 'percentage', '2026-01-01', '2099-12-31', true, '縣府全額補助低收']
      ];
      defaultRules.forEach(function(rule) {
        if (existingRuleIds.indexOf(rule[0]) === -1) {
          newRules.push(rule);
        }
      });
      if (newRules.length > 0) {
        ruleSheet.getRange(ruleSheet.getLastRow() + 1, 1, newRules.length, 10).setValues(newRules);
      }
    }

    // 寫入預設報表範本 ReportTemplates
    var tplSheet = ss.getSheetByName('ReportTemplates');
    if (tplSheet) {
      var rows = tplSheet.getDataRange().getValues();
      var existingTplIds = rows.slice(1).map(function(r) { return r[0]; });
      var newTpls = [];
      var defaultTpls = [
        ['TMP_TOWNSHIP_V1', 'TOWNSHIP_FUNDING_APPLICATION', '通用版公所補助申請表', '1', 'HTML', 'HTML_BUILTIN', '', '{}', '{}', '2026-01-01', '2099-12-31', true, 'draft', settings.adminEmail, Utils.formatDateTime(new Date()), '', '', '', '預設公所範本', 'INTERNAL_STUDENT_DETAIL'],
        ['TMP_COUNTY_V1', 'COUNTY_FUNDING_APPLICATION', '通用版縣府補助申請表', '1', 'HTML', 'HTML_BUILTIN', '', '{}', '{}', '2026-01-01', '2099-12-31', true, 'draft', settings.adminEmail, Utils.formatDateTime(new Date()), '', '', '', '預設縣府範本', 'INTERNAL_STUDENT_DETAIL'],
        ['TMP_MEAL_SUM_V1', 'MONTHLY_MEAL_SUMMARY', '通用版每月餐數統計表', '1', 'HTML', 'HTML_BUILTIN', '', '{}', '{}', '2026-01-01', '2099-12-31', true, 'draft', settings.adminEmail, Utils.formatDateTime(new Date()), '', '', '', '預設月餐統計範本', 'PUBLIC_SUMMARY']
      ];
      defaultTpls.forEach(function(tpl) {
        if (existingTplIds.indexOf(tpl[0]) === -1) {
          newTpls.push(tpl);
        }
      });
      if (newTpls.length > 0) {
        tplSheet.getRange(tplSheet.getLastRow() + 1, 1, newTpls.length, 20).setValues(newTpls);
      }
    }

    return {
      createdSheets: createdSheets,
      skippedSheets: skippedSheets
    };
  }

  return {
    getSystemStatus: getSystemStatus,
    runInitializeWizard: runInitializeWizard,
    initializeDatabaseForSs: initializeDatabaseForSs
  };
})();
