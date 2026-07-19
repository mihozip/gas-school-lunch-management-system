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

    // 驗證測試模式隔離
    Config.setTestMode(true);
    if (Config.getReportRootFolderId() !== testFolderId) {
      var err = new Error('🛑 安全防護：測試模式下 getReportRootFolderId 未回傳 TEST_REPORT_FOLDER_ID。');
      err.code = 'TEST_ISOLATION_FAILED';
      throw err;
    }
    Config.setTestMode(false);

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

  function listActiveFilesByPrefix(folder, prefix) {
    var files = [];
    var iter = folder.getFiles();
    while (iter.hasNext()) {
      var f = iter.next();
      if (f.getName().indexOf(prefix) === 0 && !f.isTrashed()) {
        files.push(f);
      }
    }
    return files;
  }

  function assertNoNewActiveFiles(folder, prefix, beforeIds) {
    var files = listActiveFilesByPrefix(folder, prefix);
    var leaked = [];
    files.forEach(function(f) {
      if (beforeIds.indexOf(f.getId()) === -1) {
        leaked.push(f.getId());
      }
    });
    if (leaked.length > 0) {
      throw new Error('🛑 偵測到殘留暫存檔案數量：' + leaked.length);
    }
  }

  function getOrCreateSubFolder(parent, name) {
    var folders = parent.getFoldersByName(name);
    if (folders.hasNext()) {
      return folders.next();
    }
    return parent.createFolder(name);
  }

  function cleanupFiles(files) {
    if (!files || files.length === 0) return;
    var errors = [];
    files.forEach(function(item) {
      if (item && item.file) {
        try {
          item.file.setTrashed(true);
          if (!item.file.isTrashed()) {
            errors.push('🛑 檔案清理失敗，未被置入垃圾桶：' + item.name + ' (' + item.file.getId() + ')');
          }
        } catch(e) {
          errors.push('🛑 檔案清理異常：' + item.name + ' (' + (item.file.getId ? item.file.getId() : 'unknown') + ')，錯誤：' + e.message);
        }
      }
    });
    if (errors.length > 0) {
      throw new Error(errors.join('; '));
    }
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

    var uatFolderId = Config.getProperty('REPORT_ROOT_FOLDER_ID');
    var initialUatFileCount = 0;
    if (uatFolderId) {
      try {
        var uatFolder = DriveApp.getFolderById(uatFolderId);
        var filesIter = uatFolder.getFiles();
        while (filesIter.hasNext()) {
          filesIter.next();
          initialUatFileCount++;
        }
      } catch (e) {}
    }

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
    try {
      runTest('T1', '元轉 minor units 嚴格轉換與錯誤排除', [], 'UNIT', false, false, false, false, false, function() {
      var minor = MoneyService.yuanToMinorStrict('60.05', 'test_field');
      
      var errors = [];
      
      try {
        MoneyService.yuanToMinorStrict('abc', 'test_field');
        errors.push('abc passed');
      } catch(e) {
        if (e.code !== 'MONEY_INVALID_DECIMAL') errors.push('abc code: ' + e.code);
      }
      
      try {
        MoneyService.yuanToMinorStrict('--', 'test_field');
        errors.push('-- passed');
      } catch(e) {
        if (e.code !== 'MONEY_INVALID_DECIMAL') errors.push('-- code: ' + e.code);
      }
      
      try {
        MoneyService.yuanToMinorStrict('1e2', 'test_field');
        errors.push('1e2 passed');
      } catch(e) {
        if (e.code !== 'MONEY_INVALID_DECIMAL') errors.push('1e2 code: ' + e.code);
      }
      
      try {
        MoneyService.yuanToMinorStrict('60.001', 'test_field');
        errors.push('60.001 passed');
      } catch(e) {
        if (e.code !== 'MONEY_PRECISION_EXCEEDED') errors.push('60.001 code: ' + e.code);
      }
      
      try {
        MoneyService.yuanToMinorStrict('-60', 'test_field');
        errors.push('-60 passed');
      } catch(e) {
        if (e.code !== 'MONEY_NEGATIVE_NOT_ALLOWED') errors.push('-60 code: ' + e.code);
      }
      
      try {
        MoneyService.parseMinorStrict('6000.9', 'test_field');
        errors.push('6000.9 passed');
      } catch(e) {
        if (e.code !== 'MONEY_INVALID_INTEGER') errors.push('6000.9 code: ' + e.code);
      }
      
      var val8 = MoneyService.firstPresentValue({ amount: 0, fallback: 999 }, ['amount', 'fallback']);
      if (val8 !== 0) errors.push('val8: ' + val8);
      
      var val9 = MoneyService.parseMinorStrict('-1', 'test_field', { allowNegative: true });
      if (val9 !== -1) errors.push('val9: ' + val9);
      
      var actualStr = errors.length === 0 ? 'SUCCESS' : errors.join('; ');
      return { expected: '6005,SUCCESS', actual: minor + ',' + actualStr };
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

    runTest('T9', '一般生公所 50% 縣府 50% 分攤檢驗', ['SubsidyCategories', 'SubsidyRules'], 'INTEGRATION', false, false, false, false, false, function() {
      var testRunId = Utils.generateUUID();
      var suffix = testRunId.substring(0, 8);
      var categoryId = 'CAT_T9_' + suffix;
      var ruleTownId = 'RULE_TOWN_T9_' + suffix;
      var ruleCountyId = 'RULE_COUNTY_T9_' + suffix;
      var ruleTempId = 'RULE_TEMP_T9_' + suffix;

      try {
        SheetRepository.appendRecord('SubsidyCategories', {
          subsidy_category_id: categoryId,
          category_name: 'GENERAL_TEST_' + suffix,
          description: 'T9 Test Category'
        });

        SheetRepository.appendRecord('SubsidyRules', {
          subsidy_rule_id: ruleTownId,
          subsidy_category_id: categoryId,
          funding_source: 'township',
          calculation_type: 'percentage',
          subsidy_rate: 5000,
          subsidy_amount: 0,
          effective_start_date: '2026-01-01',
          effective_end_date: '2026-12-31',
          enabled: true
        });

        SheetRepository.appendRecord('SubsidyRules', {
          subsidy_rule_id: ruleCountyId,
          subsidy_category_id: categoryId,
          funding_source: 'county',
          calculation_type: 'percentage',
          subsidy_rate: 5000,
          subsidy_amount: 0,
          effective_start_date: '2026-01-01',
          effective_end_date: '2026-12-31',
          enabled: true
        });

        var ledgerRow = {
          ledger_id: 'L_TEST_001',
          date: '2026-09-02',
          student_id: 'S_STU_001',
          class_id: 'C_CLS_001',
          subsidy_category_id: categoryId,
          meal_price_snapshot: '60.00'
        };
        var issues = [];
        var res = FundingCalculationService.calculateFundingForLedgerRow(ledgerRow, 'RUN_FTEST_1', 1, issues);
        var townshipSum = res.filter(function(x) { return x.funding_source === 'township'; })[0].final_amount_minor;
        var countySum = res.filter(function(x) { return x.funding_source === 'county'; })[0].final_amount_minor;

        // 負向測試 1: meal_price_snapshot = '60abc'
        var triggeredNeg1 = false;
        var errCodeNeg1 = '';
        try {
          var ledgerNeg1 = {
            ledger_id: 'L_TEST_NEG1',
            date: '2026-09-02',
            student_id: 'S_STU_001',
            class_id: 'C_CLS_001',
            subsidy_category_id: categoryId,
            meal_price_snapshot: '60abc'
          };
          FundingCalculationService.calculateFundingForLedgerRow(ledgerNeg1, 'RUN_FTEST_NEG1', 1, []);
        } catch (e) {
          triggeredNeg1 = true;
          errCodeNeg1 = e.code || e.message;
        }

        // 負向測試 2: meal_price_snapshot = 'abc'
        var triggeredNeg2 = false;
        var errCodeNeg2 = '';
        try {
          var ledgerNeg2 = {
            ledger_id: 'L_TEST_NEG2',
            date: '2026-09-02',
            student_id: 'S_STU_001',
            class_id: 'C_CLS_001',
            subsidy_category_id: categoryId,
            meal_price_snapshot: 'abc'
          };
          FundingCalculationService.calculateFundingForLedgerRow(ledgerNeg2, 'RUN_FTEST_NEG2', 1, []);
        } catch (e) {
          triggeredNeg2 = true;
          errCodeNeg2 = e.code || e.message;
        }

        // 負向測試 3: subsidy_rate = '5000.5' (費率驗證錯誤)
        var triggeredNeg3 = false;
        var errCodeNeg3 = '';
        try {
          SheetRepository.appendRecord('SubsidyRules', {
            subsidy_rule_id: ruleTempId,
            subsidy_category_id: categoryId,
            funding_source: 'township',
            calculation_type: 'percentage',
            subsidy_rate: '5000.5',
            subsidy_amount: 0,
            effective_start_date: '2026-01-01',
            effective_end_date: '2026-12-31',
            enabled: true
          });
          var ledgerNeg3 = {
            ledger_id: 'L_TEST_NEG3',
            date: '2026-09-02',
            student_id: 'S_STU_001',
            class_id: 'C_CLS_001',
            subsidy_category_id: categoryId,
            meal_price_snapshot: '60.00'
          };
          FundingCalculationService.calculateFundingForLedgerRow(ledgerNeg3, 'RUN_FTEST_NEG3', 1, []);
        } catch (e) {
          triggeredNeg3 = true;
          errCodeNeg3 = e.code || e.message;
        } finally {
          SheetRepository.deleteRecordById('SubsidyRules', 'subsidy_rule_id', ruleTempId);
        }

        var actualStr = townshipSum + ',' + countySum + ',' + triggeredNeg1 + ',' + errCodeNeg1 + ',' + triggeredNeg2 + ',' + errCodeNeg2 + ',' + triggeredNeg3 + ',' + errCodeNeg3;
        var expectedStr = '3000,3000,true,MONEY_INVALID_DECIMAL,true,MONEY_INVALID_DECIMAL,true,SUBSIDY_RATE_INVALID';
        return { expected: expectedStr, actual: actualStr };
      } finally {
        SheetRepository.deleteRecordById('SubsidyRules', 'subsidy_rule_id', ruleTownId);
        SheetRepository.deleteRecordById('SubsidyRules', 'subsidy_rule_id', ruleCountyId);
        SheetRepository.deleteRecordById('SubsidyCategories', 'subsidy_category_id', categoryId);
      }
    });

    runTest('T10', '月結草稿狀態機建立驗證', ['MonthClosings'], 'INTEGRATION', false, false, false, false, false, function() {
      var randomYear = 2030 + Math.floor(Math.random() * 100);
      var uniqueYearMonth = randomYear + '-09';
      var draft;
      try {
        draft = MonthClosingService.createClosingDraft(uniqueYearMonth);
        return { expected: 'draft', actual: draft.status };
      } finally {
        if (draft && draft.closing_id) {
          SheetRepository.deleteRecordById('MonthClosings', 'closing_id', draft.closing_id);
        }
      }
    });

    runTest('T11', '月結 closed 後，修改 SchoolDays 被 PERIOD_CLOSED 阻斷', ['MonthClosings'], 'INTEGRATION', false, false, false, false, false, function() {
      var testRunId = Utils.generateUUID();
      var suffix = testRunId.substring(0, 8);
      var closingId = 'CLOSE_LOCK_TEST_' + suffix;
      var triggered = false;
      try {
        SheetRepository.appendRecord('MonthClosings', {
          closing_id: closingId,
          year_month: '2026-09',
          status: 'closed',
          is_current: true
        });
        PeriodLockService.assertDateWritable('2026-09-15');
      } catch (e) {
        if (e.code === 'PERIOD_CLOSED') triggered = true;
      } finally {
        SheetRepository.deleteRecordById('MonthClosings', 'closing_id', closingId);
      }
      return { expected: true, actual: triggered };
    });

    runTest('T12', '大數據量運算：1,000名學生補助計算效能', ['SubsidyCategories', 'SubsidyRules'], 'PERFORMANCE', false, false, false, false, false, function() {
      var testRunId = Utils.generateUUID();
      var suffix = testRunId.substring(0, 8);
      var categoryId = 'CAT_T12_' + suffix;
      var ruleTownId = 'RULE_TOWN_T12_' + suffix;
      var ruleCountyId = 'RULE_COUNTY_T12_' + suffix;

      try {
        SheetRepository.appendRecord('SubsidyCategories', {
          subsidy_category_id: categoryId,
          category_name: 'GENERAL_TEST_PERF_' + suffix,
          description: 'T12 Test Category'
        });

        SheetRepository.appendRecord('SubsidyRules', {
          subsidy_rule_id: ruleTownId,
          subsidy_category_id: categoryId,
          funding_source: 'township',
          calculation_type: 'percentage',
          subsidy_rate: 5000,
          subsidy_amount: 0,
          effective_start_date: '2026-01-01',
          effective_end_date: '2026-12-31',
          enabled: true
        });

        SheetRepository.appendRecord('SubsidyRules', {
          subsidy_rule_id: ruleCountyId,
          subsidy_category_id: categoryId,
          funding_source: 'county',
          calculation_type: 'percentage',
          subsidy_rate: 5000,
          subsidy_amount: 0,
          effective_start_date: '2026-01-01',
          effective_end_date: '2026-12-31',
          enabled: true
        });

        var pStart = new Date().getTime();
        var ledgerRow = {
          ledger_id: 'L_PERF_',
          date: '2026-09-02',
          student_id: 'S_PERF_',
          class_id: 'C_PERF_',
          subsidy_category_id: categoryId,
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
      } finally {
        SheetRepository.deleteRecordById('SubsidyRules', 'subsidy_rule_id', ruleTownId);
        SheetRepository.deleteRecordById('SubsidyRules', 'subsidy_rule_id', ruleCountyId);
        SheetRepository.deleteRecordById('SubsidyCategories', 'subsidy_category_id', categoryId);
      }
    });

    runTest('T13', '實際呼叫 Docs Renderer 產生 PDF 報表', ['MonthClosings', 'ClosingArtifacts', 'ReportTemplates'], 'DOCS', false, true, true, false, true, function() {
      var docId = Config.getProperty('TEST_TEMPLATE_DOC_ID');
      var testRunId = Utils.generateUUID();
      var suffix = testRunId.substring(0, 8);
      var closingId = 'CLOSE_T13_' + suffix;
      var templateId = 'TMP_T13_' + suffix;
      var artL = 'ART_T13_L_' + suffix;
      var artA = 'ART_T13_A_' + suffix;
      var artS = 'ART_T13_S_' + suffix;
      
      var res;
      var pdfFile;
      var fLedger, fAlloc, fSummary;
      var mimeType = '';
      var size = 0;
      var tempFileCleaned = false;
      var negativeCheckSuccess = false;

      var folderId = Config.getReportRootFolderId();
      var testFolder = DriveApp.getFolderById(folderId);
      var previewsFolder = getOrCreateSubFolder(testFolder, 'previews_temp');

      // Record active file IDs before rendering
      var prefix = 'temp_render_doc_';
      var beforeFiles = listActiveFilesByPrefix(previewsFolder, prefix);
      var beforeFileIds = beforeFiles.map(function(f) { return f.getId(); });

      try {
        // 1. 建立 closed closing fixture
        SheetRepository.appendRecord('MonthClosings', {
          closing_id: closingId,
          year_month: '2026-09',
          status: 'closed',
          is_current: true,
          gross_amount_minor: 6000,
          meal_count_total: 1
        });

        // 2. 建立真實的 CSV 檔案 (隔離在 previewsFolder)
        fLedger = previewsFolder.createFile('temp_t13_ledger_' + testRunId + '.csv', 
          'eligible_meal_count,student_name,student_name_masked,date,class_code_snapshot,meal_price_snapshot,meal_price_minor_snapshot\n1,陳小明,陳○明,2026-09-01,G1C1,60.00,6000',
          MimeType.PLAIN_TEXT);
        fAlloc = previewsFolder.createFile('temp_t13_alloc_' + testRunId + '.csv',
          'funding_source,settlement_amount_minor,final_amount_minor\ntownship,6000,6000',
          MimeType.PLAIN_TEXT);
        fSummary = previewsFolder.createFile('temp_t13_summary_' + testRunId + '.csv',
          'funding_source,settlement_total_minor,final_amount_minor,gross_amount_minor,meal_count\ntownship,6000,6000,6000,1',
          MimeType.PLAIN_TEXT);

        // 3. 建立必要 artifacts
        SheetRepository.appendRecord('ClosingArtifacts', {
          artifact_id: artL,
          closing_id: closingId,
          year_month: '2026-09',
          artifact_type: 'dailyMealLedger_export',
          file_id: fLedger.getId(),
          archived: false,
          enabled: true
        });

        SheetRepository.appendRecord('ClosingArtifacts', {
          artifact_id: artA,
          closing_id: closingId,
          year_month: '2026-09',
          artifact_type: 'fundingAllocationLedger_export',
          file_id: fAlloc.getId(),
          archived: false,
          enabled: true
        });

        SheetRepository.appendRecord('ClosingArtifacts', {
          artifact_id: artS,
          closing_id: closingId,
          year_month: '2026-09',
          artifact_type: 'monthlyFundingSummary_export',
          file_id: fSummary.getId(),
          archived: false,
          enabled: true
        });

        // 4. 建立範本
        SheetRepository.appendRecord('ReportTemplates', {
          template_id: templateId,
          report_type: 'TOWNSHIP_FUNDING_APPLICATION',
          template_name: '公所範本(Doc)',
          template_format: 'GOOGLE_DOCS',
          template_file_id: docId,
          status: 'approved',
          enabled: true
        });

        // 5. 呼叫 generatePreviewReport
        res = ReportService.generatePreviewReport(closingId, 'TOWNSHIP_FUNDING_APPLICATION', templateId);
        
        if (res && res.fileId) {
          pdfFile = DriveApp.getFileById(res.fileId);
          mimeType = pdfFile.getMimeType();
          size = pdfFile.getSize();
          
          try {
            assertNoNewActiveFiles(previewsFolder, prefix, beforeFileIds);
            tempFileCleaned = true;
          } catch (e) {
            tempFileCleaned = false;
          }
        }

        // 6. 負向測試：建立一個未刪除的假 temp 檔案，驗證清理檢查是否正確拋出錯誤 (回傳 negativeCheckSuccess = true)
        var fakeFile = previewsFolder.createFile(prefix + 'fake_' + testRunId + '.doc', 'dummy', MimeType.PLAIN_TEXT);
        try {
          try {
            assertNoNewActiveFiles(previewsFolder, prefix, beforeFileIds);
            negativeCheckSuccess = false;
          } catch (e) {
            negativeCheckSuccess = true;
          }
        } finally {
          cleanupFiles([{ file: fakeFile, name: 'fakeFile' }]);
        }

      } finally {
        var cleanupErrors = [];
        try {
          cleanupFiles([
            { file: pdfFile, name: 'pdfFile' },
            { file: fLedger, name: 'fLedger' },
            { file: fAlloc, name: 'fAlloc' },
            { file: fSummary, name: 'fSummary' }
          ]);
        } catch(e) {
          cleanupErrors.push(e.message);
        }
        
        try { SheetRepository.deleteRecordById('MonthClosings', 'closing_id', closingId); } catch(e) { cleanupErrors.push(e.message); }
        try { SheetRepository.deleteRecordById('ReportTemplates', 'template_id', templateId); } catch(e) { cleanupErrors.push(e.message); }
        try { SheetRepository.deleteRecordById('ClosingArtifacts', 'artifact_id', artL); } catch(e) { cleanupErrors.push(e.message); }
        try { SheetRepository.deleteRecordById('ClosingArtifacts', 'artifact_id', artA); } catch(e) { cleanupErrors.push(e.message); }
        try { SheetRepository.deleteRecordById('ClosingArtifacts', 'artifact_id', artS); } catch(e) { cleanupErrors.push(e.message); }
        
        if (cleanupErrors.length > 0) {
          throw new Error(cleanupErrors.join('; '));
        }
      }

      var expectedStr = 'true,application/pdf,true,true,true';
      var actualStr = (!!res && res.success) + ',' + mimeType + ',' + (size > 0) + ',' + tempFileCleaned + ',' + negativeCheckSuccess;
      return { expected: expectedStr, actual: actualStr };
    });

    runTest('T14', '實際呼叫 Sheets Renderer 產生 PDF 報表', ['MonthClosings', 'ClosingArtifacts', 'ReportTemplates'], 'SHEETS', false, true, false, true, true, function() {
      var sheetId = Config.getProperty('TEST_TEMPLATE_SHEET_ID');
      var testRunId = Utils.generateUUID();
      var suffix = testRunId.substring(0, 8);
      var closingId = 'CLOSE_T14_' + suffix;
      var templateId = 'TMP_T14_' + suffix;
      var artL = 'ART_T14_L_' + suffix;
      var artA = 'ART_T14_A_' + suffix;
      var artS = 'ART_T14_S_' + suffix;
      
      var res;
      var pdfFile;
      var fLedger, fAlloc, fSummary;
      var mimeType = '';
      var size = 0;
      var tempFileCleaned = false;
      var negativeCheckSuccess = false;

      var folderId = Config.getReportRootFolderId();
      var testFolder = DriveApp.getFolderById(folderId);
      var previewsFolder = getOrCreateSubFolder(testFolder, 'previews_temp');

      // Record active file IDs before rendering
      var prefix = 'temp_render_sheet_';
      var beforeFiles = listActiveFilesByPrefix(previewsFolder, prefix);
      var beforeFileIds = beforeFiles.map(function(f) { return f.getId(); });

      try {
        // 1. 建立 closed closing fixture
        SheetRepository.appendRecord('MonthClosings', {
          closing_id: closingId,
          year_month: '2026-09',
          status: 'closed',
          is_current: true,
          gross_amount_minor: 6000,
          meal_count_total: 1
        });

        // 2. 建立真實的 CSV 檔案 (隔離在 previewsFolder)
        fLedger = previewsFolder.createFile('temp_t14_ledger_' + testRunId + '.csv', 
          'eligible_meal_count,student_name,student_name_masked,date,class_code_snapshot,meal_price_snapshot,meal_price_minor_snapshot\n1,陳小明,陳○明,2026-09-01,G1C1,60.00,6000',
          MimeType.PLAIN_TEXT);
        fAlloc = previewsFolder.createFile('temp_t14_alloc_' + testRunId + '.csv',
          'funding_source,settlement_amount_minor,final_amount_minor\ntownship,6000,6000',
          MimeType.PLAIN_TEXT);
        fSummary = previewsFolder.createFile('temp_t14_summary_' + testRunId + '.csv',
          'funding_source,settlement_total_minor,final_amount_minor,gross_amount_minor,meal_count\ntownship,6000,6000,6000,1',
          MimeType.PLAIN_TEXT);

        // 3. 建立必要 artifacts
        SheetRepository.appendRecord('ClosingArtifacts', {
          artifact_id: artL,
          closing_id: closingId,
          year_month: '2026-09',
          artifact_type: 'dailyMealLedger_export',
          file_id: fLedger.getId(),
          archived: false,
          enabled: true
        });

        SheetRepository.appendRecord('ClosingArtifacts', {
          artifact_id: artA,
          closing_id: closingId,
          year_month: '2026-09',
          artifact_type: 'fundingAllocationLedger_export',
          file_id: fAlloc.getId(),
          archived: false,
          enabled: true
        });

        SheetRepository.appendRecord('ClosingArtifacts', {
          artifact_id: artS,
          closing_id: closingId,
          year_month: '2026-09',
          artifact_type: 'monthlyFundingSummary_export',
          file_id: fSummary.getId(),
          archived: false,
          enabled: true
        });

        // 4. 建立範本
        SheetRepository.appendRecord('ReportTemplates', {
          template_id: templateId,
          report_type: 'COUNTY_FUNDING_APPLICATION',
          template_name: '縣府範本(Sheet)',
          template_format: 'GOOGLE_SHEETS',
          template_file_id: sheetId,
          status: 'approved',
          enabled: true
        });

        // 5. 呼叫 generatePreviewReport
        res = ReportService.generatePreviewReport(closingId, 'COUNTY_FUNDING_APPLICATION', templateId);
        
        if (res && res.fileId) {
          pdfFile = DriveApp.getFileById(res.fileId);
          mimeType = pdfFile.getMimeType();
          size = pdfFile.getSize();
          
          try {
            assertNoNewActiveFiles(previewsFolder, prefix, beforeFileIds);
            tempFileCleaned = true;
          } catch (e) {
            tempFileCleaned = false;
          }
        }

        // 6. 負向測試：建立一個未刪除的假 temp 檔案，驗證清理檢查是否正確拋出錯誤 (回傳 negativeCheckSuccess = true)
        var fakeFile = previewsFolder.createFile(prefix + 'fake_' + testRunId + '.sheet', 'dummy', MimeType.PLAIN_TEXT);
        try {
          try {
            assertNoNewActiveFiles(previewsFolder, prefix, beforeFileIds);
            negativeCheckSuccess = false;
          } catch (e) {
            negativeCheckSuccess = true;
          }
        } finally {
          cleanupFiles([{ file: fakeFile, name: 'fakeFile' }]);
        }

      } finally {
        var cleanupErrors = [];
        try {
          cleanupFiles([
            { file: pdfFile, name: 'pdfFile' },
            { file: fLedger, name: 'fLedger' },
            { file: fAlloc, name: 'fAlloc' },
            { file: fSummary, name: 'fSummary' }
          ]);
        } catch(e) {
          cleanupErrors.push(e.message);
        }
        
        try { SheetRepository.deleteRecordById('MonthClosings', 'closing_id', closingId); } catch(e) { cleanupErrors.push(e.message); }
        try { SheetRepository.deleteRecordById('ReportTemplates', 'template_id', templateId); } catch(e) { cleanupErrors.push(e.message); }
        try { SheetRepository.deleteRecordById('ClosingArtifacts', 'artifact_id', artL); } catch(e) { cleanupErrors.push(e.message); }
        try { SheetRepository.deleteRecordById('ClosingArtifacts', 'artifact_id', artA); } catch(e) { cleanupErrors.push(e.message); }
        try { SheetRepository.deleteRecordById('ClosingArtifacts', 'artifact_id', artS); } catch(e) { cleanupErrors.push(e.message); }
        
        if (cleanupErrors.length > 0) {
          throw new Error(cleanupErrors.join('; '));
        }
      }

      var expectedStr = 'true,application/pdf,true,true,true';
      var actualStr = (!!res && res.success) + ',' + mimeType + ',' + (size > 0) + ',' + tempFileCleaned + ',' + negativeCheckSuccess;
      return { expected: expectedStr, actual: actualStr };
    });

    runTest('T15', 'HTML 報表渲染器產出 PDF 與暫存檔安全清理驗證', ['MonthClosings', 'ClosingArtifacts', 'ReportTemplates'], 'INTEGRATION', false, true, false, false, true, function() {
      var testRunId = Utils.generateUUID();
      var suffix = testRunId.substring(0, 8);
      var closingId = 'CLOSE_T15_' + suffix;
      var templateId = 'TMP_T15_' + suffix;
      var artL = 'ART_T15_L_' + suffix;
      var artA = 'ART_T15_A_' + suffix;
      var artS = 'ART_T15_S_' + suffix;
      
      var res;
      var mimeType = '';
      var size = -1;
      var parentMatched = false;
      
      var testRoot = DriveApp.getFolderById(Config.getReportRootFolderId());
      var previewsFolder = getOrCreateSubFolder(testRoot, 'previews_temp');
      
      var beforeFileIds = [];
      var filesIter = previewsFolder.getFiles();
      while (filesIter.hasNext()) {
        beforeFileIds.push(filesIter.next().getId());
      }
      
      var fLedger, fAlloc, fSummary, pdfFile;
      var tempFileCleaned = false;

      try {
        // 1. 建立 closed closing fixture
        SheetRepository.appendRecord('MonthClosings', {
          closing_id: closingId,
          year_month: '2026-09',
          status: 'closed',
          is_current: true,
          gross_amount_minor: 6000,
          meal_count_total: 1
        });

        // 2. 建立真實的 CSV 檔案 (隔離在 previewsFolder)
        fLedger = previewsFolder.createFile('temp_t15_ledger_' + testRunId + '.csv', 
          'eligible_meal_count,student_name,student_name_masked,date,class_code_snapshot,meal_price_snapshot,meal_price_minor_snapshot\n1,陳小明,陳○明,2026-09-01,G1C1,60.00,6000',
          MimeType.PLAIN_TEXT);
        fAlloc = previewsFolder.createFile('temp_t15_alloc_' + testRunId + '.csv',
          'funding_source,settlement_amount_minor,final_amount_minor\ntownship,6000,6000',
          MimeType.PLAIN_TEXT);
        fSummary = previewsFolder.createFile('temp_t15_summary_' + testRunId + '.csv',
          'funding_source,settlement_total_minor,final_amount_minor,gross_amount_minor,meal_count\ntownship,6000,6000,6000,1',
          MimeType.PLAIN_TEXT);

        // 3. 建立必要 artifacts
        SheetRepository.appendRecord('ClosingArtifacts', {
          artifact_id: artL,
          closing_id: closingId,
          year_month: '2026-09',
          artifact_type: 'dailyMealLedger_export',
          file_id: fLedger.getId(),
          archived: false,
          enabled: true
        });

        SheetRepository.appendRecord('ClosingArtifacts', {
          artifact_id: artA,
          closing_id: closingId,
          year_month: '2026-09',
          artifact_type: 'fundingAllocationLedger_export',
          file_id: fAlloc.getId(),
          archived: false,
          enabled: true
        });

        SheetRepository.appendRecord('ClosingArtifacts', {
          artifact_id: artS,
          closing_id: closingId,
          year_month: '2026-09',
          artifact_type: 'monthlyFundingSummary_export',
          file_id: fSummary.getId(),
          archived: false,
          enabled: true
        });

        // 4. 建立 HTML 範本
        SheetRepository.appendRecord('ReportTemplates', {
          template_id: templateId,
          report_type: 'DAILY_SCHOOL_MEAL_SUMMARY',
          template_name: '全校每日統計範本(Html)',
          template_format: 'HTML',
          template_file_id: '',
          status: 'approved',
          enabled: true
        });

        // 5. 呼叫 generatePreviewReport
        res = ReportService.generatePreviewReport(closingId, 'DAILY_SCHOOL_MEAL_SUMMARY', templateId);
        
        if (res && res.fileId) {
          pdfFile = DriveApp.getFileById(res.fileId);
          mimeType = pdfFile.getMimeType();
          size = pdfFile.getSize();
          
          try {
            assertNoNewActiveFiles(previewsFolder, 'temp_render_', beforeFileIds);
            tempFileCleaned = true;
          } catch (e) {
            tempFileCleaned = false;
          }

          var parents = pdfFile.getParents();
          while (parents.hasNext()) {
            if (parents.next().getId() === previewsFolder.getId()) {
              parentMatched = true;
              break;
            }
          }
        }

      } finally {
        var cleanupErrors = [];
        try {
          cleanupFiles([
            { file: pdfFile, name: 'pdfFile' },
            { file: fLedger, name: 'fLedger' },
            { file: fAlloc, name: 'fAlloc' },
            { file: fSummary, name: 'fSummary' }
          ]);
        } catch(e) {
          cleanupErrors.push(e.message);
        }
        
        try { SheetRepository.deleteRecordById('MonthClosings', 'closing_id', closingId); } catch(e) { cleanupErrors.push(e.message); }
        try { SheetRepository.deleteRecordById('ReportTemplates', 'template_id', templateId); } catch(e) { cleanupErrors.push(e.message); }
        try { SheetRepository.deleteRecordById('ClosingArtifacts', 'artifact_id', artL); } catch(e) { cleanupErrors.push(e.message); }
        try { SheetRepository.deleteRecordById('ClosingArtifacts', 'artifact_id', artA); } catch(e) { cleanupErrors.push(e.message); }
        try { SheetRepository.deleteRecordById('ClosingArtifacts', 'artifact_id', artS); } catch(e) { cleanupErrors.push(e.message); }
        
        if (cleanupErrors.length > 0) {
          throw new Error(cleanupErrors.join('; '));
        }
      }

      var expectedStr = 'true,application/pdf,true,true,true';
      var actualStr = (!!res && res.success) + ',' + mimeType + ',' + (size > 0) + ',' + tempFileCleaned + ',' + parentMatched;
      return { expected: expectedStr, actual: actualStr };
    });

    runTest('T16', '核准範本與版本規格更新', ['ReportTemplates'], 'INTEGRATION', false, false, false, false, false, function() {
      var testRunId = Utils.generateUUID();
      var suffix = testRunId.substring(0, 8);
      var target = ReportService.createReportTemplate({
        report_type: 'TEST_APPROVAL_FLOW_' + suffix,
        template_name: 'TEST_APPROVAL_' + suffix,
        template_format: 'HTML'
      });
      try {
        var approved = ReportService.approveReportTemplate(target.template_id);
        return { expected: 'approved', actual: approved.status };
      } finally {
        SheetRepository.deleteRecordById('ReportTemplates', 'template_id', target.template_id);
      }
    });

    runTest('T17', '未核准 (draft) 範本禁止用於產生正式報表', ['MonthClosings', 'ReportTemplates'], 'AUTH', false, false, false, false, false, function() {
      var testRunId = Utils.generateUUID();
      var suffix = testRunId.substring(0, 8);
      var closingId = 'CLOSE_TEST_T17_' + suffix;
      var templateId = 'TMP_TEST_T17_' + suffix;
      var triggered = false;
      var errorCode = '';
      
      try {
        // 1. 建立 closed closing fixture
        SheetRepository.appendRecord('MonthClosings', {
          closing_id: closingId,
          year_month: '2026-09',
          status: 'closed',
          is_current: true,
          gross_amount_minor: 6000,
          meal_count_total: 1
        });

        // 2. 建立 draft template
        SheetRepository.appendRecord('ReportTemplates', {
          template_id: templateId,
          report_type: 'DAILY_SCHOOL_MEAL_SUMMARY',
          template_name: '未核准草稿T17',
          template_format: 'HTML',
          status: 'draft',
          enabled: true
        });

        ReportService.generateOfficialReport(closingId, 'DAILY_SCHOOL_MEAL_SUMMARY', templateId);
      } catch (e) {
        triggered = true;
        errorCode = e.code || '';
      } finally {
        // Clean up fixtures
        SheetRepository.deleteRecordById('MonthClosings', 'closing_id', closingId);
        SheetRepository.deleteRecordById('ReportTemplates', 'template_id', templateId);
      }
      return { expected: 'true,DRAFT_TEMPLATE_NOT_ALLOWED', actual: triggered + ',' + errorCode };
    });

    runTest('T18', 'PUBLIC_SUMMARY 隱私級別去識別化與金額不一致驗證', ['MonthClosings', 'ClosingArtifacts'], 'UNIT', false, false, false, false, false, function() {
      var testRunId = Utils.generateUUID();
      var suffix = testRunId.substring(0, 8);
      var closingId = 'CLOSE_T18_' + suffix;
      var artL = 'ART_T18_L_' + suffix;
      var artA = 'ART_T18_A_' + suffix;
      var artS = 'ART_T18_S_' + suffix;
      
      var model;
      var triggered = false;
      var errorCode = '';
      var triggered10 = false;
      var errorCode10 = '';

      var folderId = Config.getReportRootFolderId();
      var testFolder = DriveApp.getFolderById(folderId);

      var fLedger, fAlloc, fSummary;

      try {
        // 1. 建立 closed closing fixture
        SheetRepository.appendRecord('MonthClosings', {
          closing_id: closingId,
          year_month: '2026-09',
          status: 'closed',
          is_current: true,
          gross_amount_minor: 6000,
          meal_count_total: 1
        });

        // 2. 建立真實的 CSV 檔案 (隔離在 testFolder)
        fLedger = testFolder.createFile('temp_t18_ledger_' + testRunId + '.csv', 
          'eligible_meal_count,student_name,student_name_masked,date,class_code_snapshot,meal_price_snapshot,meal_price_minor_snapshot\n1,陳小明,陳○明,2026-09-01,G1C1,60.00,6000',
          MimeType.PLAIN_TEXT);
        fAlloc = testFolder.createFile('temp_t18_alloc_' + testRunId + '.csv',
          'funding_source,settlement_amount_minor,final_amount_minor\ntownship,6000,6000',
          MimeType.PLAIN_TEXT);
        fSummary = testFolder.createFile('temp_t18_summary_' + testRunId + '.csv',
          'funding_source,settlement_total_minor,final_amount_minor,gross_amount_minor,meal_count\ntownship,6000,6000,6000,1',
          MimeType.PLAIN_TEXT);

        // 3. 建立必要 artifacts
        SheetRepository.appendRecord('ClosingArtifacts', {
          artifact_id: artL,
          closing_id: closingId,
          year_month: '2026-09',
          artifact_type: 'dailyMealLedger_export',
          file_id: fLedger.getId(),
          archived: false,
          enabled: true
        });

        SheetRepository.appendRecord('ClosingArtifacts', {
          artifact_id: artA,
          closing_id: closingId,
          year_month: '2026-09',
          artifact_type: 'fundingAllocationLedger_export',
          file_id: fAlloc.getId(),
          archived: false,
          enabled: true
        });

        SheetRepository.appendRecord('ClosingArtifacts', {
          artifact_id: artS,
          closing_id: closingId,
          year_month: '2026-09',
          artifact_type: 'monthlyFundingSummary_export',
          file_id: fSummary.getId(),
          archived: false,
          enabled: true
        });

        // 4. 呼叫正式的 buildReportDataModel 建立 PUBLIC_SUMMARY 模式
        model = ReportService.buildReportDataModel(closingId, 'PUBLIC_SUMMARY');

        // 5. 故意修改 Summary 金額為 5999，觸發 REPORT_SUMMARY_TOTAL_MISMATCH
        fSummary.setContent('funding_source,settlement_total_minor,final_amount_minor,gross_amount_minor,meal_count\ntownship,5999,5999,6000,1');
        
        try {
          ReportService.buildReportDataModel(closingId, 'PUBLIC_SUMMARY');
        } catch (ex) {
          triggered = true;
          errorCode = ex.code || '';
        }

        // 6. 負向測試：eligible_meal_count = 0 且 meal_price_snapshot = abc，必須拋出 MONEY_INVALID_DECIMAL
        var testRunId2 = Utils.generateUUID();
        var suffix2 = testRunId2.substring(0, 8);
        var closingId2 = 'CLOSE_T18_NEG_' + suffix2;
        var artL2 = 'ART_T18_L_NEG_' + suffix2;
        var artA2 = 'ART_T18_A_NEG_' + suffix2;
        var artS2 = 'ART_T18_S_NEG_' + suffix2;
        
        var fLedger2, fAlloc2, fSummary2;
        
        try {
          SheetRepository.appendRecord('MonthClosings', {
            closing_id: closingId2,
            year_month: '2026-09',
            status: 'closed',
            is_current: true,
            gross_amount_minor: 0,
            meal_count_total: 0
          });
          
          fLedger2 = testFolder.createFile('temp_t18_neg_ledger_' + testRunId2 + '.csv', 
            'eligible_meal_count,student_name,student_name_masked,date,class_code_snapshot,meal_price_snapshot,meal_price_minor_snapshot\n0,陳小明,陳○明,2026-09-01,G1C1,abc,',
            MimeType.PLAIN_TEXT);
          fAlloc2 = testFolder.createFile('temp_t18_neg_alloc_' + testRunId2 + '.csv',
            'funding_source,settlement_amount_minor,final_amount_minor\ntownship,0,0',
            MimeType.PLAIN_TEXT);
          fSummary2 = testFolder.createFile('temp_t18_neg_summary_' + testRunId2 + '.csv',
            'funding_source,settlement_total_minor,final_amount_minor,gross_amount_minor,meal_count\ntownship,0,0,0,0',
            MimeType.PLAIN_TEXT);
            
          SheetRepository.appendRecord('ClosingArtifacts', {
            artifact_id: artL2,
            closing_id: closingId2,
            year_month: '2026-09',
            artifact_type: 'dailyMealLedger_export',
            file_id: fLedger2.getId(),
            archived: false,
            enabled: true
          });
          SheetRepository.appendRecord('ClosingArtifacts', {
            artifact_id: artA2,
            closing_id: closingId2,
            year_month: '2026-09',
            artifact_type: 'fundingAllocationLedger_export',
            file_id: fAlloc2.getId(),
            archived: false,
            enabled: true
          });
          SheetRepository.appendRecord('ClosingArtifacts', {
            artifact_id: artS2,
            closing_id: closingId2,
            year_month: '2026-09',
            artifact_type: 'monthlyFundingSummary_export',
            file_id: fSummary2.getId(),
            archived: false,
            enabled: true
          });
          
          ReportService.buildReportDataModel(closingId2, 'PUBLIC_SUMMARY');
        } catch(ex) {
          triggered10 = true;
          errorCode10 = ex.code || ex.message || '';
        } finally {
          var cleanupErrors2 = [];
          try {
            cleanupFiles([
              { file: fLedger2, name: 'fLedger2' },
              { file: fAlloc2, name: 'fAlloc2' },
              { file: fSummary2, name: 'fSummary2' }
            ]);
          } catch(e) {
            cleanupErrors2.push(e.message);
          }
          try { SheetRepository.deleteRecordById('MonthClosings', 'closing_id', closingId2); } catch(e) { cleanupErrors2.push(e.message); }
          try { SheetRepository.deleteRecordById('ClosingArtifacts', 'artifact_id', artL2); } catch(e) { cleanupErrors2.push(e.message); }
          try { SheetRepository.deleteRecordById('ClosingArtifacts', 'artifact_id', artA2); } catch(e) { cleanupErrors2.push(e.message); }
          try { SheetRepository.deleteRecordById('ClosingArtifacts', 'artifact_id', artS2); } catch(e) { cleanupErrors2.push(e.message); }
          if (cleanupErrors2.length > 0) {
            throw new Error(cleanupErrors2.join('; '));
          }
        }

      } finally {
        var cleanupErrors = [];
        try {
          cleanupFiles([
            { file: fLedger, name: 'fLedger' },
            { file: fAlloc, name: 'fAlloc' },
            { file: fSummary, name: 'fSummary' }
          ]);
        } catch(e) {
          cleanupErrors.push(e.message);
        }
        
        try { SheetRepository.deleteRecordById('MonthClosings', 'closing_id', closingId); } catch(e) { cleanupErrors.push(e.message); }
        try { SheetRepository.deleteRecordById('ClosingArtifacts', 'artifact_id', artL); } catch(e) { cleanupErrors.push(e.message); }
        try { SheetRepository.deleteRecordById('ClosingArtifacts', 'artifact_id', artA); } catch(e) { cleanupErrors.push(e.message); }
        try { SheetRepository.deleteRecordById('ClosingArtifacts', 'artifact_id', artS); } catch(e) { cleanupErrors.push(e.message); }
        
        if (cleanupErrors.length > 0) {
          throw new Error(cleanupErrors.join('; '));
        }
      }
      
      var name = model && model.DAILY_ROWS && model.DAILY_ROWS[0] ? model.DAILY_ROWS[0].student_name : '';
      var expectedStr = '***,true,REPORT_SUMMARY_TOTAL_MISMATCH,true,MONEY_INVALID_DECIMAL';
      var actualStr = name + ',' + triggered + ',' + errorCode + ',' + triggered10 + ',' + errorCode10;
      return { expected: expectedStr, actual: actualStr };
    });

    runTest('T19', '報表會簽核章工作流核可狀態移轉與稽核日誌寫入', ['ReportGenerationRuns', 'ApprovalRecords', 'AuditLogs'], 'INTEGRATION', false, false, false, false, false, function() {
      var testRunId = Utils.generateUUID();
      var suffix = testRunId.substring(0, 8);
      var runId = 'RUN_T19_TEST_' + suffix;
      var closingId = 'CLOSE_T19_TEST_' + suffix;
      var templateId = 'TMP_T19_' + suffix;
      var outputFileId = 'TEST_OUTPUT_T19_' + suffix;
      var reportHash = 'hash123_t19_' + suffix;
      
      var record;
      var auditLog;
      
      try {
        // 1. 建立 ReportGenerationRuns fixture
        SheetRepository.appendRecord('ReportGenerationRuns', {
          report_run_id: runId,
          closing_id: closingId,
          closing_version: 1,
          year_month: '2026-09',
          template_id: templateId,
          template_version: 1,
          output_file_id: outputFileId,
          report_hash: reportHash,
          started_by: 'system_admin',
          completed_at: Utils.formatDateTime(new Date()),
          is_current: true
        });

        // 2. 呼叫 approveReport
        record = ReportService.approveReport(runId, 'lunch_admin_checked', '測試核可');

        // 3. 查詢 AuditLogs
        var logs = SheetRepository.findRecords('AuditLogs', function(x) {
          return x.record_id === runId && x.action === 'APPROVE_REPORT';
        });
        auditLog = logs[0];
      } finally {
        // 4. 清理 fixtures
        SheetRepository.deleteRecordById('ReportGenerationRuns', 'report_run_id', runId);
        if (record) {
          SheetRepository.deleteRecordById('ApprovalRecords', 'approval_id', record.approval_id);
        }
        if (auditLog) {
          SheetRepository.deleteRecordById('AuditLogs', 'log_id', auditLog.log_id);
        }
      }

      var identity = AuthService.getCurrentIdentity();
      var expectedStr = 'approved,lunch_admin_checked,' + reportHash + ',true,true';
      var actualStr = record.decision + ',' + record.approval_stage + ',' + record.source_hash + ',' + (!!record.approval_id) + ',' + (!!auditLog);
      return { expected: expectedStr, actual: actualStr };
    });
  } finally {
    Config.setTestMode(false);
  }

  if (uatFolderId) {
    try {
      var uatFolder = DriveApp.getFolderById(uatFolderId);
      var filesIter = uatFolder.getFiles();
      var finalUatFileCount = 0;
      while (filesIter.hasNext()) {
        filesIter.next();
        finalUatFileCount++;
      }
      if (finalUatFileCount !== initialUatFileCount) {
        report.errors.push('🛑 安全隔離校驗失敗：UAT／PRODUCTION 報表資料夾檔案數在測試前後不一致（前：' + initialUatFileCount + '，後：' + finalUatFileCount + '）！');
        report.failed++;
      }
    } catch (e) {
      report.errors.push('驗證 UAT／PRODUCTION 報表資料夾檔案數失敗: ' + e.message);
      report.failed++;
    }
  }

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
