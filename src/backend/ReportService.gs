/**
 * ReportService.gs
 * 正式報表、核章表與 PDF 歸檔服務
 */

var ReportService = (function() {

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function validateApprovalRoleForStage(stage) {
    var identity = AuthService.requireAuthenticatedUser();
    var allowed = false;
    if (stage === 'lunch_admin_checked') {
      allowed = (identity.role === 'lunch_admin' || identity.role === 'system_admin');
    } else if (stage === 'accountant_checked') {
      allowed = (identity.role === 'accountant' || identity.role === 'system_admin');
    } else if (stage === 'principal_approved') {
      allowed = (identity.role === 'system_admin');
    } else {
      allowed = (identity.role === 'system_admin');
    }
    
    if (!allowed) {
      var err = new Error('🛑 審核權限錯誤：當前身份角色 (' + identity.role + ') 無權處理該審核關卡：' + stage);
      err.code = 'APPROVAL_ROLE_MISMATCH';
      throw err;
    }
  }

  /**
   * 取得有效且核准的報表範本
   */
  function getApplicableTemplate(reportType, dateStr) {
    var templates = SheetRepository.findRecords('ReportTemplates', function(x) {
      if (x.report_type !== reportType) return false;
      if (x.status !== 'approved') return false;
      if (x.enabled !== true) return false;
      // 檢查日期起訖是否涵蓋指定日期
      if (x.effective_start_date && dateStr < x.effective_start_date) return false;
      if (x.effective_end_date && dateStr > x.effective_end_date) return false;
      return true;
    });

    if (templates.length === 0) return null;
    // 若有多筆，選擇版本最高或生效日最新者
    templates.sort(function(a, b) {
      var vA = parseInt(a.template_version, 10) || 0;
      var vB = parseInt(b.template_version, 10) || 0;
      if (vB !== vA) return vB - vA;
      return (b.effective_start_date || '').localeCompare(a.effective_start_date || '');
    });
    return templates[0];
  }

  function listReportTemplates(reportType) {
    if (reportType) {
      return SheetRepository.findRecords('ReportTemplates', function(x) {
        return x.report_type === reportType;
      });
    }
    return SheetRepository.getAllRecords('ReportTemplates');
  }

  function createReportTemplate(templateData) {
    AuthService.requireRole('system_admin');
    var id = 'TMP_' + new Date().getTime();
    var record = {
      template_id: id,
      report_type: templateData.report_type,
      template_name: templateData.template_name,
      template_version: templateData.template_version || '1',
      template_format: templateData.template_format || 'HTML',
      template_file_id: templateData.template_file_id || '',
      template_file_url: templateData.template_file_url || '',
      mapping_json: templateData.mapping_json || '{}',
      page_settings_json: templateData.page_settings_json || '{}',
      effective_start_date: templateData.effective_start_date || '2026-01-01',
      effective_end_date: templateData.effective_end_date || '2099-12-31',
      enabled: templateData.enabled !== false,
      status: 'draft',
      created_by: AuthService.getCurrentIdentity().email,
      created_at: Utils.formatDateTime(new Date()),
      approved_by: '',
      approved_at: '',
      supersedes_template_id: templateData.supersedes_template_id || '',
      note: templateData.note || '',
      privacy_level: templateData.privacy_level || 'INTERNAL_STUDENT_DETAIL'
    };

    SheetRepository.appendRecord('ReportTemplates', record);
    return record;
  }

  function approveReportTemplate(templateId) {
    AuthService.requireRole('system_admin');
    var t = SheetRepository.findById('ReportTemplates', 'template_id', templateId);
    if (!t) throw new Error('找不到報表範本');
    
    t.status = 'approved';
    t.approved_by = AuthService.getCurrentIdentity().email;
    t.approved_at = Utils.formatDateTime(new Date());
    
    SheetRepository.upsertRecord('ReportTemplates', 'template_id', templateId, t);
    return t;
  }

  function retireReportTemplate(templateId) {
    AuthService.requireRole('system_admin');
    var t = SheetRepository.findById('ReportTemplates', 'template_id', templateId);
    if (!t) throw new Error('找不到報表範本');
    
    t.status = 'retired';
    t.enabled = false;
    SheetRepository.upsertRecord('ReportTemplates', 'template_id', templateId, t);
    return t;
  }

  /**
   * 建立不可變之報表資料模型 (Data Model)
   */
  function buildReportDataModel(closingId, privacyLevel) {
    var closing = SheetRepository.findById('MonthClosings', 'closing_id', closingId);
    if (!closing) throw new Error('找不到指定的月結封存紀錄：' + closingId);

    var ym = closing.year_month;
    var schoolYear = Config.getSystemConfig('SCHOOL_YEAR', '115');
    var semester = Config.getSystemConfig('SEMESTER', '1');

    // 載入封存快照資料 (必須以 closed 封存快照為準，不得讀取動態資料表)
    var artifacts = SheetRepository.findRecords('ClosingArtifacts', function(x) {
      return x.closing_id === closingId && x.archived === false;
    });

    // 必須要求以下三個 artifact 存在
    var ledgerArt = artifacts.filter(function(x) { return x.artifact_type === 'dailyMealLedger_export'; })[0];
    var allocArt = artifacts.filter(function(x) { return x.artifact_type === 'fundingAllocationLedger_export'; })[0];
    var fSumArt = artifacts.filter(function(x) { return x.artifact_type === 'monthlyFundingSummary_export'; })[0];

    if (!ledgerArt || !allocArt || !fSumArt) {
      var err = new Error('🛑 報表錯誤：缺少必要的月結封存快照檔案！');
      err.code = 'CLOSING_ARTIFACT_MISSING';
      throw err;
    }

    // 載入時必須帶上 { isReport: true }
    var ledgers = loadCsvFromDrive(ledgerArt.file_id, { isReport: true });
    var allocs = loadCsvFromDrive(allocArt.file_id, { isReport: true });
    var fSums = loadCsvFromDrive(fSumArt.file_id, { isReport: true });

    // 1. Calculate ledgerGrossMinor from dailyMealLedger_export with strict checks
    var ledgerGrossMinor = 0;
    ledgers.forEach(function(l) {
      var mealCountVal = l.eligible_meal_count;
      if (mealCountVal === undefined || mealCountVal === null || mealCountVal === '') {
        var err = new Error('🛑 報表欄位錯誤：缺少用餐餐數欄位。');
        err.code = 'REPORT_LEDGER_ROW_INVALID';
        throw err;
      }
      var mealCount = Number(mealCountVal);
      if (mealCount !== 0 && mealCount !== 1) {
        var err = new Error('🛑 報表欄位錯誤：用餐餐數限制為 0 或 1，實際得到：' + mealCountVal);
        err.code = 'REPORT_LEDGER_ROW_INVALID';
        throw err;
      }

      var hasMinor = (l.meal_price_minor_snapshot !== undefined && l.meal_price_minor_snapshot !== null && l.meal_price_minor_snapshot !== '');
      var hasYuan = (l.meal_price_snapshot !== undefined && l.meal_price_snapshot !== null && l.meal_price_snapshot !== '');

      if (!hasMinor && !hasYuan) {
        var err = new Error('🛑 報表欄位錯誤：缺少餐價快照欄位。');
        err.code = 'REPORT_LEDGER_PRICE_MISSING';
        throw err;
      }

      var priceMinor = 0;

      if (hasMinor) {
        var minorVal = l.meal_price_minor_snapshot;
        var numMinor = Number(minorVal);
        if (!Number.isFinite(numMinor) || !Number.isInteger(numMinor) || numMinor < 0) {
          var err = new Error('🛑 報表欄位錯誤：餐價 minor 單位快照必須為非負整數：' + minorVal);
          err.code = 'REPORT_LEDGER_ROW_INVALID';
          throw err;
        }
        priceMinor = numMinor;
      }

      var yuanConvertedMinor = 0;
      if (hasYuan) {
        var rawYuan = l.meal_price_snapshot;
        yuanConvertedMinor = MoneyService.yuanToMinor(rawYuan);
        if (yuanConvertedMinor < 0) {
          var err = new Error('🛑 報表欄位錯誤：餐價快照不得為負數。');
          err.code = 'REPORT_LEDGER_ROW_INVALID';
          throw err;
        }
        if (!hasMinor) {
          priceMinor = yuanConvertedMinor;
        }
      }

      if (hasMinor && hasYuan) {
        if (priceMinor !== yuanConvertedMinor) {
          var err = new Error('🛑 報表欄位錯誤：餐價的元快照轉換值 (' + yuanConvertedMinor + ') 與 minor 快照值 (' + priceMinor + ') 不一致！');
          err.code = 'REPORT_LEDGER_GROSS_MISMATCH';
          throw err;
        }
      }

      if (mealCount > 0) {
        ledgerGrossMinor += mealCount * priceMinor;
      }
    });

    // 2. Sum allocationLedgerTotalMinor
    var allocationLedgerTotalMinor = 0;
    allocs.forEach(function(al) {
      var amt = MoneyService.parseMinorStrict(al.settlement_amount_minor || al.final_amount_minor || 0, 'settlement_amount_minor/final_amount_minor');
      allocationLedgerTotalMinor += amt;
    });

    // 3. Sum monthlyFundingSummaryTotalMinor
    var monthlyFundingSummaryTotalMinor = 0;
    fSums.forEach(function(fs) {
      var amt = MoneyService.parseMinorStrict(fs.settlement_total_minor || fs.final_amount_minor || 0, 'settlement_total_minor/final_amount_minor');
      monthlyFundingSummaryTotalMinor += amt;
    });

    // 4. Perform the required 4-way checks in order
    if (ledgerGrossMinor !== allocationLedgerTotalMinor) {
      var errAlloc = new Error('🛑 報表金額不一致：封存明細加總 (' + ledgerGrossMinor + ' minor) 與補助款分配額 (' + allocationLedgerTotalMinor + ' minor) 不符合！');
      errAlloc.code = 'REPORT_ALLOCATION_TOTAL_MISMATCH';
      throw errAlloc;
    }
    if (ledgerGrossMinor !== monthlyFundingSummaryTotalMinor) {
      var errSum = new Error('🛑 報表金額不一致：封存明細加總 (' + ledgerGrossMinor + ' minor) 與月彙總額 (' + monthlyFundingSummaryTotalMinor + ' minor) 不符合！');
      errSum.code = 'REPORT_SUMMARY_TOTAL_MISMATCH';
      throw errSum;
    }
    if (ledgerGrossMinor !== MoneyService.parseMinorStrict(closing.gross_amount_minor || 0, 'gross_amount_minor')) {
      var errClose = new Error('🛑 報表金額不一致：封存明細加總 (' + ledgerGrossMinor + ' minor) 與月結單總餐費 (' + closing.gross_amount_minor + ' minor) 不符合！');
      errClose.code = 'CLOSING_GROSS_MISMATCH';
      throw errClose;
    }

    // 依據 fSums 進行實際彙總
    var townshipMinor = 0;
    var countyMinor = 0;
    var schoolMinor = 0;
    var selfPayMinor = 0;
    var otherMinor = 0;
    var residualMinor = 0;

    fSums.forEach(function(fs) {
      var source = fs.funding_source;
      var amt = MoneyService.parseMinorStrict(fs.settlement_total_minor || fs.final_amount_minor || 0, 'settlement_total_minor/final_amount_minor');
      var resid = MoneyService.parseMinorStrict(fs.residual_adjustment_minor || 0, 'residual_adjustment_minor');
      
      residualMinor += resid;
      
      if (source === 'township') townshipMinor += amt;
      else if (source === 'county') countyMinor += amt;
      else if (source === 'school') schoolMinor += amt;
      else if (source === 'self_pay') selfPayMinor += amt;
      else if (source === 'other') otherMinor += amt;
    });

    // 交叉驗證：allocations 總和應等於 fSums 總和 (by funding_source)
    var allocSums = {};
    allocs.forEach(function(al) {
      var src = al.funding_source;
      var amt = MoneyService.parseMinorStrict(al.settlement_amount_minor || al.final_amount_minor || 0, 'settlement_amount_minor/final_amount_minor');
      allocSums[src] = (allocSums[src] || 0) + amt;
    });

    var summarySums = {};
    fSums.forEach(function(fs) {
      var src = fs.funding_source;
      var amt = MoneyService.parseMinorStrict(fs.settlement_total_minor || fs.final_amount_minor || 0, 'settlement_total_minor/final_amount_minor');
      summarySums[src] = (summarySums[src] || 0) + amt;
    });

    for (var src in summarySums) {
      var aSum = allocSums[src] || 0;
      var sSum = summarySums[src] || 0;
      if (aSum !== sSum) {
        var errCross = new Error('🛑 報表交叉驗證錯誤：補助來源 ' + src + ' 的明細加總 (' + aSum + ' minor) 與月彙總 (' + sSum + ' minor) 不一致！');
        errCross.code = 'REPORT_CROSS_VALIDATION_FAILED';
        throw errCross;
      }
    }

    // 套用個資隱私權限等級遮罩
    var dailyRows = [];
    ledgers.forEach(function(l) {
      if (Number(l.eligible_meal_count) === 1) {
        var name = l.student_name_masked || '';
        if (privacyLevel === 'PUBLIC_SUMMARY') {
          name = '***';
        } else if (privacyLevel === 'INTERNAL_STUDENT_DETAIL') {
          name = l.student_name_masked || '';
        }
        
        var priceMinor = 0;
        if (l.meal_price_minor_snapshot !== undefined && l.meal_price_minor_snapshot !== null && l.meal_price_minor_snapshot !== '') {
          priceMinor = MoneyService.parseMinorStrict(l.meal_price_minor_snapshot, 'meal_price_minor_snapshot');
        } else if (l.meal_price_snapshot !== undefined && l.meal_price_snapshot !== null && l.meal_price_snapshot !== '') {
          priceMinor = MoneyService.yuanToMinorStrict(l.meal_price_snapshot, 'meal_price_snapshot');
        }

        dailyRows.push({
          date: l.date,
          class_code: l.class_code_snapshot || '',
          student_name: name,
          meal_count: 1,
          meal_price: MoneyService.minorToYuan(priceMinor)
        });
      }
    });

    var fundingRows = [];
    fSums.forEach(function(fs) {
      var source = fs.funding_source;
      var sourceLabel = getFundingSourceLabel(source);
      fundingRows.push({
        funding_source: sourceLabel,
        meal_count: parseInt(fs.meal_count, 10) || 0,
        gross_amount: MoneyService.minorToYuan(fs.gross_amount_minor || 0),
        final_amount: MoneyService.minorToYuan(fs.settlement_total_minor || fs.final_amount_minor || 0)
      });
    });

    var model = {
      SCHOOL_NAME: Config.getSystemConfig('SCHOOL_NAME', '實機實驗學校'),
      SCHOOL_CODE: Config.getSystemConfig('SCHOOL_CODE', 'SCH001'),
      SCHOOL_YEAR: schoolYear,
      SEMESTER: semester,
      YEAR_MONTH: ym,
      CLOSING_ID: closingId,
      CLOSING_VERSION: 'V' + closing.closing_version,
      REPORT_DATE: Utils.formatDate(new Date()),
      PREPARED_BY: closing.prepared_by || '',
      VALIDATED_BY: closing.validated_by || '',
      CLOSED_BY: closing.closed_by || '',
      TOTAL_MEAL_COUNT: closing.meal_count_total || 0,
      GROSS_AMOUNT: MoneyService.minorToYuan(ledgerGrossMinor),
      TOWNSHIP_AMOUNT: MoneyService.minorToYuan(townshipMinor),
      COUNTY_AMOUNT: MoneyService.minorToYuan(countyMinor),
      SCHOOL_AMOUNT: MoneyService.minorToYuan(schoolMinor),
      SELF_PAY_AMOUNT: MoneyService.minorToYuan(selfPayMinor),
      OTHER_AMOUNT: MoneyService.minorToYuan(otherMinor),
      TOTAL_FUNDING_AMOUNT: MoneyService.minorToYuan(townshipMinor + countyMinor + schoolMinor + otherMinor),
      TOTAL_SELF_PAY_AMOUNT: MoneyService.minorToYuan(selfPayMinor),
      TOTAL_ALLOCATED_AMOUNT: MoneyService.minorToYuan(townshipMinor + countyMinor + schoolMinor + selfPayMinor + otherMinor),
      RESIDUAL_AMOUNT: MoneyService.minorToYuan(residualMinor),
      SOURCE_HASH: closing.funding_source_hash || '',
      REPORT_HASH: '',
      DAILY_ROWS: dailyRows,
      FUNDING_ROWS: fundingRows
    };

    return model;
  }

  function getFundingSourceLabel(src) {
    var labels = {
      township: '公所補助',
      county: '縣府補助',
      school: '學校補助',
      self_pay: '自付額',
      other: '其他來源'
    };
    return labels[src] || src;
  }

  function loadCsvFromDrive(fileId, options) {
    var isReport = options && options.isReport;
    if (!fileId) {
      if (isReport) {
        var err = new Error('封存快照檔案 ID 為空，無法載入');
        err.code = 'CLOSING_ARTIFACT_MISSING';
        throw err;
      }
      return [];
    }
    try {
      var file = DriveApp.getFileById(fileId);
      var csvText = file.getBlob().getDataAsString('UTF-8');
      var result = parseCsvText(csvText);
      if (isReport && result.length === 0) {
        var err2 = new Error('封存快照 CSV 檔案內容為空或格式不合規：' + fileId);
        err2.code = 'CLOSING_ARTIFACT_INVALID_CSV';
        throw err2;
      }
      return result;
    } catch(e) {
      if (e.code) throw e;
      if (isReport) {
        var err3 = new Error('無法讀取封存快照檔案：' + fileId + '，原始錯誤：' + e.message);
        err3.code = 'CLOSING_ARTIFACT_UNREADABLE';
        throw err3;
      }
      return [];
    }
  }

  function parseCsvText(text) {
    if (!text) return [];
    var cleanText = text.replace(/^\uFEFF/, '');
    var parsed = Utilities.parseCsv(cleanText);
    if (parsed.length <= 1) return [];
    
    var headers = parsed[0].map(function(h) { return h.trim(); });
    var list = [];
    for (var i = 1; i < parsed.length; i++) {
      var cells = parsed[i];
      if (cells.length === 0 || (cells.length === 1 && cells[0].trim() === '')) continue;
      
      var obj = {};
      headers.forEach(function(h, idx) {
        obj[h] = cells[idx] !== undefined ? cells[idx] : '';
      });
      list.push(obj);
    }
    return list;
  }

  /**
   * 分流渲染主函式
   */
  function renderReportByFormat(template, dataModel, outputFolder, isPreview) {
    var format = template.template_format || 'HTML';
    switch (format) {
      case 'HTML':
        return renderHtmlTemplate(template, dataModel, outputFolder, isPreview);
      case 'GOOGLE_DOCS':
        return renderDocsTemplate(template, dataModel, outputFolder, isPreview);
      case 'GOOGLE_SHEETS':
        return renderSheetsTemplate(template, dataModel, outputFolder, isPreview);
      default:
        throw new Error('🛑 報表錯誤：未知的報表範本格式：' + format);
    }
  }

  /**
   * 1. HTML Renderer
   */
  function renderHtmlTemplate(templateRecord, dataModel, outputFolder, isPreview) {
    var htmlContent = getApplicableHtmlContent(templateRecord.report_type, dataModel, isPreview);
    
    var fileName = Config.getSystemConfig('SCHOOL_CODE', 'SCH001') + '_' + dataModel.YEAR_MONTH.replace('-', '') + '_' + 
                   templateRecord.report_type + '_Closing' + dataModel.CLOSING_VERSION + 
                   '_TemplateV' + templateRecord.template_version;
                   
    if (isPreview) {
      fileName += '_PREVIEW';
    }
    fileName += '.pdf';

    // 建立臨時 HTML 檔案供 conversion
    var tempFile = outputFolder.createFile('temp_render_' + new Date().getTime() + '.html', htmlContent, MimeType.HTML);
    
    try {
      // 轉換為 PDF Blob
      var blob = tempFile.getAs('application/pdf');
      blob.setName(fileName);
      
      var pdfFile = outputFolder.createFile(blob);
      return pdfFile;
    } finally {
      try {
        tempFile.setTrashed(true);
      } catch (e) {
        // 防止清理錯誤掩蓋主要錯誤
      }
    }
  }

  /**
   * 2. Google Docs Renderer
   */
  function renderDocsTemplate(template, dataModel, outputFolder, isPreview) {
    var docId = template.template_file_id;
    if (!docId || docId.trim() === '' || docId.indexOf('_xyz') !== -1) {
      var err = new Error('找不到 Docs 範本檔案：' + docId);
      err.code = 'TEMPLATE_FILE_NOT_FOUND';
      throw err;
    }

    var templateFile;
    try {
      templateFile = DriveApp.getFileById(docId);
    } catch (e) {
      var err2 = new Error('找不到 Docs 範本檔案或無權限：' + docId + '，原始錯誤：' + e.message);
      err2.code = 'TEMPLATE_FILE_NOT_FOUND';
      throw err2;
    }

    var copyFile;
    try {
      copyFile = templateFile.makeCopy('temp_render_doc_' + new Date().getTime(), outputFolder);
      
      var doc;
      try {
        doc = DocumentApp.openById(copyFile.getId());
      } catch (e) {
        var err3 = new Error('無法開啟 Docs 範本副本：' + e.message);
        err3.code = 'TEMPLATE_FILE_NOT_FOUND';
        throw err3;
      }
      var body = doc.getBody();
      
      body.replaceText('\\{\\{SCHOOL_NAME\\}\\}', String(dataModel.SCHOOL_NAME));
      body.replaceText('\\{\\{YEAR_MONTH\\}\\}', String(dataModel.YEAR_MONTH));
      body.replaceText('\\{\\{TOTAL_MEAL_COUNT\\}\\}', String(dataModel.TOTAL_MEAL_COUNT));
      body.replaceText('\\{\\{GROSS_AMOUNT\\}\\}', String(dataModel.GROSS_AMOUNT));
      body.replaceText('\\{\\{TOWNSHIP_AMOUNT\\}\\}', String(dataModel.TOWNSHIP_AMOUNT));
      body.replaceText('\\{\\{COUNTY_AMOUNT\\}\\}', String(dataModel.COUNTY_AMOUNT));
      body.replaceText('\\{\\{SCHOOL_AMOUNT\\}\\}', String(dataModel.SCHOOL_AMOUNT));
      body.replaceText('\\{\\{SELF_PAY_AMOUNT\\}\\}', String(dataModel.SELF_PAY_AMOUNT));

      var tableData = [['日期', '班級', '學生姓名', '餐數', '單價']];
      dataModel.DAILY_ROWS.forEach(function(r) {
        tableData.push([
          String(r.date),
          String(r.class_code),
          String(r.student_name),
          String(r.meal_count),
          '$' + r.meal_price.toFixed(2)
        ]);
      });
      body.appendTable(tableData);

      doc.saveAndClose();

      var blob = copyFile.getAs('application/pdf');
      var fileName = Config.getSystemConfig('SCHOOL_CODE', 'SCH001') + '_' + dataModel.YEAR_MONTH.replace('-', '') + '_' + 
                     template.report_type + '_Closing' + dataModel.CLOSING_VERSION + 
                     '_TemplateV' + template.template_version;
      if (isPreview) {
        fileName += '_PREVIEW';
      }
      fileName += '.pdf';
      blob.setName(fileName);

      var pdfFile = outputFolder.createFile(blob);
      return pdfFile;
    } finally {
      if (copyFile) {
        try {
          copyFile.setTrashed(true);
        } catch (e) {}
      }
    }
  }

  /**
   * 3. Google Sheets Renderer
   */
  function renderSheetsTemplate(template, dataModel, outputFolder, isPreview) {
    var sheetId = template.template_file_id;
    if (!sheetId || sheetId.trim() === '' || sheetId.indexOf('_xyz') !== -1) {
      var err = new Error('找不到 Sheets 範本檔案：' + sheetId);
      err.code = 'TEMPLATE_FILE_NOT_FOUND';
      throw err;
    }

    var templateFile;
    try {
      templateFile = DriveApp.getFileById(sheetId);
    } catch (e) {
      var err2 = new Error('找不到 Sheets 範本檔案或無權限：' + sheetId + '，原始錯誤：' + e.message);
      err2.code = 'TEMPLATE_FILE_NOT_FOUND';
      throw err2;
    }

    var copyFile;
    try {
      copyFile = templateFile.makeCopy('temp_render_sheet_' + new Date().getTime(), outputFolder);
      
      var ss;
      try {
        ss = SpreadsheetApp.openById(copyFile.getId());
      } catch (e) {
        var err3 = new Error('無法開啟 Sheets 範本副本：' + e.message);
        err3.code = 'TEMPLATE_FILE_NOT_FOUND';
        throw err3;
      }
      var sh = ss.getSheets()[0];
      if (!sh) {
        throw new Error('Sheets 範本中找不到任何工作表');
      }
      
      sh.getRange('A1').setValue(dataModel.SCHOOL_NAME);
      sh.getRange('B2').setValue(dataModel.YEAR_MONTH);
      sh.getRange('B3').setValue(dataModel.TOTAL_MEAL_COUNT);
      sh.getRange('B4').setValue(dataModel.GROSS_AMOUNT);

      if (isPreview) {
        sh.getRange('A6').setValue('⚠️ 預覽文件 — 非正式申請資料');
      }

      SpreadsheetApp.flush();

      var blob = copyFile.getAs('application/pdf');
      var fileName = Config.getSystemConfig('SCHOOL_CODE', 'SCH001') + '_' + dataModel.YEAR_MONTH.replace('-', '') + '_' + 
                     template.report_type + '_Closing' + dataModel.CLOSING_VERSION + 
                     '_TemplateV' + template.template_version;
      if (isPreview) {
        fileName += '_PREVIEW';
      }
      fileName += '.pdf';
      blob.setName(fileName);

      var pdfFile = outputFolder.createFile(blob);
      return pdfFile;
    } finally {
      if (copyFile) {
        try {
          copyFile.setTrashed(true);
        } catch (e) {}
      }
    }
  }

  /**
   * 取得通用 HTML 範本內容 (當無上傳範本時的萬用降級範本)
   */
  function getApplicableHtmlContent(reportType, data, isPreview) {
    var watermarkStyle = isPreview ? 
      'background-image: url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'400\' height=\'400\'><text x=\'50\' y=\'200\' fill=\'rgba(255,0,0,0.15)\' font-size=\'30\' font-family=\'Arial\' transform=\'rotate(-30 150 150)\'>預覽文件－非正式申請資料</text></svg>"); background-repeat: repeat;' : '';

    var rowsHtml = data.DAILY_ROWS.map(function(r) {
      return '<tr><td>' + escapeHtml(r.date) + '</td><td>' + escapeHtml(r.class_code) + '</td><td>' + escapeHtml(r.student_name) + '</td><td>' + r.meal_count + '</td><td>$' + r.meal_price.toFixed(2) + '</td></tr>';
    }).join('');

    var fundingHtml = data.FUNDING_ROWS.map(function(f) {
      return '<tr><td>' + escapeHtml(f.funding_source) + '</td><td>' + f.meal_count + '</td><td>$' + f.gross_amount + '</td><td>$' + f.final_amount + '</td></tr>';
    }).join('');

    var html = '<!DOCTYPE html><html><head><meta charset="utf-8"/><title>' + escapeHtml(reportType) + '</title>' +
               '<style>' +
               'body { font-family: "Noto Sans TC", sans-serif; padding: 20px; ' + watermarkStyle + ' }' +
               'h1 { text-align: center; color: #1e3a8a; }' +
               '.metadata-table, .detail-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }' +
               '.metadata-table td { padding: 8px; border: none; }' +
               '.detail-table th, .detail-table td { border: 1px solid #ddd; padding: 8px; text-align: left; }' +
               '.detail-table th { background-color: #f3f4f6; }' +
               '.approval-section { margin-top: 40px; display: flex; justify-content: space-between; }' +
               '.approval-box { border-top: 1px solid #000; width: 18%; text-align: center; padding-top: 5px; font-size: 12px; }' +
               '</style></head><body>' +
               '<h1>' + escapeHtml(data.SCHOOL_NAME) + ' - ' + escapeHtml(reportType) + ' (' + escapeHtml(data.YEAR_MONTH) + ')</h1>' +
               '<hr/>' +
               '<table class="metadata-table">' +
               '<tr><td>學年度：' + escapeHtml(data.SCHOOL_YEAR) + '</td><td>學期：' + escapeHtml(data.SEMESTER) + '</td><td>月結版本：' + escapeHtml(data.CLOSING_VERSION) + '</td></tr>' +
               '<tr><td>月結識別碼：' + escapeHtml(data.CLOSING_ID) + '</td><td>關帳製表：' + escapeHtml(data.PREPARED_BY) + '</td><td>驗證人：' + escapeHtml(data.VALIDATED_BY) + '</td></tr>' +
               '<tr><td>全月總餐數：' + data.TOTAL_MEAL_COUNT + '</td><td>總金額：$' + data.GROSS_AMOUNT + '</td><td>自付總金額：$' + data.SELF_PAY_AMOUNT + '</td></tr>' +
               '</table>' +
               '<h2>補助資金來源彙整</h2>' +
               '<table class="detail-table">' +
               '<thead><tr><th>補助來源</th><th>餐數</th><th>原始餐額</th><th>分攤金額</th></tr></thead>' +
               '<tbody>' + fundingHtml + '</tbody>' +
               '</table>' +
               '<h2>用餐資格明細 (去識別化)</h2>' +
               '<table class="detail-table">' +
               '<thead><tr><th>日期</th><th>班級</th><th>學生姓名</th><th>餐數</th><th>單價</th></tr></thead>' +
               '<tbody>' + rowsHtml + '</tbody>' +
               '</table>' +
               '<div class="approval-section">' +
               '<div class="approval-box">承辦人</div>' +
               '<div class="approval-box">午餐秘書</div>' +
               '<div class="approval-box">主計/會計</div>' +
               '<div class="approval-box">單位主管</div>' +
               '<div class="approval-box">校長</div>' +
               '</div>' +
               '</body></html>';
                
    return html;
  }

  /**
   * 產生預覽報表 (Preview)
   */
  function generatePreviewReport(closingId, reportType, templateId) {
    AuthService.requireAnyRole(['system_admin', 'lunch_admin', 'accountant']);
    var closing = SheetRepository.findById('MonthClosings', 'closing_id', closingId);
    if (!closing) throw new Error('找不到月結項目');

    var template = SheetRepository.findById('ReportTemplates', 'template_id', templateId);
    if (!template) {
      template = getApplicableTemplate(reportType, closing.year_month + '-01');
    }
    if (!template) {
      // 記憶體中建立臨時 HTML fallback 範本，不寫入試算表
      template = {
        template_id: 'TMP_PREVIEW_FALLBACK',
        report_type: reportType,
        template_name: '預覽降級 fallback 範本',
        template_version: '1',
        template_format: 'HTML',
        privacy_level: 'INTERNAL_STUDENT_DETAIL',
        status: 'draft'
      };
    }

    var model = buildReportDataModel(closingId, template.privacy_level);
    
    // 建立臨時預覽資料夾
    var rootId = Config.getReportRootFolderId();
    var parent = DriveApp.getFolderById(rootId);
    var previewFolder = getOrCreateSubFolder(parent, 'previews_temp');

    var pdfFile = renderReportByFormat(template, model, previewFolder, true);
    
    return {
      success: true,
      fileId: pdfFile.getId(),
      fileUrl: pdfFile.getUrl(),
      fileName: pdfFile.getName()
    };
  }

  /**
   * 正式產生報表并存檔關聯 (Official)
   */
  function generateOfficialReport(closingId, reportType, templateId) {
    AuthService.requireAnyRole(['system_admin', 'lunch_admin']);
    var closing = SheetRepository.findById('MonthClosings', 'closing_id', closingId);
    if (!closing) throw new Error('找不到月結項目');
    if (closing.status !== 'closed') {
      throw new Error('🛑 報表錯誤：正式報表必須在月份鎖定 (closed) 狀態下才能產生！目前狀態: ' + closing.status);
    }

    var template = SheetRepository.findById('ReportTemplates', 'template_id', templateId);
    if (!template || template.status !== 'approved') {
      var err = new Error('🛑 報表錯誤：正式報表僅允許套用 Approved 範本！');
      err.code = 'DRAFT_TEMPLATE_NOT_ALLOWED';
      throw err;
    }

    var runId = 'RUN_REP_' + new Date().getTime();
    
    // 正式寫入 ReportGenerationRuns 狀態為 generating (page_count 設為 null)
    var runRecord = {
      report_run_id: runId,
      closing_id: closingId,
      closing_version: closing.closing_version,
      year_month: closing.year_month,
      report_type: reportType,
      template_id: template.template_id,
      template_version: template.template_version,
      status: 'generating',
      data_source_hash: closing.funding_source_hash || '',
      report_hash: '',
      output_file_id: '',
      output_file_url: '',
      output_mime_type: 'application/pdf',
      page_count: null,
      file_size: 0,
      started_by: AuthService.getCurrentIdentity().email,
      started_at: Utils.formatDateTime(new Date()),
      completed_at: '',
      failed_at: '',
      error_code: '',
      error_message: '',
      retry_of_run_id: '',
      is_current: true
    };
    SheetRepository.appendRecord('ReportGenerationRuns', runRecord);

    try {
      var schoolYear = Config.getSystemConfig('SCHOOL_YEAR', '115');
      var rootId = Config.getReportRootFolderId();
      var parent = DriveApp.getFolderById(rootId);
      
      var yrFolder = getOrCreateSubFolder(parent, schoolYear + '學年度');
      var mFolder = getOrCreateSubFolder(yrFolder, closing.year_month + '月結');
      var vFolder = getOrCreateSubFolder(mFolder, 'Closing_V' + closing.closing_version);
      var repFolder = getOrCreateSubFolder(vFolder, 'reports');
      var officialFolder = getOrCreateSubFolder(repFolder, 'official');

      var model = buildReportDataModel(closingId, template.privacy_level);
      var pdfFile = renderReportByFormat(template, model, officialFolder, false);

      var size = pdfFile.getSize();
      var rawBlob = pdfFile.getBlob();
      
      // 計算真正的 SHA256
      var rawBytes = rawBlob.getBytes();
      var rawHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, rawBytes);
      var hashHex = '';
      for (var i = 0; i < rawHash.length; i++) {
        var byteVal = rawHash[i];
        if (byteVal < 0) byteVal += 256;
        var byteString = byteVal.toString(16);
        if (byteString.length == 1) byteString = '0' + byteString;
        hashHex += byteString;
      }

      runRecord.status = 'completed';
      runRecord.output_file_id = pdfFile.getId();
      runRecord.output_file_url = pdfFile.getUrl();
      runRecord.file_size = size;
      runRecord.report_hash = hashHex;
      runRecord.completed_at = Utils.formatDateTime(new Date());

      SheetRepository.upsertRecord('ReportGenerationRuns', 'report_run_id', runId, runRecord);

      // 同步寫入 ClosingArtifacts 封存檔案關聯
      SheetRepository.appendRecord('ClosingArtifacts', {
        artifact_id: 'ART_REP_' + runId.substring(8),
        closing_id: closingId,
        year_month: closing.year_month,
        artifact_type: 'official_report_' + reportType,
        file_name: pdfFile.getName(),
        file_id: pdfFile.getId(),
        file_url: pdfFile.getUrl(),
        mime_type: 'application/pdf',
        sha256_hash: hashHex,
        file_size: size,
        calculation_version: closing.closing_version,
        generated_by: AuthService.getCurrentIdentity().email,
        generated_at: runRecord.completed_at,
        archived: false,
        note: '正式列印報表歸檔'
      });

      // 產生或升級 report_manifest.json 封存檔
      generateReportManifest(closingId, repFolder);

      AuditService.log({
        action: 'GENERATE_OFFICIAL_REPORT',
        module: 'reports',
        recordId: runId,
        reason: '成功完成正式關帳報表輸出PDF，年月：' + closing.year_month + '，報表別：' + reportType
      });

      return runRecord;

    } catch (e) {
      runRecord.status = 'failed';
      runRecord.failed_at = Utils.formatDateTime(new Date());
      runRecord.error_message = e.message;
      runRecord.error_code = e.code || 'GENERATION_ERROR';
      SheetRepository.upsertRecord('ReportGenerationRuns', 'report_run_id', runId, runRecord);
      throw e;
    }
  }

  /**
   * 生成報告清單清冊 report_manifest.json (包含 14 個必填欄位)
   */
  function generateReportManifest(closingId, repFolder) {
    var closing = SheetRepository.findById('MonthClosings', 'closing_id', closingId);
    if (!closing) return;

    var runs = SheetRepository.findRecords('ReportGenerationRuns', function(x) {
      return x.closing_id === closingId && x.status === 'completed' && x.is_current === true;
    });

    var reports = runs.map(function(run) {
      var tpl = SheetRepository.findById('ReportTemplates', 'template_id', run.template_id);
      var privacy = tpl ? tpl.privacy_level : 'INTERNAL_STUDENT_DETAIL';
      var renderer = tpl ? tpl.template_format : 'HTML';
      
      var file = DriveApp.getFileById(run.output_file_id);
      var name = file ? file.getName() : '';
      
      return {
        report_run_id: run.report_run_id,
        closing_id: run.closing_id,
        closing_version: String(run.closing_version),
        template_id: run.template_id,
        template_version: String(run.template_version),
        file_id: run.output_file_id,
        file_name: name,
        file_size: run.file_size,
        sha256: run.report_hash,
        generated_at: run.completed_at,
        generated_by: run.started_by,
        privacy_level: privacy,
        renderer: renderer,
        verification_status: 'PAGE_COUNT_NOT_VERIFIED'
      };
    });

    var manifest = {
      closing_id: closingId,
      closing_version: closing.closing_version,
      report_package_version: 'V' + closing.closing_version,
      generated_at: Utils.formatDateTime(new Date()),
      generated_by: AuthService.getCurrentIdentity().email,
      reports: reports,
      application_version: '5.0.0',
      schema_version: '5.0'
    };

    var manifestJson = JSON.stringify(manifest, null, 2);
    
    // 刪除舊的 report_manifest.json
    var oldFiles = repFolder.getFilesByName('report_manifest.json');
    while(oldFiles.hasNext()) {
      oldFiles.next().setTrashed(true);
    }

    var file = repFolder.createFile('report_manifest.json', manifestJson, MimeType.PLAIN_TEXT);
    return file.getId();
  }

  function getOrCreateSubFolder(parent, name) {
    var folders = parent.getFoldersByName(name);
    if (folders.hasNext()) {
      return folders.next();
    }
    return parent.createFolder(name);
  }

  function listApprovalRecords(reportRunId) {
    AuthService.requireAnyRole(['system_admin', 'lunch_admin', 'accountant']);
    return SheetRepository.findRecords('ApprovalRecords', function(x) {
      return x.report_run_id === reportRunId;
    });
  }

  function approveReport(reportRunId, stage, comment) {
    validateApprovalRoleForStage(stage);
    var identity = AuthService.getCurrentIdentity();
    var run = SheetRepository.findById('ReportGenerationRuns', 'report_run_id', reportRunId);
    if (!run) throw new Error('找不到報表批次');

    var apId = 'APP_' + new Date().getTime();
    var record = {
      approval_id: apId,
      closing_id: run.closing_id,
      report_run_id: reportRunId,
      approval_stage: stage,
      approver_role: identity.role,
      approver_email: identity.email,
      approver_name: identity.name || '',
      decision: 'approved',
      comment: comment || '核可通過',
      acted_at: Utils.formatDateTime(new Date()),
      source_hash: run.report_hash || '',
      created_at: Utils.formatDateTime(new Date())
    };

    SheetRepository.appendRecord('ApprovalRecords', record);

    // 寫入稽核日誌
    AuditService.log({
      action: 'APPROVE_REPORT',
      module: 'ReportService',
      recordId: reportRunId,
      beforeData: null,
      afterData: record,
      reason: comment || '核可通過'
    });

    return record;
  }

  function rejectReport(reportRunId, stage, comment) {
    validateApprovalRoleForStage(stage);
    var identity = AuthService.getCurrentIdentity();
    var run = SheetRepository.findById('ReportGenerationRuns', 'report_run_id', reportRunId);
    if (!run) throw new Error('找不到報表批次');

    var apId = 'APP_' + new Date().getTime();
    var record = {
      approval_id: apId,
      closing_id: run.closing_id,
      report_run_id: reportRunId,
      approval_stage: stage,
      approver_role: identity.role,
      approver_email: identity.email,
      approver_name: identity.name || '',
      decision: 'rejected',
      comment: comment || '核退或駁回',
      acted_at: Utils.formatDateTime(new Date()),
      source_hash: run.report_hash || '',
      created_at: Utils.formatDateTime(new Date())
    };

    SheetRepository.appendRecord('ApprovalRecords', record);

    // 寫入稽核日誌
    AuditService.log({
      action: 'REJECT_REPORT',
      module: 'ReportService',
      recordId: reportRunId,
      beforeData: null,
      afterData: record,
      reason: comment || '核退或駁回'
    });

    return record;
  }

  return {
    getApplicableTemplate: getApplicableTemplate,
    listReportTemplates: listReportTemplates,
    createReportTemplate: createReportTemplate,
    approveReportTemplate: approveReportTemplate,
    retireReportTemplate: retireReportTemplate,
    buildReportDataModel: buildReportDataModel,
    generatePreviewReport: generatePreviewReport,
    generateOfficialReport: generateOfficialReport,
    listApprovalRecords: listApprovalRecords,
    approveReport: approveReport,
    rejectReport: rejectReport
  };
})();
