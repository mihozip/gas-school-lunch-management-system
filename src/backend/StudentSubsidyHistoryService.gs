/**
 * StudentSubsidyHistoryService.gs
 * 學生補助身分歷程服務
 */

var StudentSubsidyHistoryService = (function() {

  /**
   * 取得學生目前的補助身分歷程
   */
  function getCurrentSubsidyCategory(studentId) {
    var list = listStudentHistory(studentId);
    var active = list.filter(function(r) {
      return !r.effective_end_date;
    });
    return active.length > 0 ? active[0] : null;
  }

  /**
   * 取得學生在特定日期的補助身分
   */
  function getSubsidyCategoryAtDate(studentId, date) {
    var list = listStudentHistory(studentId);
    var targetTime = new Date(date).getTime();

    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      var s = new Date(r.effective_start_date).getTime();
      var e = r.effective_end_date ? new Date(r.effective_end_date).getTime() : Infinity;
      if (targetTime >= s && targetTime <= e) {
        return r;
      }
    }
    return null;
  }

  /**
   * 取得學生所有補助身分歷程列表
   */
  function listStudentHistory(studentId) {
    return SheetRepository.findRecords('StudentSubsidyHistory', function(r) {
      return String(r.student_id) === String(studentId) && 
             (r.enabled === true || r.enabled === 'TRUE');
    }).sort(function(a, b) {
      return new Date(a.effective_start_date).getTime() - new Date(b.effective_start_date).getTime();
    });
  }

  /**
   * 建立首筆補助身分歷程 (新增學生時呼叫)
   */
  function createInitialHistory(studentId, subsidyCategoryId, startDate) {
    var dateToCheck = startDate || Utils.formatDate(new Date());
    PeriodLockService.assertDateWritable(dateToCheck);

    var identity = AuthService.getCurrentIdentity();
    var currentDateTime = Utils.formatDateTime(new Date());

    var category = SheetRepository.findById('SubsidyCategories', 'subsidy_category_id', subsidyCategoryId);
    if (!category) {
      // 找不到身分時預設為 GENERAL (一般生)
      subsidyCategoryId = 'GENERAL';
    }

    var historyId = Utils.generateUUID();
    var newRecord = {
      history_id: historyId,
      student_id: studentId,
      subsidy_category_id: subsidyCategoryId,
      effective_start_date: startDate || Utils.formatDate(new Date()),
      effective_end_date: '',
      change_reason: '入學/轉入初始身分',
      source_document_no: '',
      enabled: true,
      created_by: identity.email || 'system',
      created_at: currentDateTime,
      updated_by: identity.email || 'system',
      updated_at: currentDateTime
    };

    SheetRepository.appendRecord('StudentSubsidyHistory', newRecord);
    return newRecord;
  }

  /**
   * 變更補助身分作業
   */
  function changeSubsidyCategory(studentId, newCategoryId, effectiveDate, reason, docNo) {
    AuthService.requireAnyRole(['system_admin', 'lunch_admin']);
    PeriodLockService.assertDateWritable(effectiveDate);

    var identity = AuthService.getCurrentIdentity();
    var currentDateTime = Utils.formatDateTime(new Date());

    // 1. 驗證身分存在且啟用
    var cat = SheetRepository.findById('SubsidyCategories', 'subsidy_category_id', newCategoryId);
    if (!cat || (cat.enabled !== true && cat.enabled !== 'TRUE')) {
      throw new Error('目標補助身分類別不存在或已被停用。');
    }

    // 2. 驗證生效日期
    if (!effectiveDate) {
      throw new Error('必須提供補助身分變更生效日期。');
    }

    // 3. 檢查區間重疊
    var list = listStudentHistory(studentId);
    var validation = ValidationService.validateStudentSubsidyHistory(list, {
      student_id: studentId,
      subsidy_category_id: newCategoryId,
      effective_start_date: effectiveDate,
      effective_end_date: ''
    });
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // 4. 關閉目前的歷程
    var current = getCurrentSubsidyCategory(studentId);
    if (current) {
      var currentStart = new Date(current.effective_start_date);
      var newStart = new Date(effectiveDate);
      if (newStart.getTime() <= currentStart.getTime()) {
        throw new Error('變更生效日期 (' + effectiveDate + ') 必須晚於現有身分生效日 (' + current.effective_start_date + ')');
      }

      var dayBefore = new Date(newStart.getTime() - 24 * 60 * 60 * 1000);
      var dayBeforeStr = Utils.formatDate(dayBefore);

      var updatedCurrent = JSON.parse(JSON.stringify(current));
      updatedCurrent.effective_end_date = dayBeforeStr;
      updatedCurrent.updated_by = identity.email;
      updatedCurrent.updated_at = currentDateTime;

      SheetRepository.upsertRecord('StudentSubsidyHistory', 'history_id', current.history_id, updatedCurrent);
    }

    // 5. 建立新歷程
    var historyId = Utils.generateUUID();
    var newRecord = {
      history_id: historyId,
      student_id: studentId,
      subsidy_category_id: newCategoryId,
      effective_start_date: effectiveDate,
      effective_end_date: '',
      change_reason: reason || '變更身分',
      source_document_no: docNo || '',
      enabled: true,
      created_by: identity.email,
      created_at: currentDateTime,
      updated_by: identity.email,
      updated_at: currentDateTime
    };
    SheetRepository.appendRecord('StudentSubsidyHistory', newRecord);

    // 6. 更新 Students 快取
    var student = SheetRepository.findById('Students', 'student_id', studentId);
    if (student) {
      var updatedStudent = JSON.parse(JSON.stringify(student));
      updatedStudent.subsidy_category_id = newCategoryId;
      updatedStudent.updated_at = currentDateTime;
      updatedStudent.updated_by = identity.email;
      SheetRepository.upsertRecord('Students', 'student_id', studentId, updatedStudent);
    }

    AuditService.log({
      action: 'CHANGE_STUDENT_SUBSIDY',
      module: 'subsidy_history',
      recordId: studentId,
      beforeData: current,
      afterData: newRecord,
      reason: '變更補助身分: ' + (reason || '')
    });

    return newRecord;
  }

  /**
   * 關閉目前的補助身分歷程
   */
  function closeCurrentHistory(studentId, endDate) {
    var identity = AuthService.getCurrentIdentity();
    var currentDateTime = Utils.formatDateTime(new Date());

    var current = getCurrentSubsidyCategory(studentId);
    if (current) {
      var updated = JSON.parse(JSON.stringify(current));
      updated.effective_end_date = endDate;
      updated.updated_by = identity.email || 'system';
      updated.updated_at = currentDateTime;
      SheetRepository.upsertRecord('StudentSubsidyHistory', 'history_id', current.history_id, updated);
    }
  }

  return {
    getCurrentSubsidyCategory: getCurrentSubsidyCategory,
    getSubsidyCategoryAtDate: getSubsidyCategoryAtDate,
    listStudentHistory: listStudentHistory,
    createInitialHistory: createInitialHistory,
    changeSubsidyCategory: changeSubsidyCategory,
    closeCurrentHistory: closeCurrentHistory
  };
})();
