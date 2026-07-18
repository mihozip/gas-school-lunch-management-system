/**
 * Code.gs
 * Google Apps Script Web App 路由與 API 入口
 */

/**
 * 網頁應用程式 GET 請求進入點
 * @param {object} e 請求參數
 * @return {HtmlOutput} HTML 網頁物件
 */
function doGet(e) {
  var status = SetupService.getSystemStatus();
  var identity = AuthService.getCurrentIdentity();
  
  // 建立 HTML 樣板
  var template;
  
  // 阻斷情況 A：無法取得使用者 Email (未授權或非 domain 帳號)
  if (!identity.email) {
    template = HtmlService.createTemplateFromFile('src/frontend/LoginError');
    template.errorType = 'NO_EMAIL';
    template.email = '';
    return template.evaluate()
      .setTitle('系統存取錯誤 - 學校午餐管理系統')
      .setSandboxMode(HtmlService.SandboxMode.IFRAME)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // 阻斷情況 B：未設定 Database ID 或工作表未完整初始化 (狀態機檢驗)
  var boot = BootstrapService.getBootstrapStatus();
  if (boot.status !== 'COMPLETED') {
    // 僅允許最高管理員/部署者本人進入初始化畫面，其餘顯示系統維護中
    if (identity.role === 'system_admin' || identity.isBootstrapper) {
      template = HtmlService.createTemplateFromFile('src/frontend/SetupWizard');
      template.adminEmail = identity.email;
      template.spreadsheetId = boot.databaseSpreadsheetId || '';
      template.folderId = boot.reportRootFolderId || '';
      template.allowedDomain = boot.allowedDomain || '';
      template.deploymentMode = boot.environment || 'UAT';
      return template.evaluate()
        .setTitle('系統初始化精靈 - 學校午餐管理系統')
        .setSandboxMode(HtmlService.SandboxMode.IFRAME)
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    } else {
      template = HtmlService.createTemplateFromFile('src/frontend/LoginError');
      template.errorType = 'NOT_INITIALIZED';
      template.email = identity.email;
      return template.evaluate()
        .setTitle('系統維護中 - 學校午餐管理系統')
        .setSandboxMode(HtmlService.SandboxMode.IFRAME)
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }
  }

  // 阻斷情況 C：使用者 Email 在資料庫中未授權或帳號被停用
  if (!identity.role || !identity.enabled) {
    template = HtmlService.createTemplateFromFile('src/frontend/LoginError');
    template.errorType = 'UNAUTHORIZED';
    template.email = identity.email;
    return template.evaluate()
      .setTitle('權限不足 - 學校午餐管理系統')
      .setSandboxMode(HtmlService.SandboxMode.IFRAME)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // 正常情況：載入 SPA 系統主畫面
  template = HtmlService.createTemplateFromFile('src/frontend/Index');
  template.email = identity.email;
  template.name = identity.name;
  template.role = identity.role;
  return template.evaluate()
    .setTitle(Config.getSystemConfig('SCHOOL_NAME', '學校午餐管理系統') + ' - 學校午餐管理系統')
    .setSandboxMode(HtmlService.SandboxMode.IFRAME)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * 用於在 HTML 樣板中嵌入其他檔案的內容
 * @param {string} filename 欲嵌入的檔案名稱
 * @return {string} 檔案內容
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/****************************************************************
 * 前端透過 google.script.run 呼叫的後端 API 端點
 ****************************************************************/

/**
 * 獲取當前系統狀態 (提供給 SystemStatus 元件)
 */
function apiGetSystemStatus() {
  try {
    return Utils.createResponse(true, SetupService.getSystemStatus());
  } catch (e) {
    return Utils.createResponse(false, null, 'SYSTEM_ERROR', '無法獲取系統狀態', e.message);
  }
}

/**
 * 獲取登入診斷資訊 (提供給 AuthDiagnostic 元件)
 */
function apiGetAuthorizationDiagnostic() {
  try {
    // 任何人皆可存取此 API 用於診斷，但需確保不包含 token 且只包含環境屬性
    return Utils.createResponse(true, AuthService.getAuthorizationDiagnostic());
  } catch (e) {
    return Utils.createResponse(false, null, 'AUTH_ERROR', '無法獲取身份診斷資料', e.message);
  }
}

/**
 * 獲取當前登入者身份資訊
 */
function apiGetCurrentIdentity() {
  try {
    return Utils.createResponse(true, AuthService.getCurrentIdentity());
  } catch (e) {
    return Utils.createResponse(false, null, 'AUTH_ERROR', '無法獲取當前身份資訊', e.message);
  }
}

/**
 * 儲存 Script Properties 設定 (初始化專用，限 system_admin 或部署者)
 */
function apiSaveScriptProperties(props) {
  try {
    var identity = AuthService.getCurrentIdentity();
    if (!identity.isBootstrapper && identity.role !== 'system_admin') {
      return Utils.createResponse(false, null, 'PERMISSION_DENIED', '權限不足，僅最高管理員能修改 Script 屬性。');
    }

    if (props.spreadsheetId && !Config.validateSpreadsheetId(props.spreadsheetId)) {
      return Utils.createResponse(false, null, 'INVALID_SPREADSHEET_ID', '無效的試算表 ID 或帳號不具備存取權限。');
    }

    if (props.folderId && !Config.validateReportFolderId(props.folderId)) {
      return Utils.createResponse(false, null, 'INVALID_FOLDER_ID', '無效的雲端硬碟資料夾 ID 或帳號不具備寫入權限。');
    }

    Config.setProperties({
      'DATABASE_SPREADSHEET_ID': props.spreadsheetId || '',
      'REPORT_ROOT_FOLDER_ID': props.folderId || '',
      'DEPLOYMENT_MODE': props.deploymentMode || 'DOMAIN',
      'ALLOWED_DOMAIN': props.allowedDomain || ''
    });

    return Utils.createResponse(true, '儲存成功');
  } catch (e) {
    return Utils.createResponse(false, null, 'SAVE_ERROR', '儲存設定失敗', e.message);
  }
}

/**
 * 執行系統初始化 (限 system_admin 或部署者)
 */
function apiRunInitializeWizard(settings) {
  try {
    var report = SetupService.runInitializeWizard(settings);
    return Utils.createResponse(true, report);
  } catch (e) {
    return Utils.createResponse(false, null, 'INIT_ERROR', '初始化失敗', e.message);
  }
}

/****************************************************************
 * Phase 2 班級管理 APIs
 ****************************************************************/

function apiListClasses(filters) {
  try {
    return Utils.createResponse(true, ClassService.listClasses(filters));
  } catch (e) {
    return Utils.createResponse(false, null, 'CLASS_ERROR', '載入班級失敗', e.message);
  }
}

function apiCreateClass(classObj) {
  try {
    return Utils.createResponse(true, ClassService.createClass(classObj));
  } catch (e) {
    return Utils.createResponse(false, null, 'CLASS_ERROR', '建立班級失敗', e.message);
  }
}

function apiUpdateClass(classId, classObj) {
  try {
    return Utils.createResponse(true, ClassService.updateClass(classId, classObj));
  } catch (e) {
    return Utils.createResponse(false, null, 'CLASS_ERROR', '修改班級失敗', e.message);
  }
}

function apiDisableClass(classId) {
  try {
    return Utils.createResponse(true, ClassService.disableClass(classId));
  } catch (e) {
    return Utils.createResponse(false, null, 'CLASS_ERROR', '停用班級失敗', e.message);
  }
}

/****************************************************************
 * Phase 2 學生管理 APIs
 ****************************************************************/

function apiListStudents(filters) {
  try {
    return Utils.createResponse(true, StudentService.listStudents(filters));
  } catch (e) {
    return Utils.createResponse(false, null, 'STUDENT_ERROR', '載入學生名冊失敗', e.message);
  }
}

function apiGetStudent(studentId) {
  try {
    return Utils.createResponse(true, StudentService.getStudent(studentId));
  } catch (e) {
    return Utils.createResponse(false, null, 'STUDENT_ERROR', '載入學生詳細資料失敗', e.message);
  }
}

function apiCreateStudent(studentObj) {
  try {
    return Utils.createResponse(true, StudentService.createStudent(studentObj));
  } catch (e) {
    return Utils.createResponse(false, null, 'STUDENT_ERROR', '新增學生失敗', e.message);
  }
}

function apiUpdateStudent(studentId, studentObj) {
  try {
    return Utils.createResponse(true, StudentService.updateStudent(studentId, studentObj));
  } catch (e) {
    return Utils.createResponse(false, null, 'STUDENT_ERROR', '修改學生失敗', e.message);
  }
}

function apiDisableStudent(studentId) {
  try {
    return Utils.createResponse(true, StudentService.disableStudent(studentId));
  } catch (e) {
    return Utils.createResponse(false, null, 'STUDENT_ERROR', '停用學生失敗', e.message);
  }
}

function apiTransferStudent(studentId, endDate, status) {
  try {
    return Utils.createResponse(true, StudentService.transferStudent(studentId, endDate, status));
  } catch (e) {
    return Utils.createResponse(false, null, 'STUDENT_ERROR', '轉出學生失敗', e.message);
  }
}

function apiChangeStudentClass(studentId, classId, effectiveDate, reason) {
  try {
    return Utils.createResponse(true, StudentClassHistoryService.changeClass(studentId, classId, effectiveDate, reason));
  } catch (e) {
    return Utils.createResponse(false, null, 'STUDENT_ERROR', '變更班級失敗', e.message);
  }
}

function apiChangeStudentSubsidy(studentId, subsidyCategoryId, effectiveDate, reason, docNo) {
  try {
    return Utils.createResponse(true, StudentSubsidyHistoryService.changeSubsidyCategory(studentId, subsidyCategoryId, effectiveDate, reason, docNo));
  } catch (e) {
    return Utils.createResponse(false, null, 'STUDENT_ERROR', '變更補助身分失敗', e.message);
  }
}

function apiGetStudentHistory(studentId) {
  try {
    var data = {
      classHistory: StudentClassHistoryService.listStudentClassHistory(studentId),
      subsidyHistory: StudentSubsidyHistoryService.listStudentHistory(studentId)
    };
    return Utils.createResponse(true, data);
  } catch (e) {
    return Utils.createResponse(false, null, 'STUDENT_ERROR', '載入歷史歷程失敗', e.message);
  }
}

/****************************************************************
 * Phase 2 膳食類別 APIs
 ****************************************************************/

function apiGetDietaryTypes() {
  try {
    return Utils.createResponse(true, DietaryTypeService.getDietaryTypes());
  } catch (e) {
    return Utils.createResponse(false, null, 'DIETARY_ERROR', '載入膳食類別失敗', e.message);
  }
}

function apiAddDietaryType(code, name, displayOrder) {
  try {
    return Utils.createResponse(true, DietaryTypeService.addDietaryType(code, name, displayOrder));
  } catch (e) {
    return Utils.createResponse(false, null, 'DIETARY_ERROR', '新增膳食類別失敗', e.message);
  }
}

function apiDisableDietaryType(code) {
  try {
    return Utils.createResponse(true, DietaryTypeService.disableDietaryType(code));
  } catch (e) {
    return Utils.createResponse(false, null, 'DIETARY_ERROR', '停用膳食類別失敗', e.message);
  }
}

/****************************************************************
 * Phase 2 匯入學生名冊 APIs
 ****************************************************************/

function apiParseStudentImport(payloadStr, originalFilename) {
  try {
    return Utils.createResponse(true, ImportService.parseStudentImport(payloadStr, originalFilename));
  } catch (e) {
    return Utils.createResponse(false, null, 'IMPORT_ERROR', '解析匯入文字失敗，請檢查欄名是否正確。', e.message);
  }
}

function apiValidateStudentImport(rowsList, schoolYear) {
  try {
    return Utils.createResponse(true, ImportService.validateStudentImport(rowsList, schoolYear));
  } catch (e) {
    return Utils.createResponse(false, null, 'IMPORT_ERROR', '驗證匯入資料失敗', e.message);
  }
}

function apiCommitStudentImport(rowsList, schoolYear, originalFilename, payloadHash) {
  try {
    return Utils.createResponse(true, ImportService.commitStudentImport(rowsList, schoolYear, originalFilename, payloadHash));
  } catch (e) {
    return Utils.createResponse(false, null, 'IMPORT_ERROR', '提交匯入資料失敗', e.message);
  }
}

function apiGetImportBatch(batchId) {
  try {
    var record = SheetRepository.findById('ImportBatches', 'import_batch_id', batchId);
    if (!record) throw new Error('找不到該批次項目');
    return Utils.createResponse(true, record);
  } catch (e) {
    return Utils.createResponse(false, null, 'IMPORT_ERROR', '載入匯入批次失敗', e.message);
  }
}

function apiDownloadImportErrors(batchId) {
  try {
    var record = SheetRepository.findById('ImportBatches', 'import_batch_id', batchId);
    if (!record) throw new Error('找不到該批次項目');
    return Utils.createResponse(true, {
      filename: 'import_errors_' + batchId + '.txt',
      content: '批次匯入失敗日誌：\n' + (record.error_message || '無詳細錯誤資料')
    });
  } catch (e) {
    return Utils.createResponse(false, null, 'IMPORT_ERROR', '下載錯誤日誌失敗', e.message);
  }
}

/****************************************************************
 * Phase 2.5 & 3 補強與長期停餐 APIs
 ****************************************************************/

function rollbackBatch(batchId) {
  try {
    return Utils.createResponse(true, ImportService.rollbackBatch(batchId));
  } catch (e) {
    return Utils.createResponse(false, null, 'ROLLBACK_ERROR', '手動撤銷批次失敗', e.message);
  }
}

function apiRetryFailedRollback(batchId) {
  try {
    return Utils.createResponse(true, ImportService.retryFailedRollback(batchId));
  } catch (e) {
    return Utils.createResponse(false, null, 'ROLLBACK_ERROR', '重新嘗試回復失敗', e.message);
  }
}

function apiVerifyImportBatchConsistency(batchId) {
  try {
    return Utils.createResponse(true, ImportService.verifyImportBatchConsistency(batchId));
  } catch (e) {
    return Utils.createResponse(false, null, 'CONSISTENCY_ERROR', '校驗一致性失敗', e.message);
  }
}

function apiCreateSuspension(suspObj) {
  try {
    return Utils.createResponse(true, MealSuspensionService.createSuspension(suspObj));
  } catch (e) {
    return Utils.createResponse(false, null, 'SUSPENSION_ERROR', '建立停餐申請失敗', e.message);
  }
}

function apiApproveSuspension(suspensionId) {
  try {
    return Utils.createResponse(true, MealSuspensionService.approveSuspension(suspensionId));
  } catch (e) {
    return Utils.createResponse(false, null, 'SUSPENSION_ERROR', '核准停餐申請失敗', e.message);
  }
}

function apiEndSuspension(suspensionId, endDate, reason) {
  try {
    return Utils.createResponse(true, MealSuspensionService.endSuspension(suspensionId, endDate, reason));
  } catch (e) {
    return Utils.createResponse(false, null, 'SUSPENSION_ERROR', '恢復用餐設定失敗', e.message);
  }
}

function apiCancelSuspension(suspensionId, reason) {
  try {
    return Utils.createResponse(true, MealSuspensionService.cancelSuspension(suspensionId, reason));
  } catch (e) {
    return Utils.createResponse(false, null, 'SUSPENSION_ERROR', '取消停餐申請失敗', e.message);
  }
}

function apiListStudentSuspensions(studentId) {
  try {
    return Utils.createResponse(true, MealSuspensionService.listStudentSuspensions(studentId));
  } catch (e) {
    return Utils.createResponse(false, null, 'SUSPENSION_ERROR', '載入停餐紀錄失敗', e.message);
  }
}

/****************************************************************
 * Phase 3 上課日與供餐日曆 APIs
 ****************************************************************/

function apiBatchCreateSchoolDays(startDate, endDate, schoolYear, semester, defaultPrice) {
  try {
    return Utils.createResponse(true, SchoolDaysService.batchCreateSchoolDays(startDate, endDate, schoolYear, semester, defaultPrice));
  } catch (e) {
    return Utils.createResponse(false, null, 'CALENDAR_ERROR', '批次建立日曆失敗', e.message);
  }
}

function apiUpdateSchoolDay(date, fields) {
  try {
    return Utils.createResponse(true, SchoolDaysService.updateSchoolDay(date, fields));
  } catch (e) {
    return Utils.createResponse(false, null, 'CALENDAR_ERROR', '修改日期設定失敗', e.message);
  }
}

function apiListSchoolDays(schoolYear, semester) {
  try {
    return Utils.createResponse(true, SchoolDaysService.listSchoolDays(schoolYear, semester));
  } catch (e) {
    return Utils.createResponse(false, null, 'CALENDAR_ERROR', '載入日曆清單失敗', e.message);
  }
}

/****************************************************************
 * Phase 3 每日停餐與班級確認 APIs
 ****************************************************************/

function apiGetClassMealEntry(classId, date) {
  try {
    return Utils.createResponse(true, MealExceptionService.getClassMealEntry(classId, date));
  } catch (e) {
    return Utils.createResponse(false, null, 'ENTRY_ERROR', '載入每日停餐登記失敗', e.message);
  }
}

function apiSaveDraft(classId, date, exceptionEntries) {
  try {
    return Utils.createResponse(true, MealExceptionService.saveDraft(classId, date, exceptionEntries));
  } catch (e) {
    return Utils.createResponse(false, null, 'ENTRY_ERROR', '儲存草稿失敗', e.message);
  }
}

function apiConfirmClassDay(classId, date, exceptionEntries) {
  try {
    return Utils.createResponse(true, MealExceptionService.confirmClassDay(classId, date, exceptionEntries));
  } catch (e) {
    return Utils.createResponse(false, null, 'ENTRY_ERROR', '完成班級確認失敗', e.message);
  }
}

function apiReopenClassDay(classId, date, reason) {
  try {
    return Utils.createResponse(true, MealExceptionService.reopenClassDay(classId, date, reason));
  } catch (e) {
    return Utils.createResponse(false, null, 'ENTRY_ERROR', '退回重開班級登記失敗', e.message);
  }
}

function apiGetClassConfirmationsDashboard(date) {
  try {
    return Utils.createResponse(true, MealExceptionService.getClassConfirmationsDashboard(date));
  } catch (e) {
    return Utils.createResponse(false, null, 'DASHBOARD_ERROR', '載入完成狀況儀表板失敗', e.message);
  }
}

function apiGetConfirmationHistory(confirmationId) {
  try {
    var history = SheetRepository.findRecords('DailyConfirmationHistory', function(x) {
      return x.confirmation_id === confirmationId;
    });
    return Utils.createResponse(true, history);
  } catch (e) {
    return Utils.createResponse(false, null, 'HISTORY_ERROR', '載入確認歷史失敗', e.message);
  }
}

/****************************************************************
 * Phase 4 每日正式計算、對帳與排程 APIs
 ****************************************************************/

function apiCalculateDate(date) {
  try {
    return Utils.createResponse(true, DailyMealCalculationService.calculateDate(date));
  } catch (e) {
    return Utils.createResponse(false, null, 'CALCULATION_ERROR', '計算失敗', e.message);
  }
}

function apiCalculateDateRange(startDate, endDate) {
  try {
    return Utils.createResponse(true, DailyMealCalculationService.calculateDateRange(startDate, endDate));
  } catch (e) {
    return Utils.createResponse(false, null, 'CALCULATION_ERROR', '區間計算失敗', e.message);
  }
}

function apiGetCalculationRun(runId) {
  try {
    return Utils.createResponse(true, DailyMealCalculationService.getCalculationRun(runId));
  } catch (e) {
    return Utils.createResponse(false, null, 'CALCULATION_ERROR', '無法獲取批次資訊', e.message);
  }
}

function apiListCalculationRuns(filters) {
  try {
    return Utils.createResponse(true, SheetRepository.getAllRecords('CalculationRuns'));
  } catch (e) {
    return Utils.createResponse(false, null, 'CALCULATION_ERROR', '載入計算批次失敗', e.message);
  }
}

function apiListCalculationIssues(filters) {
  try {
    return Utils.createResponse(true, DailyMealCalculationService.listCalculationIssues(filters || {}));
  } catch (e) {
    return Utils.createResponse(false, null, 'CALCULATION_ERROR', '載入異常警告失敗', e.message);
  }
}

function apiResolveCalculationIssue(issueId, resolutionNote) {
  try {
    return Utils.createResponse(true, DailyMealCalculationService.recalculateAfterResolution(issueId, resolutionNote));
  } catch (e) {
    return Utils.createResponse(false, null, 'CALCULATION_ERROR', '解決異常失敗', e.message);
  }
}

function apiGetDailyMealSummary(date, filters) {
  try {
    var summaries = SheetRepository.findRecords('DailyMealSummary', function(x) {
      return x.date === date && x.is_current === true;
    });
    return Utils.createResponse(true, summaries);
  } catch (e) {
    return Utils.createResponse(false, null, 'SUMMARY_ERROR', '載入餐數彙總失敗', e.message);
  }
}

function apiGetDailyMealLedger(date, filters) {
  try {
    AuthService.requireAnyRole(['system_admin', 'lunch_admin', 'class_teacher', 'accountant']);
    var identity = AuthService.getCurrentIdentity();
    
    var ledgers = SheetRepository.findRecords('DailyMealLedger', function(x) {
      return x.date === date && 
             (!filters.class_id || x.class_id === filters.class_id);
    });

    if (identity.role === 'class_teacher') {
      ledgers = ledgers.filter(function(x) {
        return x.class_id === identity.class_id;
      });
    }

    return Utils.createResponse(true, ledgers);
  } catch (e) {
    return Utils.createResponse(false, null, 'LEDGER_ERROR', '載入對帳明細失敗', e.message);
  }
}

function apiPreviewMonthlyReconciliation(yearMonth) {
  try {
    return Utils.createResponse(true, MonthlyReconciliationService.previewMonth(yearMonth));
  } catch (e) {
    return Utils.createResponse(false, null, 'RECON_ERROR', '對帳預覽失敗', e.message);
  }
}

function apiGetMonthlyReconciliation(yearMonth) {
  try {
    var list = SheetRepository.findRecords('MonthlyMealSummary', function(x) {
      return x.year_month === yearMonth && x.is_current === true;
    });
    return Utils.createResponse(true, list);
  } catch (e) {
    return Utils.createResponse(false, null, 'RECON_ERROR', '載入月度對帳失敗', e.message);
  }
}

function apiInstallDailyCalculationTrigger() {
  try {
    return Utils.createResponse(true, TriggerService.installDailyCalculationTrigger());
  } catch (e) {
    return Utils.createResponse(false, null, 'TRIGGER_ERROR', '啟用自動計算失敗', e.message);
  }
}

function apiRemoveDailyCalculationTrigger() {
  try {
    return Utils.createResponse(true, TriggerService.removeDailyCalculationTrigger());
  } catch (e) {
    return Utils.createResponse(false, null, 'TRIGGER_ERROR', '停用自動計算失敗', e.message);
  }
}

function apiListCalculationTriggers() {
  try {
    return Utils.createResponse(true, TriggerService.listProjectTriggers());
  } catch (e) {
    return Utils.createResponse(false, null, 'TRIGGER_ERROR', '載入排程狀態失敗', e.message);
  }
}

function apiCalculateMonthlyFunding(yearMonth) {
  try {
    var result = FundingCalculationService.calculateMonthlyFunding(yearMonth);
    return Utils.createResponse(true, result);
  } catch (e) {
    return Utils.createResponse(false, null, 'FUNDING_ERROR', '執行補助分攤失敗', e.message);
  }
}

function apiListFundingAllocations(filters) {
  try {
    var identity = AuthService.getCurrentIdentity();
    
    // 角色阻擋
    if (identity.role === 'viewer') {
      throw new Error('🛑 權限不足：檢視者 (viewer) 角色禁止存取最細粒度補助分攤明細帳冊！');
    }

    var list = SheetRepository.findRecords('FundingAllocationLedger', function(x) {
      return x.year_month === filters.year_month && 
             (!filters.class_id || x.class_id === filters.class_id) &&
             (!filters.funding_source || x.funding_source === filters.funding_source);
    });

    // 導師角色限班過濾
    if (identity.role === 'class_teacher') {
      list = list.filter(function(x) { return x.class_id === identity.class_id; });
    }

    // 遮罩處理 (非 admin 與導師時)
    list.forEach(function(r) {
      var student = StudentService.getStudent(r.student_id);
      var rawName = student ? student.student_name : '學生';
      
      // 遮罩處理：如林大明 -> 林○明
      if (identity.role === 'accountant' || identity.role === 'viewer') {
        var masked = rawName.charAt(0);
        if (rawName.length > 2) {
          masked += '○' + rawName.charAt(rawName.length - 1);
        } else {
          masked += '○';
        }
        r.student_name_masked = masked;
      } else {
        r.student_name_masked = rawName;
      }

      // 補上 class_code snapshot 供前端顯示
      var cls = SheetRepository.findById('Classes', 'class_id', r.class_id);
      r.class_code = cls ? cls.class_code : '---';
    });

    return Utils.createResponse(true, list);
  } catch (e) {
    return Utils.createResponse(false, null, 'LEDGER_ERROR', '載入明細帳冊失敗', e.message);
  }
}

function apiGetMonthlyFundingSummary(yearMonth) {
  try {
    var list = SheetRepository.findRecords('MonthlyFundingSummary', function(x) {
      return x.year_month === yearMonth && x.is_current === true;
    });

    list.forEach(function(r) {
      var cls = SheetRepository.findById('Classes', 'class_id', r.class_id);
      r.class_code = cls ? cls.class_code : '---';
    });

    return Utils.createResponse(true, list);
  } catch (e) {
    return Utils.createResponse(false, null, 'SUMMARY_ERROR', '載入月度彙整失敗', e.message);
  }
}

function apiGetCurrentClosing(yearMonth) {
  try {
    var result = MonthClosingService.getLatestClosing(yearMonth);
    return Utils.createResponse(true, result);
  } catch (e) {
    return Utils.createResponse(false, null, 'CLOSING_ERROR', '載入月結狀態失敗', e.message);
  }
}

function apiValidateClosing(yearMonth) {
  try {
    var readiness = MonthClosingService.validateClosingReadiness(yearMonth);
    
    // 預估分攤總金額
    var list = SheetRepository.findRecords('MonthlyFundingSummary', function(x) {
      return x.year_month === yearMonth && x.is_current === true;
    });
    
    var mealsCount = 0;
    var issuesCount = MonthlyReconciliationService.listOpenCalculationIssues(yearMonth).length;

    var sources = [
      { source: 'township', type: 'percentage', meals: 0, amount: 0, residual: 0 },
      { source: 'county', type: 'percentage', meals: 0, amount: 0, residual: 0 },
      { source: 'school', type: 'percentage', meals: 0, amount: 0, residual: 0 },
      { source: 'self_pay', type: 'fixed_amount', meals: 0, amount: 0, residual: 0 },
      { source: 'other', type: 'percentage', meals: 0, amount: 0, residual: 0 }
    ];

    sources.forEach(function(src) {
      var filtered = list.filter(function(x) { return x.funding_source === src.source; });
      src.meals = filtered.reduce(function(acc, x) { return acc + (parseInt(x.meal_count, 10) || 0); }, 0);
      src.amount = filtered.reduce(function(acc, x) { return acc + ((parseInt(x.final_amount_minor, 10) || 0) / 100); }, 0);
      src.residual = filtered.reduce(function(acc, x) { return acc + ((parseInt(x.residual_adjustment_minor, 10) || 0) / 100); }, 0);
      if (src.source === 'township' || src.source === 'county') mealsCount = Math.max(mealsCount, src.meals);
    });

    var version = list.length > 0 ? list[0].calculation_version : null;

    return Utils.createResponse(true, {
      readiness: readiness,
      version: version,
      mealsCount: mealsCount,
      issuesCount: issuesCount,
      sources: sources
    });
  } catch (e) {
    return Utils.createResponse(false, null, 'VALIDATE_ERROR', '月結就緒性檢驗失敗', e.message);
  }
}

function apiCloseMonth(yearMonth, confirmationText) {
  try {
    var result = MonthClosingService.closeMonth(yearMonth, confirmationText);
    return Utils.createResponse(true, result);
  } catch (e) {
    return Utils.createResponse(false, null, 'CLOSE_ERROR', '執行月結鎖定失敗', e.message);
  }
}

function apiReopenMonth(closingId, reason) {
  try {
    var result = MonthClosingService.reopenMonth(closingId, reason);
    return Utils.createResponse(true, result);
  } catch (e) {
    return Utils.createResponse(false, null, 'REOPEN_ERROR', '解除月結鎖定失敗', e.message);
  }
}

function apiListClosingHistory(yearMonth) {
  try {
    var list = MonthClosingService.listClosings();
    return Utils.createResponse(true, list);
  } catch (e) {
    return Utils.createResponse(false, null, 'HISTORY_ERROR', '載入月結歷史失敗', e.message);
  }
}

function apiGetClosingManifest(closingId) {
  try {
    var artifact = SheetRepository.findRecords('ClosingArtifacts', function(x) {
      return x.closing_id === closingId && x.artifact_type === 'closing_manifest';
    })[0];
    
    if (!artifact) throw new Error('找不到該月結版本的清單封存檔');
    
    var file = DriveApp.getFileById(artifact.file_id);
    var content = file.getAs('text/plain').getDataAsString();
    return Utils.createResponse(true, content);
  } catch (e) {
    return Utils.createResponse(false, null, 'MANIFEST_ERROR', '讀取清單 Manifest 失敗', e.message);
  }
}

function apiValidateClosing(closingId) {
  try {
    var result = MonthClosingService.validateClosing(closingId);
    return Utils.createResponse(true, result);
  } catch (e) {
    return Utils.createResponse(false, null, 'VALIDATE_ERROR', '審定就緒失敗', e.message);
  }
}

function apiListReportTemplates(reportType) {
  try {
    var result = ReportService.listReportTemplates(reportType);
    return Utils.createResponse(true, result);
  } catch (e) {
    return Utils.createResponse(false, null, 'TEMPLATE_ERROR', '取得範本清單失敗', e.message);
  }
}

function apiCreateReportTemplate(templateData) {
  try {
    var result = ReportService.createReportTemplate(templateData);
    return Utils.createResponse(true, result);
  } catch (e) {
    return Utils.createResponse(false, null, 'TEMPLATE_ERROR', '建立範本失敗', e.message);
  }
}

function apiApproveReportTemplate(templateId) {
  try {
    var result = ReportService.approveReportTemplate(templateId);
    return Utils.createResponse(true, result);
  } catch (e) {
    return Utils.createResponse(false, null, 'TEMPLATE_ERROR', '核准範本失敗', e.message);
  }
}

function apiRetireReportTemplate(templateId) {
  try {
    var result = ReportService.retireReportTemplate(templateId);
    return Utils.createResponse(true, result);
  } catch (e) {
    return Utils.createResponse(false, null, 'TEMPLATE_ERROR', '停用範本失敗', e.message);
  }
}

function apiGenerateReportPreview(closingId, reportType, templateId) {
  try {
    var result = ReportService.generatePreviewReport(closingId, reportType, templateId);
    return Utils.createResponse(true, result);
  } catch (e) {
    return Utils.createResponse(false, null, 'RENDER_ERROR', '產生預覽報表失敗', e.message);
  }
}

function apiGenerateOfficialReport(closingId, reportType, templateId) {
  try {
    var result = ReportService.generateOfficialReport(closingId, reportType, templateId);
    return Utils.createResponse(true, result);
  } catch (e) {
    return Utils.createResponse(false, null, 'RENDER_ERROR', '產生正式報表失敗', e.message);
  }
}

function apiListReportsByClosing(closingId) {
  try {
    var list = SheetRepository.findRecords('ReportGenerationRuns', function(x) {
      return x.closing_id === closingId;
    });
    return Utils.createResponse(true, list);
  } catch (e) {
    return Utils.createResponse(false, null, 'REPORT_ERROR', '取得報表歷史失敗', e.message);
  }
}

function apiApproveReport(reportRunId, stage, comment) {
  try {
    var result = ReportService.approveReport(reportRunId, stage, comment);
    return Utils.createResponse(true, result);
  } catch (e) {
    return Utils.createResponse(false, null, 'APPROVAL_ERROR', '報表核簽失敗', e.message);
  }
}

function apiRejectReport(reportRunId, stage, comment) {
  try {
    var result = ReportService.rejectReport(reportRunId, stage, comment);
    return Utils.createResponse(true, result);
  } catch (e) {
    return Utils.createResponse(false, null, 'APPROVAL_ERROR', '報表核退失敗', e.message);
  }
}

function apiListApprovalRecords(reportRunId) {
  try {
    var list = ReportService.listApprovalRecords(reportRunId);
    return Utils.createResponse(true, list);
  } catch (e) {
    return Utils.createResponse(false, null, 'APPROVAL_ERROR', '取得審查紀錄失敗', e.message);
  }
}

function apiPreviewSubsidyRateMigration() {
  try {
    var list = SubsidyRuleService.previewSubsidyRateMigration();
    return Utils.createResponse(true, list);
  } catch (e) {
    return Utils.createResponse(false, null, 'MIGRATION_ERROR', '預覽遷移失敗', e.message);
  }
}

function apiValidateSubsidyRateMigration() {
  try {
    var result = SubsidyRuleService.validateSubsidyRateMigration();
    return Utils.createResponse(true, result);
  } catch (e) {
    return Utils.createResponse(false, null, 'MIGRATION_ERROR', '驗證遷移失敗', e.message);
  }
}

function apiExecuteSubsidyRateMigration(confirmText) {
  try {
    var result = SubsidyRuleService.executeSubsidyRateMigration(confirmText);
    return Utils.createResponse(true, result);
  } catch (e) {
    return Utils.createResponse(false, null, 'MIGRATION_ERROR', '執行遷移失敗', e.message);
  }
}

function apiRollbackSubsidyRateMigration(migrationId) {
  try {
    var result = SubsidyRuleService.rollbackSubsidyRateMigration(migrationId);
    return Utils.createResponse(true, result);
  } catch (e) {
    return Utils.createResponse(false, null, 'MIGRATION_ERROR', '回滾遷移失敗', e.message);
  }
}

function apiExportSubsidyRateMigrationReport(migrationId) {
  try {
    var result = SubsidyRuleService.exportSubsidyRateMigrationReport(migrationId);
    return Utils.createResponse(true, result);
  } catch (e) {
    return Utils.createResponse(false, null, 'MIGRATION_ERROR', '匯出遷移報告失敗', e.message);
  }
}

function apiGetBootstrapStatus() {
  try {
    var result = BootstrapService.getBootstrapStatus();
    return Utils.createResponse(true, result);
  } catch (e) {
    return Utils.createResponse(false, null, 'BOOTSTRAP_ERROR', '載入初始化狀態失敗', e.message);
  }
}

function apiExecuteBootstrapStep(stepName, settings) {
  try {
    var result = BootstrapService.executeBootstrapStep(stepName, settings);
    return Utils.createResponse(true, result);
  } catch (e) {
    return Utils.createResponse(false, null, 'BOOTSTRAP_ERROR', '執行步驟 ' + stepName + ' 失敗', e.message);
  }
}

function apiResetBootstrap() {
  try {
    var result = BootstrapService.resetBootstrap();
    return Utils.createResponse(true, result);
  } catch (e) {
    return Utils.createResponse(false, null, 'BOOTSTRAP_ERROR', '重設初始化狀態失敗', e.message);
  }
}

function apiGetTriggerStatus() {
  try {
    var triggers = TriggerService.listProjectTriggers();
    var active = triggers.filter(function(t) { return t.handler === 'runScheduledDailyCalculation'; }).length > 0;
    return Utils.createResponse(true, { active: active, list: triggers });
  } catch (e) {
    return Utils.createResponse(false, null, 'TRIGGER_ERROR', '載入排程狀態失敗', e.message);
  }
}

function apiInstallDailyCalculationTrigger() {
  try {
    var result = TriggerService.installDailyCalculationTrigger();
    return Utils.createResponse(true, result);
  } catch (e) {
    return Utils.createResponse(false, null, 'TRIGGER_ERROR', '啟用定時排程失敗', e.message);
  }
}

function apiRemoveDailyCalculationTrigger() {
  try {
    var result = TriggerService.removeDailyCalculationTrigger();
    return Utils.createResponse(true, result);
  } catch (e) {
    return Utils.createResponse(false, null, 'TRIGGER_ERROR', '停用定時排程失敗', e.message);
  }
}


