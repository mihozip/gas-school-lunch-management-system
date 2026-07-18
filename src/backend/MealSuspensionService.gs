/**
 * MealSuspensionService.gs
 * 學生長期停餐區間管理服務
 */

var MealSuspensionService = (function() {

  /**
   * 驗證學生的停餐日期區間是否重疊
   */
  function validateNoOverlap(studentId, start, end, excludeSuspensionId) {
    var records = SheetRepository.findRecords('MealSuspensionPeriods', function(x) {
      return x.student_id === studentId && 
             (x.enabled === true || x.enabled === 'TRUE') && 
             x.approval_status !== 'rejected' &&
             x.approval_status !== 'cancelled' &&
             (!excludeSuspensionId || x.suspension_id !== excludeSuspensionId);
    });

    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      var rStart = r.effective_start_date;
      var rEnd = r.effective_end_date || '9999-12-31';
      var checkStart = start;
      var checkEnd = end || '9999-12-31';

      // 檢查區間重疊
      if (checkStart <= rEnd && checkEnd >= rStart) {
        throw new Error('🛑 停餐區間重疊：學生在此期間已有登記之停餐紀錄 (' + rStart + ' ~ ' + (r.effective_end_date || '持續中') + ')。');
      }
    }
  }

  /**
   * 建立停餐申請
   */
  function createSuspension(suspObj) {
    AuthService.requireAnyRole(['system_admin', 'lunch_admin']);
    var identity = AuthService.getCurrentIdentity();
    var currentDateTime = Utils.formatDateTime(new Date());

    if (!suspObj.student_id) throw new Error('學生 ID 不得為空。');
    if (!suspObj.effective_start_date) throw new Error('開始停餐日期不得為空。');

    // 確保期間未鎖定
    PeriodLockService.assertRangeWritable(suspObj.effective_start_date, suspObj.effective_end_date);

    // 檢查日期區間
    validateNoOverlap(suspObj.student_id, suspObj.effective_start_date, suspObj.effective_end_date);

    var record = {
      suspension_id: Utils.generateUUID(),
      student_id: suspObj.student_id,
      suspension_type: suspObj.suspension_type || 'meal_suspension',
      effective_start_date: suspObj.effective_start_date,
      effective_end_date: suspObj.effective_end_date || '',
      reason: suspObj.reason || '',
      source_document_no: suspObj.source_document_no || '',
      approval_status: 'draft', // 預設為草稿
      enabled: true,
      created_by: identity.email,
      created_at: currentDateTime,
      updated_by: identity.email,
      updated_at: currentDateTime,
      cancelled_by: '',
      cancelled_at: '',
      cancellation_reason: ''
    };

    SheetRepository.appendRecord('MealSuspensionPeriods', record);

    AuditService.log({
      action: 'CREATE_MEAL_SUSPENSION_DRAFT',
      module: 'meal_suspension',
      recordId: record.suspension_id,
      afterData: record,
      reason: '建立長期停餐草稿申請'
    });

    return record;
  }

  /**
   * 核准停餐申請
   */
  function approveSuspension(suspensionId) {
    AuthService.requireAnyRole(['system_admin', 'lunch_admin']);
    var identity = AuthService.getCurrentIdentity();
    var currentDateTime = Utils.formatDateTime(new Date());

    return LockServiceHelper.runWithLock(function() {
      var record = SheetRepository.findById('MealSuspensionPeriods', 'suspension_id', suspensionId);
      if (!record) throw new Error('找不到該停餐紀錄。');

      // 確保期間未鎖定
      PeriodLockService.assertRangeWritable(record.effective_start_date, record.effective_end_date);
      
      if (record.approval_status !== 'draft') {
        throw new Error('此紀錄狀態並非 draft，無法執行核准，目前狀態: ' + record.approval_status);
      }

      // 二次重疊驗證以防並行衝突
      validateNoOverlap(record.student_id, record.effective_start_date, record.effective_end_date, suspensionId);

      var updated = JSON.parse(JSON.stringify(record));
      updated.approval_status = 'approved';
      updated.updated_by = identity.email;
      updated.updated_at = currentDateTime;

      SheetRepository.upsertRecord('MealSuspensionPeriods', 'suspension_id', suspensionId, updated);

      // 同步更新學生的 meal_status 為 suspended (快取用途)
      var student = StudentService.getStudent(record.student_id);
      if (student) {
        student.meal_status = 'suspended';
        student.updated_at = currentDateTime;
        student.updated_by = identity.email;
        SheetRepository.upsertRecord('Students', 'student_id', record.student_id, student);
      }

      AuditService.log({
        action: 'APPROVE_MEAL_SUSPENSION',
        module: 'meal_suspension',
        recordId: suspensionId,
        beforeData: record,
        afterData: updated,
        reason: '核准長期停餐申請'
      });

      return updated;
    }).error;
  }

  /**
   * 結束停餐 (恢復用餐)
   */
  function endSuspension(suspensionId, endDate, reason) {
    AuthService.requireAnyRole(['system_admin', 'lunch_admin']);
    var identity = AuthService.getCurrentIdentity();
    var currentDateTime = Utils.formatDateTime(new Date());

    if (!endDate) throw new Error('必須指定結束日期以恢復用餐。');

    // 確保期間未鎖定
    PeriodLockService.assertDateWritable(endDate);

    var record = SheetRepository.findById('MealSuspensionPeriods', 'suspension_id', suspensionId);
    if (!record) throw new Error('找不到該停餐紀錄。');

    if (record.approval_status !== 'approved') {
      throw new Error('只有已核准的停餐紀錄才能設定結束，目前狀態: ' + record.approval_status);
    }
    if (endDate < record.effective_start_date) {
      throw new Error('結束日期不得早於停餐開始日期。');
    }

    var updated = JSON.parse(JSON.stringify(record));
    updated.effective_end_date = endDate;
    updated.updated_by = identity.email;
    updated.updated_at = currentDateTime;

    SheetRepository.upsertRecord('MealSuspensionPeriods', 'suspension_id', suspensionId, updated);

    // 恢復學生狀態為 normal
    var student = StudentService.getStudent(record.student_id);
    if (student) {
      student.meal_status = 'normal';
      student.updated_at = currentDateTime;
      student.updated_by = identity.email;
      SheetRepository.upsertRecord('Students', 'student_id', record.student_id, student);
    }

    AuditService.log({
      action: 'END_MEAL_SUSPENSION',
      module: 'meal_suspension',
      recordId: suspensionId,
      beforeData: record,
      afterData: updated,
      reason: '恢復用餐，截止停餐區間。原因: ' + (reason || '')
    });

    return updated;
  }

  /**
   * 取消停餐申請 (保留紀錄，改狀態為 cancelled)
   */
  function cancelSuspension(suspensionId, reason) {
    AuthService.requireAnyRole(['system_admin', 'lunch_admin']);
    var identity = AuthService.getCurrentIdentity();
    var currentDateTime = Utils.formatDateTime(new Date());

    if (!reason) throw new Error('取消停餐登記必須填寫原因。');

    var record = SheetRepository.findById('MealSuspensionPeriods', 'suspension_id', suspensionId);
    if (!record) throw new Error('找不到該停餐紀錄。');

    // 確保期間未鎖定
    PeriodLockService.assertRangeWritable(record.effective_start_date, record.effective_end_date);

    var updated = JSON.parse(JSON.stringify(record));
    updated.approval_status = 'cancelled';
    updated.cancelled_by = identity.email;
    updated.cancelled_at = currentDateTime;
    updated.cancellation_reason = reason;
    updated.enabled = false;
    updated.updated_by = identity.email;
    updated.updated_at = currentDateTime;

    SheetRepository.upsertRecord('MealSuspensionPeriods', 'suspension_id', suspensionId, updated);

    // 恢復學生狀態為 normal
    var student = StudentService.getStudent(record.student_id);
    if (student && student.meal_status === 'suspended') {
      student.meal_status = 'normal';
      student.updated_at = currentDateTime;
      student.updated_by = identity.email;
      SheetRepository.upsertRecord('Students', 'student_id', record.student_id, student);
    }

    AuditService.log({
      action: 'CANCEL_MEAL_SUSPENSION',
      module: 'meal_suspension',
      recordId: suspensionId,
      beforeData: record,
      afterData: updated,
      reason: '取消停餐紀錄: ' + reason
    });

    return updated;
  }

  /**
   * 取得指定日期學生是否處於已核准之停餐區間中
   */
  function getActiveSuspensionAtDate(studentId, date) {
    var records = SheetRepository.findRecords('MealSuspensionPeriods', function(x) {
      return x.student_id === studentId && 
             (x.enabled === true || x.enabled === 'TRUE') && 
             x.approval_status === 'approved';
    });

    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      var start = r.effective_start_date;
      var end = r.effective_end_date || '9999-12-31';

      if (date >= start && date <= end) {
        return r;
      }
    }
    return null;
  }

  /**
   * 列出某學生的所有停餐紀錄
   */
  function listStudentSuspensions(studentId) {
    return SheetRepository.findRecords('MealSuspensionPeriods', function(x) {
      return x.student_id === studentId;
    });
  }

  return {
    createSuspension: createSuspension,
    approveSuspension: approveSuspension,
    endSuspension: endSuspension,
    cancelSuspension: cancelSuspension,
    getActiveSuspensionAtDate: getActiveSuspensionAtDate,
    listStudentSuspensions: listStudentSuspensions,
    validateNoOverlap: validateNoOverlap
  };
})();
