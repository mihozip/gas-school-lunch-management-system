/**
 * StudentClassHistoryService.gs
 * 學生班級歷程服務
 */

var StudentClassHistoryService = (function() {

  /**
   * 取得學生目前的班級歷程
   */
  function getCurrentClass(studentId) {
    var list = listStudentClassHistory(studentId);
    var active = list.filter(function(r) {
      return !r.effective_end_date;
    });
    return active.length > 0 ? active[0] : null;
  }

  /**
   * 取得學生在特定日期的班級歷程
   */
  function getClassAtDate(studentId, date) {
    var list = listStudentClassHistory(studentId);
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
   * 取得學生所有班級歷程列表
   */
  function listStudentClassHistory(studentId) {
    return SheetRepository.findRecords('StudentClassHistory', function(r) {
      return String(r.student_id) === String(studentId) && 
             (r.enabled === true || r.enabled === 'TRUE');
    }).sort(function(a, b) {
      return new Date(a.effective_start_date).getTime() - new Date(b.effective_start_date).getTime();
    });
  }

  /**
   * 建立首筆班級歷程 (新增學生時呼叫)
   */
  function createInitialHistory(studentId, classId, startDate) {
    var dateToCheck = startDate || Utils.formatDate(new Date());
    PeriodLockService.assertDateWritable(dateToCheck);

    var identity = AuthService.getCurrentIdentity();
    var currentDateTime = Utils.formatDateTime(new Date());

    var historyId = Utils.generateUUID();
    var newRecord = {
      history_id: historyId,
      student_id: studentId,
      class_id: classId,
      effective_start_date: startDate || Utils.formatDate(new Date()),
      effective_end_date: '',
      change_reason: '入學/轉入初始班級',
      enabled: true,
      created_by: identity.email || 'system',
      created_at: currentDateTime,
      updated_by: identity.email || 'system',
      updated_at: currentDateTime
    };

    SheetRepository.appendRecord('StudentClassHistory', newRecord);
    return newRecord;
  }

  /**
   * 轉班作業
   */
  function changeClass(studentId, newClassId, effectiveDate, reason) {
    AuthService.requireAnyRole(['system_admin', 'lunch_admin']);
    var identity = AuthService.getCurrentIdentity();
    var currentDateTime = Utils.formatDateTime(new Date());

    // 1. 驗證班級存在且啟用
    var cls = SheetRepository.findById('Classes', 'class_id', newClassId);
    if (!cls || (cls.enabled !== true && cls.enabled !== 'TRUE')) {
      throw new Error('目標班級不存在或已被停用。');
    }

    // 2. 驗證生效日期
    if (!effectiveDate) {
      throw new Error('必須提供轉班生效日期。');
    }
    PeriodLockService.assertDateWritable(effectiveDate);

    // 3. 檢查區間重疊
    var list = listStudentClassHistory(studentId);
    var validation = ValidationService.validateStudentClassHistory(list, {
      student_id: studentId,
      class_id: newClassId,
      effective_start_date: effectiveDate,
      effective_end_date: ''
    });
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // 4. 關閉目前的班級歷程
    var current = getCurrentClass(studentId);
    if (current) {
      // 結束日期為新生效日的前一天
      var currentStart = new Date(current.effective_start_date);
      var newStart = new Date(effectiveDate);
      if (newStart.getTime() <= currentStart.getTime()) {
        throw new Error('轉班生效日期 (' + effectiveDate + ') 必須晚於現有班級生效日 (' + current.effective_start_date + ')');
      }

      var dayBefore = new Date(newStart.getTime() - 24 * 60 * 60 * 1000);
      var dayBeforeStr = Utils.formatDate(dayBefore);

      var updatedCurrent = JSON.parse(JSON.stringify(current));
      updatedCurrent.effective_end_date = dayBeforeStr;
      updatedCurrent.updated_by = identity.email;
      updatedCurrent.updated_at = currentDateTime;

      SheetRepository.upsertRecord('StudentClassHistory', 'history_id', current.history_id, updatedCurrent);
    }

    // 5. 建立新歷程
    var historyId = Utils.generateUUID();
    var newRecord = {
      history_id: historyId,
      student_id: studentId,
      class_id: newClassId,
      effective_start_date: effectiveDate,
      effective_end_date: '',
      change_reason: reason || '轉班',
      enabled: true,
      created_by: identity.email,
      created_at: currentDateTime,
      updated_by: identity.email,
      updated_at: currentDateTime
    };
    SheetRepository.appendRecord('StudentClassHistory', newRecord);

    // 6. 更新 Students 快取
    var student = SheetRepository.findById('Students', 'student_id', studentId);
    if (student) {
      var updatedStudent = JSON.parse(JSON.stringify(student));
      updatedStudent.class_id = newClassId;
      updatedStudent.updated_at = currentDateTime;
      updatedStudent.updated_by = identity.email;
      SheetRepository.upsertRecord('Students', 'student_id', studentId, updatedStudent);
    }

    AuditService.log({
      action: 'CHANGE_STUDENT_CLASS',
      module: 'student_management',
      recordId: studentId,
      beforeData: current,
      afterData: newRecord,
      reason: '學生轉班: ' + (reason || '')
    });

    return newRecord;
  }

  /**
   * 關閉目前的班級歷程
   */
  function closeCurrentHistory(studentId, endDate) {
    var identity = AuthService.getCurrentIdentity();
    var currentDateTime = Utils.formatDateTime(new Date());

    var current = getCurrentClass(studentId);
    if (current) {
      var updated = JSON.parse(JSON.stringify(current));
      updated.effective_end_date = endDate;
      updated.updated_by = identity.email || 'system';
      updated.updated_at = currentDateTime;
      SheetRepository.upsertRecord('StudentClassHistory', 'history_id', current.history_id, updated);
    }
  }

  return {
    getCurrentClass: getCurrentClass,
    getClassAtDate: getClassAtDate,
    listStudentClassHistory: listStudentClassHistory,
    createInitialHistory: createInitialHistory,
    changeClass: changeClass,
    closeCurrentHistory: closeCurrentHistory
  };
})();
