/**
 * ReportService.gs
 * 正式報表、核章表與 PDF 歸檔服務 (Phase 6)
 */

var ReportService = (function() {

  /**
   * 取得有效且核准的報表範本
   */
  function getApplicableTemplate(reportType, dateStr) {
    var ym = dateStr.substring(0, 7);
    var templates = SheetRepository.findRecords('ReportTemplates', function(x) {
      return x.report_type === reportType && 
             x.status === 'approved' && 
             x.enabled === true;
    });

    if (templates.length === 0) return null;
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
    var schoolYear = Config.get('SCHOOL_YEAR') || '115';
    var semester = Config.get('SEMESTER') || '1';

    // 載入封存快照資料 (必須以 closed 封存快照為準，不得讀取動態資料表)
    var artifacts = SheetRepository.findRecords('ClosingArtifacts', function(x) {
      return x.closing_id === closingId && x.archived === false;
    });

    // 載入 Ledgers 快照
    var ledgerArt = artifacts.filter(function(x) { return x.artifact_type === 'dailyMealLedger_export'; })[0];
    var ledgers = [];
    if (ledgerArt) {
      ledgers = loadCsvFromDrive(ledgerArt.file_id);
    }

    // 載入 allocations 快照
    var allocArt = artifacts.filter(function(x) { return x.artifact_type === 'fundingAllocationLedger_export'; })[0];
    var allocs = [];
    if (allocArt) {
      allocs = loadCsvFromDrive(allocArt.file_id);
    }

    // 載入 summaries 快照
    var fSumArt = artifacts.filter(function(x) { return x.artifact_type === 'monthlyFundingSummary_export'; })[0];
    var fSums = [];
    if (fSumArt) {
      fSums = loadCsvFromDrive(fSumArt.file_id);
    }

    // 計算各來源加總 (Yuan)
    var townshipYuan = MoneyService.minorToYuan(closing.allocated_amount_minor || 0); // 示意，細分計算
    var selfPayYuan = MoneyService.minorToYuan(closing.residual_amount_minor || 0);

    // 套用個資隱私權限等級遮罩
    var dailyRows = [];
    ledgers.forEach(function(l) {
      if (l.eligible_meal_count === '1' || l.eligible_meal_count === 1) {
        var name = l.student_name_masked || '';
        if (privacyLevel === 'PUBLIC_SUMMARY') {
          name = '***';
        } else if (privacyLevel === 'INTERNAL_STUDENT_DETAIL') {
          // 遮罩姓名
          name = l.student_name_masked || '';
        }
        
        dailyRows.push({
          date: l.date,
          class_code: l.class_code_snapshot,
          student_name: name,
          meal_count: 1,
          meal_price: parseFloat(l.meal_price_snapshot) || 0
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
      SCHOOL_NAME: Config.get('SCHOOL_NAME') || '實機實驗學校',
      SCHOOL_CODE: Config.get('SCHOOL_CODE') || 'SCH001',
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
      GROSS_AMOUNT: MoneyService.minorToYuan(closing.gross_amount_minor || 0),
      TOWNSHIP_AMOUNT: townshipYuan,
      COUNTY_AMOUNT: '0.00',
      SCHOOL_AMOUNT: '0.00',
      SELF_PAY_AMOUNT: selfPayYuan,
      OTHER_AMOUNT: '0.00',
      RESIDUAL_AMOUNT: '0.00',
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

  function loadCsvFromDrive(fileId) {
    if (!fileId) return [];
    try {
      var file = DriveApp.getFileById(fileId);
      var csvText = file.getBlob().getDataAsString('UTF-8');
      return parseCsvText(csvText);
    } catch(e) {
      return [];
    }
  }

  function parseCsvText(text) {
    var lines = text.split('\n');
    if (lines.length <= 1) return [];
    var headers = lines[0].split(',').map(function(h) { return h.trim(); });
    
    var list = [];
    for (var i = 1; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line === '') continue;
      
      // 簡易 CSV 逗號拆分，容忍帶引號
      var cells = [];
      var inQuote = false;
      var current = '';
      for (var j = 0; j < line.length; j++) {
        var char = line.charAt(j);
        if (char === '"') {
          inQuote = !inQuote;
        } else if (char === ',' && !inQuote) {
          cells.push(current);
          current = '';
        } else {
          current += char;
        }
      }
      cells.push(current);

      var obj = {};
      headers.forEach(function(h, idx) {
        obj[h] = cells[idx] || '';
      });
      list.push(obj);
    }
    return list;
  }

  /**
   * 渲染 HTML 報本並存為 PDF (支援浮水印)
   */
  function renderHtmlTemplate(templateRecord, dataModel, outputFolder, isPreview) {
    var htmlContent = getApplicableHtmlContent(templateRecord.report_type, dataModel, isPreview);
    
    var fileName = Config.get('SCHOOL_CODE') + '_' + dataModel.YEAR_MONTH.replace('-', '') + '_' + 
                   templateRecord.report_type + '_Closing' + dataModel.CLOSING_VERSION + 
                   '_TemplateV' + templateRecord.template_version;
                   
    if (isPreview) {
      fileName += '_PREVIEW';
    }
    fileName += '.pdf';

    // 建立臨時 HTML 檔案供 conversion
    var tempFile = outputFolder.createFile('temp_render_' + new Date().getTime() + '.html', htmlContent, MimeType.HTML);
    
    // 轉換為 PDF Blob
    var blob = tempFile.getAs('application/pdf');
    blob.setName(fileName);
    
    var pdfFile = outputFolder.createFile(blob);
    
    // 清理臨時 HTML 檔
    outputFolder.removeFile(tempFile);

    return pdfFile;
  }

  /**
   * 取得通用 HTML 範本內容 (當無上傳範本時的萬用降級範本)
   */
  function getApplicableHtmlContent(reportType, data, isPreview) {
    var watermarkStyle = isPreview ? 
      'background-image: url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'400\' height=\'400\'><text x=\'50\' y=\'200\' fill=\'rgba(255,0,0,0.15)\' font-size=\'30\' font-family=\'Arial\' transform=\'rotate(-30 150 150)\'>預覽文件－非正式申請資料</text></svg>"); background-repeat: repeat;' : '';

    var rowsHtml = data.DAILY_ROWS.map(function(r) {
      return '<tr><td>' + r.date + '</td><td>' + r.class_code + '</td><td>' + r.student_name + '</td><td>' + r.meal_count + '</td><td>$' + r.meal_price.toFixed(2) + '</td></tr>';
    }).join('');

    var fundingHtml = data.FUNDING_ROWS.map(function(f) {
      return '<tr><td>' + f.funding_source + '</td><td>' + f.meal_count + '</td><td>$' + f.gross_amount + '</td><td>$' + f.final_amount + '</td></tr>';
    }).join('');

    var html = '<!DOCTYPE html><html><head><meta charset="utf-8"/><title>' + reportType + '</title>' +
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
               '<h1>' + data.SCHOOL_NAME + ' - ' + reportType + ' (' + data.YEAR_MONTH + ')</h1>' +
               '<hr/>' +
               '<table class="metadata-table">' +
               '<tr><td>學年度：' + data.SCHOOL_YEAR + '</td><td>學期：' + data.SEMESTER + '</td><td>月結版本：' + data.CLOSING_VERSION + '</td></tr>' +
               '<tr><td>月結識別碼：' + data.CLOSING_ID + '</td><td>關帳製表：' + data.PREPARED_BY + '</td><td>驗證人：' + data.VALIDATED_BY + '</td></tr>' +
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
    var closing = SheetRepository.findById('MonthClosings', 'closing_id', closingId);
    if (!closing) throw new Error('找不到月結項目');

    var template = SheetRepository.findById('ReportTemplates', 'template_id', templateId);
    if (!template) {
      template = getApplicableTemplate(reportType, closing.year_month + '-01');
    }
    if (!template) {
      template = createReportTemplate({
        report_type: reportType,
        template_name: '通用版 ' + reportType,
        template_version: '1',
        template_format: 'HTML',
        privacy_level: 'INTERNAL_STUDENT_DETAIL'
      });
      template = approveReportTemplate(template.template_id);
    }

    var model = buildReportDataModel(closingId, template.privacy_level);
    
    // 建立臨時預覽資料夾
    var rootId = Config.getReportRootFolderId();
    var parent = DriveApp.getFolderById(rootId);
    var previewFolder = getOrCreateSubFolder(parent, 'previews_temp');

    var pdfFile = renderHtmlTemplate(template, model, previewFolder, true);
    
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
    var closing = SheetRepository.findById('MonthClosings', 'closing_id', closingId);
    if (!closing) throw new Error('找不到月結項目');
    if (closing.status !== 'closed') {
      throw new Error('🛑 報表錯誤：正式報表必須在月份鎖定 (closed) 狀態下才能產生！目前狀態: ' + closing.status);
    }

    var template = SheetRepository.findById('ReportTemplates', 'template_id', templateId);
    if (!template || template.status !== 'approved') {
      throw new Error('🛑 報表錯誤：正式報表僅允許套用 Approved 範本！');
    }

    var runId = 'RUN_REP_' + new Date().getTime();
    
    // 正式寫入 ReportGenerationRuns 狀態為 generating
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
      page_count: 1,
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
      var schoolYear = Config.get('SCHOOL_YEAR') || '115';
      var rootId = Config.getReportRootFolderId();
      var parent = DriveApp.getFolderById(rootId);
      
      var yrFolder = getOrCreateSubFolder(parent, schoolYear + '學年度');
      var mFolder = getOrCreateSubFolder(yrFolder, closing.year_month + '月結');
      var vFolder = getOrCreateSubFolder(mFolder, 'Closing_V' + closing.closing_version);
      var repFolder = getOrCreateSubFolder(vFolder, 'reports');
      var officialFolder = getOrCreateSubFolder(repFolder, 'official');

      var model = buildReportDataModel(closingId, template.privacy_level);
      var pdfFile = renderHtmlTemplate(template, model, officialFolder, false);

      var size = pdfFile.getSize();
      var rawBlob = pdfFile.getBlob();
      var rawString = rawBlob.getDataAsString('UTF-8');
      
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
   * 生成報告清單清冊 report_manifest.json (Phase 6 新增)
   */
  function generateReportManifest(closingId, repFolder) {
    var closing = SheetRepository.findById('MonthClosings', 'closing_id', closingId);
    if (!closing) return;

    var runs = SheetRepository.findRecords('ReportGenerationRuns', function(x) {
      return x.closing_id === closingId && x.status === 'completed';
    });

    var artifacts = SheetRepository.findRecords('ClosingArtifacts', function(x) {
      return x.closing_id === closingId && x.artifact_type.indexOf('official_report_') === 0 && x.archived === false;
    });

    // 取得 closing_manifest_file_id 快照 hash
    var closeManifestHash = '';
    var closeManifestId = '';
    var closeManifestArt = SheetRepository.findRecords('ClosingArtifacts', function(x) {
      return x.closing_id === closingId && x.artifact_type === 'closing_manifest';
    })[0];
    if (closeManifestArt) {
      closeManifestHash = closeManifestArt.sha256_hash;
      closeManifestId = closeManifestArt.file_id;
    }

    var manifest = {
      closing_id: closingId,
      closing_version: closing.closing_version,
      closing_manifest_file_id: closeManifestId,
      closing_manifest_sha256: closeManifestHash,
      report_package_version: 'V' + closing.closing_version,
      generated_at: Utils.formatDateTime(new Date()),
      generated_by: AuthService.getCurrentIdentity().email,
      reports: artifacts.map(function(a) {
        return {
          file_name: a.file_name,
          file_id: a.file_id,
          mime_type: a.mime_type,
          file_size: a.file_size,
          sha256_hash: a.sha256_hash
        };
      }),
      application_version: '5.0.0',
      schema_version: '5.0'
    };

    var manifestJson = JSON.stringify(manifest, null, 2);
    
    // 刪除舊的 report_manifest.json
    var oldFiles = repFolder.getFilesByName('report_manifest.json');
    while(oldFiles.hasNext()) {
      repFolder.removeFile(oldFiles.next());
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
    return SheetRepository.findRecords('ApprovalRecords', function(x) {
      return x.report_run_id === reportRunId;
    });
  }

  function approveReport(reportRunId, stage, comment) {
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
    return record;
  }

  function rejectReport(reportRunId, stage, comment) {
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
