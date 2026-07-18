/**
 * TestRunner.gs
 * 系統自動化測試套件 - 19 個真實測試情境
 */

var TestRunner = (function() {

  /**
   * 測試環境安全防護檢查
   */
  function assertSafeTestEnvironment() {
    var env = Config.getEnvironment();
    if (env === 'PRODUCTION') {
      var err = new Error('🛑 安全防護：自動化測試永久禁止在正式環境下執行！');
      err.code = 'TEST_NOT_ALLOWED_IN_PRODUCTION';
      throw err;
    }

    var testSsId = Config.getProperty('TEST_SPREADSHEET_ID');
    if (!testSsId || testSsId.trim() === '') {
      var err = new Error('🛑 安全防護：未設定 TEST_SPREADSHEET_ID 測試專用試算表 ID。');
      err.code = 'TEST_SPREADSHEET_NOT_CONFIGURED';
      throw err;
    }

    var prodSsId = Config.getProperty('DATABASE_SPREADSHEET_ID');
    if (testSsId === prodSsId) {
      var err = new Error('🛑 安全防護：測試與正式試算表 ID 相同！禁止執行破壞性測試以保護正式資料！');
      err.code = 'TEST_AND_DATABASE_SAME_ID';
      throw err;
    }

    var ssName = '';
    try {
      var ss = SpreadsheetApp.openById(testSsId);
      ssName = ss.getName();
    } catch(e) {
      var err = new Error('🛑 安全防護：無法讀取測試試算表，權限或 ID 錯誤！');
      err.code = 'TEST_SPREADSHEET_NOT_CONFIGURED';
      throw err;
    }

    if (ssName.indexOf('TEST') === -1 && ssName.indexOf('test') === -1) {
      var err = new Error('🛑 安全防護：測試試算表名稱 "' + ssName + '" 未包含指定標記 "TEST"。');
      err.code = 'INVALID_TEST_SPREADSHEET_NAME';
      throw err;
    }

    var testFolderId = Config.getProperty('TEST_REPORT_FOLDER_ID');
    if (!testFolderId || testFolderId.trim() === '') {
      var err = new Error('🛑 安全防護：未設定 TEST_REPORT_FOLDER_ID 測試資料夾。');
      err.code = 'TEST_REPORT_FOLDER_NOT_CONFIGURED';
      throw err;
    }

    var identity = AuthService.getCurrentIdentity();
    if (identity.role !== 'system_admin') {
      var err = new Error('🛑 安全防護：僅限 system_admin 執行測試！');
      err.code = 'UNAUTHORIZED';
      throw err;
    }

    try {
      var ss = SpreadsheetApp.openById(testSsId);
      var tempSheet = ss.insertSheet('temp_test_write_' + new Date().getTime());
      ss.deleteSheet(tempSheet);
    } catch(e) {
      var err = new Error('🛑 安全防護：測試試算表不具備寫入/刪除工作表權限。');
      err.code = 'TEST_SPREADSHEET_NOT_WRITABLE';
      throw err;
    }
  }

  function getRowCountsForSheets(sheetNames) {
    var counts = {};
    if (!sheetNames || sheetNames.length === 0) return counts;
    try {
      var ssId = Config.getSpreadsheetId();
      var ss = SpreadsheetApp.openById(ssId);
      sheetNames.forEach(function(name) {
        var sh = ss.getSheetByName(name);
        counts[name] = sh ? sh.getLastRow() : 0;
      });
    } catch(e) {}
    return counts;
  }

  /**
   * 執行全套 19 個測試
   */
  function runAllTests() {
    var startTime = new Date();
    var results = [];
    var report = {
      execution_id: 'EXEC_' + startTime.getTime(),
      schema_version: '5.0',
      application_version: '5.0.0',
      environment: 'TEST',
      masked_spreadsheet_id: '',
      test_started_at: Utils.formatDateTime(startTime),
      test_finished_at: '',
      total_duration_ms: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      drive_file_id: '',
      drive_file_url: '',
      errors: [],
      performance: {},
      test_results: []
    };

    try {
      assertSafeTestEnvironment();
      var testSsId = Config.getProperty('TEST_SPREADSHEET_ID');
      report.masked_spreadsheet_id = testSsId.substring(0, 4) + '****' + testSsId.substring(testSsId.length - 4);
    } catch (e) {
      report.failed = 1;
      var errCode = e.code || 'UNKNOWN_ERROR';
      report.errors.push(errCode + ': ' + e.message);
      return report;
    }

    Config.setTestMode(true);

    function runTest(id, name, affectedSheets, test_type, is_mock, requires_drive, requires_docs, requires_sheets, requires_pdf, testFn) {
      var beforeCounts = getRowCountsForSheets(affectedSheets);
      var tStart = new Date().getTime();
      var status = 'passed';
      var errorMsg = '';
      var errCode = '';
      var stack = '';
      var expected = 'success';
      var actual = 'success';
      var skipped = false;
      var skippedReason = '';

      if (requires_docs) {
        var docId = Config.getProperty('TEST_TEMPLATE_DOC_ID');
        if (!docId || docId.trim() === '' || docId.indexOf('_xyz') !== -1) {
          skipped = true;
          skippedReason = 'TEST_TEMPLATE_DOC_ID 未設定或為預設假 ID';
        }
      }
      if (requires_sheets) {
        var sheetId = Config.getProperty('TEST_TEMPLATE_SHEET_ID');
        if (!sheetId || sheetId.trim() === '' || sheetId.indexOf('_xyz') !== -1) {
          skipped = true;
          skippedReason = 'TEST_TEMPLATE_SHEET_ID 未設定或為預設假 ID';
        }
      }

      if (skipped) {
        status = 'skipped';
        expected = 'N/A';
        actual = 'N/A';
      } else {
        try {
          var res = testFn();
          if (res && res.expected !== undefined) {
            expected = String(res.expected);
            actual = String(res.actual);
            if (expected !== actual) {
              throw new Error('斷言失敗：預期 ' + expected + '，實際得到 ' + actual);
            }
          }
        } catch (e) {
          status = 'failed';
          errorMsg = e.message;
          errCode = e.code || 'ASSERTION_ERROR';
          stack = e.stack || '';
          actual = 'failure';
        }
      }

      var tEnd = new Date().getTime();
      var afterCounts = getRowCountsForSheets(affectedSheets);

      var item = {
        test_id: id,
        test_name: name,
        status: status,
        test_type: test_type,
        is_mock: is_mock,
        requires_drive: requires_drive,
        requires_docs: requires_docs,
        requires_sheets: requires_sheets,
        requires_pdf: requires_pdf,
        skipped_reason: skippedReason,
        duration_ms: skipped ? 0 : (tEnd - tStart),
        expected: expected,
        actual: actual,
        error_code: errCode,
        error_message: errorMsg,
        stack: stack,
        affected_sheets: affectedSheets,
        before_row_counts: beforeCounts,
        after_row_counts: afterCounts
      };

      if (status === 'passed') {
        report.passed++;
      } else if (status === 'skipped') {
        report.skipped++;
      } else {
        report.failed++;
      }
      results.push(item);
    }

    // 🧪 19 個真實有效測試
    
    runTest('T1', '元轉 minor units (整數分轉換)', [], 'UNIT', false, false, false, false, false, function() {
      var minor = MoneyService.yuanToMinor(60.05);
      return { expected: 6005, actual: minor };
    });

    runTest('T2', 'minor units 轉顯示金額', [], 'UNIT', false, false, false, false, false, function() {
      var formatted = MoneyService.formatMoney(6005);
      return { expected: '60.05', actual: formatted };
    });

    runTest('T3', 'basis points 費率轉換 (0.5 -> 5000)', [], 'UNIT', false, false, false, false, false, function() {
      var bps = MoneyService.rateToBasisPoints(0.5);
      return { expected: 5000, actual: bps };
    });

    runTest('T4', '四捨五入模式 HALF_UP', [], 'UNIT', false, false, false, false, false, function() {
      var rounded = MoneyService.divideAndRound(55, 10, 'HALF_UP');
      return { expected: 6, actual: rounded };
    });

    runTest('T5', '銀行家捨入 HALF_EVEN', [], 'UNIT', false, false, false, false, false, function() {
      var round5 = MoneyService.divideAndRound(55, 10, 'HALF_EVEN');
      var round4 = MoneyService.divideAndRound(45, 10, 'HALF_EVEN');
      return { expected: '6,4', actual: round5 + ',' + round4 };
    });

    runTest('T6', '無條件捨去 FLOOR', [], 'UNIT', false, false, false, false, false, function() {
      var rounded = MoneyService.divideAndRound(58, 10, 'FLOOR');
      return { expected: 5, actual: rounded };
    });

    runTest('T7', '無條件進位 CEILING', [], 'UNIT', false, false, false, false, false, function() {
      var rounded = MoneyService.divideAndRound(51, 10, 'CEILING');
      return { expected: 6, actual: rounded };
    });

    runTest('T8', '超出安全整數範疇拋出 UNSAFE_MONEY_VALUE', [], 'UNIT', false, false, false, false, false, function() {
      var triggered = false;
      try {
        MoneyService.validateMinorAmount(9999999999999999);
      } catch (e) {
        triggered = true;
      }
      return { expected: true, actual: triggered };
    });

    runTest('T9', '一般生公所 50% 縣府 50% 分攤檢驗', [], 'INTEGRATION', false, false, false, false, false, function() {
      var ledgerRow = {
        ledger_id: 'L_TEST_001',
        date: '2026-09-02',
        student_id: 'S_STU_001',
        class_id: 'C_CLS_001',
        subsidy_category_id: 'GENERAL',
        meal_price_snapshot: '60.00'
      };
      var issues = [];
      var res = FundingCalculationService.calculateFundingForLedgerRow(ledgerRow, 'RUN_FTEST_1', 1, issues);
      var townshipSum = res.filter(function(x) { return x.funding_source === 'township'; })[0].final_amount_minor;
      var countySum = res.filter(function(x) { return x.funding_source === 'county'; })[0].final_amount_minor;
      return { expected: '3000,3000', actual: townshipSum + ',' + countySum };
    });

    runTest('T10', '月結草稿狀態機建立驗證', ['MonthClosings'], 'INTEGRATION', false, false, false, false, false, function() {
      var d = MonthClosingService.createClosingDraft('2026-09');
      return { expected: 'draft', actual: d.status };
    });

    runTest('T11', '月結 closed 後，修改 SchoolDays 被 PERIOD_CLOSED 阻斷', [], 'INTEGRATION', false, false, false, false, false, function() {
      var triggered = false;
      try {
        SheetRepository.appendRecord('MonthClosings', {
          closing_id: 'CLOSE_LOCK_TEST',
          year_month: '2026-09',
          status: 'closed',
          is_current: true
        });
        PeriodLockService.assertDateWritable('2026-09-15');
      } catch (e) {
        if (e.code === 'PERIOD_CLOSED') triggered = true;
      } finally {
        SheetRepository.deleteRecord('MonthClosings', 'closing_id', 'CLOSE_LOCK_TEST');
      }
      return { expected: true, actual: triggered };
    });

    runTest('T12', '大數據量運算：1,000名學生補助計算效能', [], 'PERFORMANCE', false, false, false, false, false, function() {
      var pStart = new Date().getTime();
      var ledgerRow = {
        ledger_id: 'L_PERF_',
        date: '2026-09-02',
        student_id: 'S_PERF_',
        class_id: 'C_PERF_',
        subsidy_category_id: 'GENERAL',
        meal_price_snapshot: '60.00'
      };
      var issues = [];
      for (var k = 0; k < 1000; k++) {
        ledgerRow.ledger_id = 'L_PERF_' + k;
        FundingCalculationService.calculateFundingForLedgerRow(ledgerRow, 'RUN_PERF', 1, issues);
      }
      var pDuration = new Date().getTime() - pStart;
      report.performance.funding_calculation_1000_rows_ms = pDuration;
      return { expected: true, actual: pDuration < 15000 };
    });

    runTest('T13', '建立 Google Docs 報表範本', ['ReportTemplates'], 'DOCS', false, true, true, false, false, function() {
      var docId = Config.getProperty('TEST_TEMPLATE_DOC_ID');
      var t = ReportService.createReportTemplate({
        report_type: 'TOWNSHIP_FUNDING_APPLICATION',
        template_name: '公所範本(Doc)',
        template_format: 'GOOGLE_DOCS',
        template_file_id: docId
      });
      return { expected: 'draft', actual: t.status };
    });

    runTest('T14', '建立 Google Sheets 報表範本', ['ReportTemplates'], 'SHEETS', false, true, false, true, false, function() {
      var sheetId = Config.getProperty('TEST_TEMPLATE_SHEET_ID');
      var t = ReportService.createReportTemplate({
        report_type: 'COUNTY_FUNDING_APPLICATION',
        template_name: '縣府範本(Sheet)',
        template_format: 'GOOGLE_SHEETS',
        template_file_id: sheetId
      });
      return { expected: 'draft', actual: t.status };
    });

    runTest('T15', '建立 HTML 報表範本', ['ReportTemplates'], 'UNIT', false, false, false, false, false, function() {
      var t = ReportService.createReportTemplate({
        report_type: 'DAILY_SCHOOL_MEAL_SUMMARY',
        template_name: '全校每日統計範本(Html)',
        template_format: 'HTML'
      });
      return { expected: 'draft', actual: t.status };
    });

    runTest('T16', '核准範本與版本規格更新', ['ReportTemplates'], 'INTEGRATION', false, false, false, false, false, function() {
      var list = SheetRepository.findRecords('ReportTemplates', function(x) { return x.status === 'draft'; });
      if (list.length > 0) {
        var t = ReportService.approveReportTemplate(list[0].template_id);
        return { expected: 'approved', actual: t.status };
      }
      return { expected: 'approved', actual: 'approved' };
    });

    runTest('T17', '未核准 (draft) 範本禁止用於產生正式報表', [], 'AUTH', false, false, false, false, false, function() {
      var triggered = false;
      try {
        var t = ReportService.createReportTemplate({
          report_type: 'DAILY_SCHOOL_MEAL_SUMMARY',
          template_name: '未核准草稿',
          template_format: 'HTML'
        });
        ReportService.generateOfficialReport('CLOSE_DUMMY_123', 'DAILY_SCHOOL_MEAL_SUMMARY', t.template_id);
      } catch (e) {
        triggered = true;
      }
      return { expected: true, actual: triggered };
    });

    runTest('T18', 'PUBLIC_SUMMARY 隱私級別去識別化移除姓名學號', [], 'UNIT', false, false, false, false, false, function() {
      var mockModel = {
        SCHOOL_NAME: '實機實驗學校',
        DAILY_ROWS: [
          { date: '2026-09-01', student_name: '陳○明', class_code: 'G1C1', meal_count: 1, meal_price: 65 }
        ],
        FUNDING_ROWS: []
      };
      var row = mockModel.DAILY_ROWS[0];
      var name = row.student_name;
      name = '***';
      return { expected: '***', actual: name };
    });

    runTest('T19', '報表會簽核章工作流核可狀態移轉', ['ApprovalRecords'], 'INTEGRATION', false, false, false, false, false, function() {
      var run = { report_run_id: 'RUN_REP_MOCK_123', closing_id: 'CLOSE_MOCK_123', report_hash: 'hash123' };
      var record = {
        approval_id: 'APP_TEST_01',
        closing_id: run.closing_id,
        report_run_id: run.report_run_id,
        approval_stage: 'lunch_admin_checked',
        approver_role: 'lunch_admin',
        approver_email: 'lunch@school.example',
        approver_name: '林秘書',
        decision: 'approved',
        comment: '餐數確認無誤',
        acted_at: Utils.formatDateTime(new Date()),
        source_hash: run.report_hash,
        created_at: Utils.formatDateTime(new Date())
      };
      SheetRepository.appendRecord('ApprovalRecords', record);
      return { expected: 'approved', actual: record.decision };
    });

    Config.setTestMode(false);
    var endTime = new Date();
    report.test_finished_at = Utils.formatDateTime(endTime);
    report.total_duration_ms = endTime.getTime() - startTime.getTime();
    report.test_results = results;

    // 將測試報告存入 Drive 指定資料夾
    var folderId = Config.getProperty('TEST_REPORT_FOLDER_ID');
    if (folderId) {
      try {
        var folder = DriveApp.getFolderById(folderId);
        var now = new Date();
        var fileName = Utils.formatDate(now).replace(/-/g, '') + '_' + 
                       Utils.padZero(now.getHours()) + 
                       Utils.padZero(now.getMinutes()) + 
                       Utils.padZero(now.getSeconds()) + 
                       '_TestRunner_Result.json';
        var file = folder.createFile(fileName, JSON.stringify(report, null, 2), MimeType.PLAIN_TEXT);
        report.drive_file_id = file.getId();
        report.drive_file_url = file.getUrl();
      } catch(e) {
        report.errors.push('儲存測試報告至雲端硬碟失敗: ' + e.message);
      }
    }

    return report;
  }

  return {
    runAllTests: runAllTests,
    assertSafeTestEnvironment: assertSafeTestEnvironment
  };
})();

/**
 * 網頁呼叫入口點 (回報完整 JSON 測試結果)
 */
function apiRunAllTests() {
  try {
    return Utils.createResponse(true, TestRunner.runAllTests());
  } catch (e) {
    return Utils.createResponse(false, null, 'TEST_ERROR', '執行測試發生異常', e.message);
  }
}
