/**
 * ImportService.gs
 * 學生名冊匯入服務 (包含六階段匯入與強化交易補償設計)
 */

var ImportService = (function() {

  /**
   * 計算雜湊值 (MD5) 以防範重複提交相同資料
   */
  function computeMD5(str) {
    var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, str, Utilities.Charset.UTF_8);
    var hash = '';
    for (var i = 0; i < digest.length; i++) {
      var byteVal = digest[i];
      if (byteVal < 0) byteVal += 256;
      var byteString = byteVal.toString(16);
      if (byteString.length === 1) byteString = '0' + byteString;
      hash += byteString;
    }
    return hash;
  }

  /**
   * 解析上傳文字 (支援 CSV, TSV 與 Excel/Google Sheets 貼上)
   * @param {string} payloadStr 貼上的原始文字
   * @return {string[][]} 欄位二維陣列
   */
  function parseRawText(payloadStr) {
    if (!payloadStr) return [];
    
    var lines = payloadStr.split(/\r?\n/);
    var rawRows = [];

    var firstLine = lines[0] || '';
    var separator = ',';
    if (firstLine.indexOf('\t') !== -1) {
      separator = '\t';
    }

    lines.forEach(function(line) {
      var cleanLine = line.trim();
      if (!cleanLine) return;
      
      var cells = [];
      var current = '';
      var inQuotes = false;
      
      for (var i = 0; i < cleanLine.length; i++) {
        var char = cleanLine.charAt(i);
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === separator && !inQuotes) {
          cells.push(current);
          current = '';
        } else {
          current += char;
        }
      }
      cells.push(current);

      var cleanCells = cells.map(function(c) {
        var s = c.trim();
        if (s.indexOf('"') === 0 && s.lastIndexOf('"') === s.length - 1 && s.length > 1) {
          s = s.substring(1, s.length - 1);
        }
        return s;
      });

      rawRows.push(cleanCells);
    });

    return rawRows;
  }

  /**
   * 階段 1 & 2: 解析並對應欄位
   */
  function parseStudentImport(payloadStr) {
    var rawRows = parseRawText(payloadStr);
    if (rawRows.length < 2) {
      throw new Error('匯入資料筆數不足 (必須包含欄位列與至少一列資料)');
    }

    var headers = rawRows[0];
    var headerMapping = ImportValidationService.mapHeaders(headers);
    
    var mappedKeys = Object.keys(headerMapping).map(function(k) { return headerMapping[k]; });
    if (mappedKeys.indexOf('student_name') === -1) {
      throw new Error('欄位標題無法辨識「學生姓名」或「姓名」，請檢查欄位首行。');
    }
    if (mappedKeys.indexOf('class_code') === -1) {
      throw new Error('欄位標題無法辨識「班級」或「班級代碼」，請檢查欄位首行。');
    }

    var parsedRows = [];
    for (var i = 1; i < rawRows.length; i++) {
      var row = rawRows[i];
      var rowObj = {};
      
      headers.forEach(function(h, idx) {
        var standardKey = headerMapping[idx];
        if (standardKey) {
          rowObj[standardKey] = row[idx] !== undefined ? row[idx] : '';
        }
      });

      parsedRows.push(rowObj);
    }

    return parsedRows;
  }

  /**
   * 階段 3, 4 & 5: 正規化、驗證與預覽
   */
  function validateStudentImport(parsedRows, schoolYear) {
    AuthService.requireAnyRole(['system_admin', 'lunch_admin']);

    var existingStudents = SheetRepository.getAllRecords('Students');
    var classes = SheetRepository.getAllRecords('Classes');
    var categories = SheetRepository.getAllRecords('SubsidyCategories');
    var dietaryTypes = DietaryTypeService.getDietaryTypes();

    var uniqueMap = {};
    var validatedRows = [];
    var summary = { create: 0, update: 0, skip: 0, error: 0, conflict: 0 };

    parsedRows.forEach(function(row) {
      var val = ImportValidationService.validateRow(
        row, existingStudents, classes, categories, dietaryTypes, uniqueMap, schoolYear
      );

      var actionKey = val.action.toLowerCase();
      if (summary[actionKey] !== undefined) {
        summary[actionKey]++;
      }

      validatedRows.push({
        action: val.action,
        normalizedData: val.normalizedData,
        errors: val.errors,
        warnings: val.warnings,
        matchedStudent: val.matchedStudent ? {
          student_id: val.matchedStudent.student_id,
          student_name: val.matchedStudent.student_name,
          class_id: val.matchedStudent.class_id,
          subsidy_category_id: val.matchedStudent.subsidy_category_id,
          seat_number: val.matchedStudent.seat_number
        } : null
      });
    });

    var payloadHash = computeMD5(JSON.stringify(parsedRows));

    return {
      rows: validatedRows,
      summary: summary,
      payloadHash: payloadHash
    };
  }

  /**
   * 批次準備：建立 ImportBatches 標記為 committing
   */
  function prepareImportBatch(batchRecord) {
    SheetRepository.appendRecord('ImportBatches', batchRecord);
  }

  /**
   * 紀錄逐筆變更至 ImportBatchItems
   */
  function recordImportBatchItems(batchId, items) {
    items.forEach(function(item) {
      SheetRepository.appendRecord('ImportBatchItems', item);
    });
  }

  /**
   * 批次提交成功：標記 items 與 batch 為 completed
   */
  function commitImportBatch(batchId, items) {
    items.forEach(function(item) {
      SheetRepository.upsertRecord('ImportBatchItems', 'import_batch_item_id', item.import_batch_item_id, item);
    });

    var batch = SheetRepository.findById('ImportBatches', 'import_batch_id', batchId);
    if (batch) {
      batch.status = 'completed';
      batch.rollback_status = 'not_required';
      batch.completed_at = Utils.formatDateTime(new Date());
      SheetRepository.upsertRecord('ImportBatches', 'import_batch_id', batchId, batch);
    }
  }

  /**
   * 補償交易核心 (Rollback)：按反向順序還原變更，具備冪等性
   */
  function rollbackImportBatch(batchId) {
    var items = SheetRepository.findRecords('ImportBatchItems', function(x) { return x.import_batch_id === batchId; });
    
    // 按反向順序 (REVERSE) 執行，以保證歷史歷程正常還原
    items.reverse();
    
    var partialFailed = false;
    var currentDateTime = Utils.formatDateTime(new Date());
    
    items.forEach(function(item) {
      // 已經回復過的，不再重做以符合冪等性
      if (item.operation_status === 'rolled_back') return;
      
      try {
        var targetSheet = item.target_sheet;
        var recordId = item.target_record_id;
        var pkName = (targetSheet === 'Students') ? 'student_id' : 'history_id';
        
        if (item.action_type === 'CREATE' || item.action_type === 'CREATE_HISTORY') {
          // 刪除建立的紀錄
          SheetRepository.deleteRecordById(targetSheet, pkName, recordId);
        } else if (item.action_type === 'UPDATE' || item.action_type === 'CLOSE_HISTORY') {
          // 還原為 before_data
          var originalRecord = JSON.parse(item.before_data);
          SheetRepository.upsertRecord(targetSheet, pkName, recordId, originalRecord);
        }
        
        item.operation_status = 'rolled_back';
        item.rolled_back_at = currentDateTime;
        item.rollback_status = 'completed';
        item.error_message = '';
        
      } catch (err) {
        partialFailed = true;
        item.operation_status = 'failed';
        item.rollback_status = 'failed';
        item.error_message = err.message;
      }
      
      SheetRepository.upsertRecord('ImportBatchItems', 'import_batch_item_id', item.import_batch_item_id, item);
    });
    
    // 更新批次主表狀態
    var batch = SheetRepository.findById('ImportBatches', 'import_batch_id', batchId);
    if (batch) {
      batch.rollback_status = partialFailed ? 'partial_failed' : 'completed';
      batch.status = 'failed'; // 匯入依然定義為失敗
      batch.failed_at = currentDateTime;
      SheetRepository.upsertRecord('ImportBatches', 'import_batch_id', batchId, batch);
    }
  }

  /**
   * 手動重新執行失敗的回復
   */
  function retryFailedRollback(batchId) {
    AuthService.requireRole('system_admin');
    var items = SheetRepository.findRecords('ImportBatchItems', function(x) { 
      return x.import_batch_id === batchId && x.operation_status === 'failed'; 
    });
    
    var partialFailed = false;
    var currentDateTime = Utils.formatDateTime(new Date());
    
    items.forEach(function(item) {
      try {
        var targetSheet = item.target_sheet;
        var recordId = item.target_record_id;
        var pkName = (targetSheet === 'Students') ? 'student_id' : 'history_id';
        
        if (item.action_type === 'CREATE' || item.action_type === 'CREATE_HISTORY') {
          SheetRepository.deleteRecordById(targetSheet, pkName, recordId);
        } else if (item.action_type === 'UPDATE' || item.action_type === 'CLOSE_HISTORY') {
          var originalRecord = JSON.parse(item.before_data);
          SheetRepository.upsertRecord(targetSheet, pkName, recordId, originalRecord);
        }
        
        item.operation_status = 'rolled_back';
        item.rolled_back_at = currentDateTime;
        item.rollback_status = 'completed';
        item.error_message = '';
      } catch (err) {
        partialFailed = true;
        item.operation_status = 'failed';
        item.rollback_status = 'failed';
        item.error_message = err.message;
      }
      SheetRepository.upsertRecord('ImportBatchItems', 'import_batch_item_id', item.import_batch_item_id, item);
    });
    
    var batch = SheetRepository.findById('ImportBatches', 'import_batch_id', batchId);
    if (batch) {
      batch.rollback_status = partialFailed ? 'partial_failed' : 'completed';
      SheetRepository.upsertRecord('ImportBatches', 'import_batch_id', batchId, batch);
    }
  }

  /**
   * 驗證匯入一致性
   */
  function verifyImportBatchConsistency(batchId) {
    var items = SheetRepository.findRecords('ImportBatchItems', function(x) { return x.import_batch_id === batchId; });
    var inconsistentCount = 0;
    
    items.forEach(function(item) {
      var targetSheet = item.target_sheet;
      var recordId = item.target_record_id;
      var pkName = (targetSheet === 'Students') ? 'student_id' : 'history_id';
      
      var currentRecord = SheetRepository.findById(targetSheet, pkName, recordId);
      
      if (item.operation_status === 'completed') {
        if (!currentRecord) {
          inconsistentCount++;
        } else {
          var expected = JSON.parse(item.after_data);
          if (targetSheet === 'Students' && currentRecord.student_name !== expected.student_name) {
            inconsistentCount++;
          }
        }
      } else if (item.operation_status === 'rolled_back') {
        if (item.action_type === 'CREATE' || item.action_type === 'CREATE_HISTORY') {
          if (currentRecord) inconsistentCount++;
        }
      }
    });
    
    return {
      consistent: inconsistentCount === 0,
      inconsistent_count: inconsistentCount
    };
  }

  /**
   * 提交學生大宗匯入 (核心事務控管)
   */
  function commitStudentImport(validatedRows, schoolYear, originalFilename, payloadHash) {
    AuthService.requireAnyRole(['system_admin', 'lunch_admin']);
    var identity = AuthService.getCurrentIdentity();
    var currentDateTime = Utils.formatDateTime(new Date());

    // 1. 重複提交校驗
    var existingBatch = SheetRepository.findById('ImportBatches', 'payload_hash', payloadHash);
    if (existingBatch && existingBatch.status === 'completed') {
      throw new Error('此份資料已於 ' + existingBatch.completed_at + ' 被成功匯入，請勿重複提交。');
    }

    var batchId = Utils.generateUUID();
    var totalRows = validatedRows.length;

    var counts = { create: 0, update: 0, skip: 0, error: 0 };
    validatedRows.forEach(function(r) {
      counts[r.action.toLowerCase()]++;
    });

    var batchRecord = {
      import_batch_id: batchId,
      import_type: 'student_import',
      original_filename: originalFilename || '直貼文字匯入',
      total_rows: totalRows,
      create_count: counts.create,
      update_count: counts.update,
      skip_count: counts.skip,
      error_count: counts.error,
      status: 'committing',
      started_by: identity.email,
      started_at: currentDateTime,
      completed_at: '',
      failed_at: '',
      error_message: '',
      rollback_status: 'none',
      payload_hash: payloadHash
    };

    // A. 建立 ImportBatches (committing 狀態)
    prepareImportBatch(batchRecord);

    // B. 使用 ScriptLock 執行寫入
    var lockResult = LockServiceHelper.runWithLock(function() {
      try {
        // 確保所有匯入項目不影響已月結鎖定月份
        for (var i = 0; i < validatedRows.length; i++) {
          var r = validatedRows[i];
          if (r.normalizedData && r.normalizedData.start_date) {
            PeriodLockService.assertDateWritable(r.normalizedData.start_date);
          }
        }

        var dbStudents = SheetRepository.getAllRecords('Students');
        var dbClasses = SheetRepository.getAllRecords('Classes');
        var dbCategories = SheetRepository.getAllRecords('SubsidyCategories');
        var dbDietaryTypes = DietaryTypeService.getDietaryTypes();
        var tempUniqueMap = {};

        // 重新驗證來源資料
        for (var i = 0; i < validatedRows.length; i++) {
          var r = validatedRows[i];
          var val = ImportValidationService.validateRow(
            r.normalizedData, dbStudents, dbClasses, dbCategories, dbDietaryTypes, tempUniqueMap, schoolYear
          );
          if (val.errors.length > 0) {
            throw new Error('匯入資料未通過後端安全校驗，第 ' + (i + 1) + ' 列包含錯誤: ' + val.errors.join('; '));
          }
        }

        // C. 建立所有 ImportBatchItems pending 紀錄
        var batchItems = [];
        validatedRows.forEach(function(r, index) {
          var norm = r.normalizedData;
          var rowNo = index + 2;

          if (r.action === 'CREATE') {
            var newStudentId = Utils.generateUUID();
            var newStudent = {
              student_id: newStudentId,
              student_number: norm.student_number || '',
              school_year: parseInt(schoolYear, 10),
              class_id: norm.class_id,
              seat_number: norm.seat_number,
              student_name: norm.student_name,
              subsidy_category_id: norm.subsidy_category_id,
              dietary_type: norm.dietary_type,
              meal_status: 'normal',
              start_date: norm.start_date || Utils.formatDate(new Date()),
              end_date: '',
              enabled: true,
              note: norm.note || '',
              created_at: currentDateTime,
              created_by: identity.email,
              updated_at: currentDateTime,
              updated_by: identity.email
            };
            batchItems.push({
              import_batch_item_id: Utils.generateUUID(),
              import_batch_id: batchId,
              source_row_number: rowNo,
              student_id: newStudentId,
              action_type: 'CREATE',
              target_sheet: 'Students',
              target_record_id: newStudentId,
              before_data: '',
              after_data: JSON.stringify(newStudent),
              operation_status: 'pending',
              committed_at: '',
              rolled_back_at: '',
              rollback_status: 'none',
              error_message: '',
              created_at: currentDateTime
            });

            // 初始班級歷程
            var chId = Utils.generateUUID();
            var ch = {
              history_id: chId,
              student_id: newStudentId,
              class_id: norm.class_id,
              effective_start_date: newStudent.start_date,
              effective_end_date: '',
              change_reason: '初始就讀班級建立',
              enabled: true,
              created_by: identity.email,
              created_at: currentDateTime,
              updated_by: identity.email,
              updated_at: currentDateTime
            };
            batchItems.push({
              import_batch_item_id: Utils.generateUUID(),
              import_batch_id: batchId,
              source_row_number: rowNo,
              student_id: newStudentId,
              action_type: 'CREATE_HISTORY',
              target_sheet: 'StudentClassHistory',
              target_record_id: chId,
              before_data: '',
              after_data: JSON.stringify(ch),
              operation_status: 'pending',
              committed_at: '',
              rolled_back_at: '',
              rollback_status: 'none',
              error_message: '',
              created_at: currentDateTime
            });

            // 初始補助歷程
            var shId = Utils.generateUUID();
            var sh = {
              history_id: shId,
              student_id: newStudentId,
              subsidy_category_id: norm.subsidy_category_id,
              effective_start_date: newStudent.start_date,
              effective_end_date: '',
              change_reason: '初始補助身分建立',
              source_document_no: '',
              enabled: true,
              created_by: identity.email,
              created_at: currentDateTime,
              updated_by: identity.email,
              updated_at: currentDateTime
            };
            batchItems.push({
              import_batch_item_id: Utils.generateUUID(),
              import_batch_id: batchId,
              source_row_number: rowNo,
              student_id: newStudentId,
              action_type: 'CREATE_HISTORY',
              target_sheet: 'StudentSubsidyHistory',
              target_record_id: shId,
              before_data: '',
              after_data: JSON.stringify(sh),
              operation_status: 'pending',
              committed_at: '',
              rolled_back_at: '',
              rollback_status: 'none',
              error_message: '',
              created_at: currentDateTime
            });

          } else if (r.action === 'UPDATE') {
            var targetId = r.matchedStudent.student_id;
            var oldStudent = dbStudents.filter(function(s) { return s.student_id === targetId; })[0];
            if (oldStudent) {
              var updatedStudent = JSON.parse(JSON.stringify(oldStudent));
              updatedStudent.student_name = norm.student_name;
              updatedStudent.seat_number = norm.seat_number;
              updatedStudent.dietary_type = norm.dietary_type;
              updatedStudent.note = norm.note;
              updatedStudent.updated_at = currentDateTime;
              updatedStudent.updated_by = identity.email;

              batchItems.push({
                import_batch_item_id: Utils.generateUUID(),
                import_batch_id: batchId,
                source_row_number: rowNo,
                student_id: targetId,
                action_type: 'UPDATE',
                target_sheet: 'Students',
                target_record_id: targetId,
                before_data: JSON.stringify(oldStudent),
                after_data: JSON.stringify(updatedStudent),
                operation_status: 'pending',
                committed_at: '',
                rolled_back_at: '',
                rollback_status: 'none',
                error_message: '',
                created_at: currentDateTime
              });

              // 檢測是否需要轉班
              if (oldStudent.class_id !== norm.class_id) {
                var oldCh = StudentClassHistoryService.getCurrentClass(targetId);
                if (oldCh) {
                  var updatedOldCh = JSON.parse(JSON.stringify(oldCh));
                  var effDate = norm.start_date || Utils.formatDate(new Date());
                  var prevDate = Utils.formatDate(new Date(new Date(effDate).getTime() - 86400000));
                  updatedOldCh.effective_end_date = prevDate;
                  updatedOldCh.updated_at = currentDateTime;
                  updatedOldCh.updated_by = identity.email;

                  batchItems.push({
                    import_batch_item_id: Utils.generateUUID(),
                    import_batch_id: batchId,
                    source_row_number: rowNo,
                    student_id: targetId,
                    action_type: 'CLOSE_HISTORY',
                    target_sheet: 'StudentClassHistory',
                    target_record_id: oldCh.history_id,
                    before_data: JSON.stringify(oldCh),
                    after_data: JSON.stringify(updatedOldCh),
                    operation_status: 'pending',
                    committed_at: '',
                    rolled_back_at: '',
                    rollback_status: 'none',
                    error_message: '',
                    created_at: currentDateTime
                  });
                }
                
                var newChId = Utils.generateUUID();
                var newCh = {
                  history_id: newChId,
                  student_id: targetId,
                  class_id: norm.class_id,
                  effective_start_date: norm.start_date || Utils.formatDate(new Date()),
                  effective_end_date: '',
                  change_reason: '批次匯入換班',
                  enabled: true,
                  created_by: identity.email,
                  created_at: currentDateTime,
                  updated_by: identity.email,
                  updated_at: currentDateTime
                };
                batchItems.push({
                  import_batch_item_id: Utils.generateUUID(),
                  import_batch_id: batchId,
                  source_row_number: rowNo,
                  student_id: targetId,
                  action_type: 'CREATE_HISTORY',
                  target_sheet: 'StudentClassHistory',
                  target_record_id: newChId,
                  before_data: '',
                  after_data: JSON.stringify(newCh),
                  operation_status: 'pending',
                  committed_at: '',
                  rolled_back_at: '',
                  rollback_status: 'none',
                  error_message: '',
                  created_at: currentDateTime
                });
              }

              // 檢測是否需要身分異動
              if (oldStudent.subsidy_category_id !== norm.subsidy_category_id) {
                var oldSh = StudentSubsidyHistoryService.getCurrentSubsidyCategory(targetId);
                if (oldSh) {
                  var updatedOldSh = JSON.parse(JSON.stringify(oldSh));
                  var effDate = norm.start_date || Utils.formatDate(new Date());
                  var prevDate = Utils.formatDate(new Date(new Date(effDate).getTime() - 86400000));
                  updatedOldSh.effective_end_date = prevDate;
                  updatedOldSh.updated_at = currentDateTime;
                  updatedOldSh.updated_by = identity.email;

                  batchItems.push({
                    import_batch_item_id: Utils.generateUUID(),
                    import_batch_id: batchId,
                    source_row_number: rowNo,
                    student_id: targetId,
                    action_type: 'CLOSE_HISTORY',
                    target_sheet: 'StudentSubsidyHistory',
                    target_record_id: oldSh.history_id,
                    before_data: JSON.stringify(oldSh),
                    after_data: JSON.stringify(updatedOldSh),
                    operation_status: 'pending',
                    committed_at: '',
                    rolled_back_at: '',
                    rollback_status: 'none',
                    error_message: '',
                    created_at: currentDateTime
                  });
                }

                var newShId = Utils.generateUUID();
                var newSh = {
                  history_id: newShId,
                  student_id: targetId,
                  subsidy_category_id: norm.subsidy_category_id,
                  effective_start_date: norm.start_date || Utils.formatDate(new Date()),
                  effective_end_date: '',
                  change_reason: '批次匯入身分異動',
                  source_document_no: '',
                  enabled: true,
                  created_by: identity.email,
                  created_at: currentDateTime,
                  updated_by: identity.email,
                  updated_at: currentDateTime
                };
                batchItems.push({
                  import_batch_item_id: Utils.generateUUID(),
                  import_batch_id: batchId,
                  source_row_number: rowNo,
                  student_id: targetId,
                  action_type: 'CREATE_HISTORY',
                  target_sheet: 'StudentSubsidyHistory',
                  target_record_id: newShId,
                  before_data: '',
                  after_data: JSON.stringify(newSh),
                  operation_status: 'pending',
                  committed_at: '',
                  rolled_back_at: '',
                  rollback_status: 'none',
                  error_message: '',
                  created_at: currentDateTime
                });
              }
            }
          }
        });

        // 寫入 ImportBatchItems 預備列
        recordImportBatchItems(batchId, batchItems);

        // 批次寫入資料庫
        batchItems.forEach(function(item) {
          var targetContent = JSON.parse(item.after_data);
          if (item.action_type === 'CREATE' || item.action_type === 'CREATE_HISTORY') {
            SheetRepository.appendRecord(item.target_sheet, targetContent);
          } else if (item.action_type === 'UPDATE' || item.action_type === 'CLOSE_HISTORY') {
            var pkName = item.target_sheet === 'Students' ? 'student_id' : 'history_id';
            SheetRepository.upsertRecord(item.target_sheet, pkName, item.target_record_id, targetContent);
          }
          item.operation_status = 'completed';
          item.committed_at = Utils.formatDateTime(new Date());
        });

        // 寫入 AuditLogs
        AuditService.log({
          action: 'IMPORT_STUDENTS',
          module: 'import',
          recordId: batchId,
          afterData: { total_rows: totalRows, create_count: counts.create, update_count: counts.update },
          reason: '批次匯入學生名冊成功'
        });

        // 標記批次與項目完成
        commitImportBatch(batchId, batchItems);

        Config.clearAllCache();

      } catch (err) {
        // 任何一步失敗，寫入 failed 並啟動自動 Rollback
        var finalBatch = JSON.parse(JSON.stringify(batchRecord));
        finalBatch.status = 'failed';
        finalBatch.failed_at = Utils.formatDateTime(new Date());
        finalBatch.error_message = err.message;
        SheetRepository.upsertRecord('ImportBatches', 'import_batch_id', batchId, finalBatch);

        rollbackImportBatch(batchId);

        AuditService.log({
          action: 'IMPORT_FAILED',
          module: 'import',
          recordId: batchId,
          reason: '批次匯入學生失敗，已觸發自動補償回復。原因: ' + err.message
        });

        throw err;
      }
    });

    return {
      batchId: batchId,
      success: lockResult.success,
      error: lockResult.error
    };
  }

  /**
   * 管理員手動撤銷整個批次 (呼叫 rollbackImportBatch)
   */
  function rollbackBatch(batchId) {
    AuthService.requireRole('system_admin');
    
    // 執行補償式回復
    rollbackImportBatch(batchId);
    
    var batch = SheetRepository.findById('ImportBatches', 'import_batch_id', batchId);
    if (batch) {
      batch.status = 'rolled_back';
      SheetRepository.upsertRecord('ImportBatches', 'import_batch_id', batchId, batch);
    }
    
    AuditService.log({
      action: 'IMPORT_ROLLED_BACK',
      module: 'import',
      recordId: batchId,
      reason: '系統管理員手動執行批次撤銷 (Rollback) 回復作業。'
    });
  }

  return {
    parseStudentImport: parseStudentImport,
    validateStudentImport: validateStudentImport,
    commitStudentImport: commitStudentImport,
    rollbackBatch: rollbackBatch,
    prepareImportBatch: prepareImportBatch,
    recordImportBatchItems: recordImportBatchItems,
    commitImportBatch: commitImportBatch,
    rollbackImportBatch: rollbackImportBatch,
    retryFailedRollback: retryFailedRollback,
    verifyImportBatchConsistency: verifyImportBatchConsistency
  };
})();
