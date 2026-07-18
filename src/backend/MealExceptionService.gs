/**
 * MealExceptionService.gs
 * 每日未用餐登記與班級確認服務
 */

var MealExceptionService = (function() {

  /**
   * 截止時間與補登權限驗證
   */
  function validateEntryDeadline(dateStr, bypassRoleCheck) {
    var identity = AuthService.getCurrentIdentity();
    var isAdmin = (identity.role === 'system_admin' || identity.role === 'lunch_admin');
    
    // 讀取設定
    var deadline = Config.get('DAILY_CONFIRM_DEADLINE') || '09:00';
    var allowRetroactive = Config.get('ALLOW_RETROACTIVE_EDIT') === 'TRUE';
    var retroactiveDays = parseInt(Config.get('RETROACTIVE_EDIT_DAYS') || '0', 10);
    var allowAdminOverride = Config.get('ALLOW_SAME_DAY_ADMIN_OVERRIDE') === 'TRUE';

    var todayStr = Utils.formatDate(new Date());

    // 1. 同日截止時間檢查
    if (dateStr === todayStr && !bypassRoleCheck) {
      var now = new Date();
      var nowTimeStr = Utils.padZero(now.getHours()) + ':' + Utils.padZero(now.getMinutes());
      if (nowTimeStr > deadline) {
        if (isAdmin && allowAdminOverride) {
          // 管理員特許同日逾時修改
          return;
        }
        throw new Error('🛑 逾時限制：今日登記截止時間為 ' + deadline + '，目前時間為 ' + nowTimeStr + '，已無法變更登記。');
      }
    }

    // 2. 歷史日期補登檢查
    if (dateStr < todayStr && !bypassRoleCheck) {
      if (!allowRetroactive) {
        if (isAdmin) return; // 管理員不受 ALLOW_RETROACTIVE_EDIT 限制
        throw new Error('🛑 權限限制：系統設定禁止補登/修改歷史日期的用餐紀錄。');
      }
      
      // 計算相差天數
      var dateDiff = Math.floor((new Date(todayStr).getTime() - new Date(dateStr).getTime()) / 86400000);
      if (dateDiff > retroactiveDays) {
        if (isAdmin) return; // 管理員不受補登天數限制
        throw new Error('🛑 逾時限制：只允許補登 ' + retroactiveDays + ' 天內的紀錄，該日期已超出補登期限。');
      }
    }
  }

  /**
   * 取得某班級在指定日期的所有學生清單與其停餐狀態
   */
  function listClassStudentsForDate(classId, dateStr) {
    // 1. 取得該日期在此班級內就讀的所有學生
    // 需要透過 StudentClassHistory 歷程進行嚴格回溯
    var histories = SheetRepository.findRecords('StudentClassHistory', function(h) {
      var end = h.effective_end_date || '9999-12-31';
      return h.class_id === classId && 
             (h.enabled === true || h.enabled === 'TRUE') &&
             dateStr >= h.effective_start_date && 
             dateStr <= end;
    });

    var studentIds = histories.map(function(h) { return h.student_id; });
    if (studentIds.length === 0) return [];

    var students = SheetRepository.findRecords('Students', function(s) {
      return studentIds.indexOf(s.student_id) !== -1;
    });

    // 取得膳食與身分類別以便快取對照
    var categories = SheetRepository.getAllRecords('SubsidyCategories');
    var catMap = {};
    categories.forEach(function(c) { catMap[c.subsidy_category_id] = c.category_name; });

    // 取得當天手動未用餐紀錄
    var exceptions = SheetRepository.findRecords('MealExceptions', function(ex) {
      return ex.date === dateStr && 
             ex.class_id === classId && 
             ex.status === 'active';
    });
    var exMap = {};
    exceptions.forEach(function(ex) { exMap[ex.student_id] = ex; });

    var resultList = [];
    students.forEach(function(s) {
      // 檢查學生在當天學籍是否處於有效範圍
      var start = s.start_date;
      var end = s.end_date || '9999-12-31';
      var activeOnDate = (s.enabled === true || s.enabled === 'TRUE') && (dateStr >= start && dateStr <= end);
      if (!activeOnDate) return; // 排除當天已轉出或未入學的學生

      // 檢查長期停餐狀態
      var suspension = MealSuspensionService.getActiveSuspensionAtDate(s.student_id, dateStr);
      var manualEx = exMap[s.student_id];

      // 身分異動回溯
      var activeSubsidy = s.subsidy_category_id;
      var subHist = SheetRepository.findRecords('StudentSubsidyHistory', function(sh) {
        var shEnd = sh.effective_end_date || '9999-12-31';
        return sh.student_id === s.student_id && 
               (sh.enabled === true || sh.enabled === 'TRUE') &&
               dateStr >= sh.effective_start_date && 
               dateStr <= shEnd;
      })[0];
      if (subHist) {
        activeSubsidy = subHist.subsidy_category_id;
      }

      var seatNum = parseInt(s.seat_number, 10) || 99;

      resultList.push({
        student_id: s.student_id,
        student_name: s.student_name,
        student_number: s.student_number,
        seat_number: seatNum,
        dietary_type: s.dietary_type,
        subsidy_category_id: activeSubsidy,
        subsidy_category_name: catMap[activeSubsidy] || '一般生',
        meal_status: s.meal_status,
        
        // 停餐屬性
        is_long_term_suspended: suspension !== null,
        suspension_reason: suspension ? suspension.reason : '',
        
        is_manual_exception: manualEx !== undefined && manualEx.source_type === 'manual',
        exception_type: manualEx ? manualEx.exception_type : '',
        exception_reason: manualEx ? manualEx.reason : ''
      });
    });

    // 依座號排序
    resultList.sort(function(a, b) {
      return a.seat_number - b.seat_number;
    });

    return resultList;
  }

  /**
   * 取得某班級在指定日期的確認明細與狀態
   */
  function getClassMealEntry(classId, dateStr) {
    AuthService.requireClassScoping(classId);

    // 檢查該日期是否為供餐日
    var schoolDay = SchoolDaysService.getSchoolDay(dateStr);
    if (!schoolDay) {
      throw new Error('🛑 日期未設定：該日期不存在於上課日曆中。');
    }
    if (!(schoolDay.is_meal_day === true || schoolDay.is_meal_day === 'TRUE')) {
      throw new Error('🛑 非供餐日：指定日期 [' + dateStr + '] 在系統日曆中設定為不供餐，無法登記停餐。');
    }

    var confirmation = SheetRepository.findRecords('DailyClassConfirmations', function(x) {
      return x.date === dateStr && x.class_id === classId;
    })[0];

    var students = listClassStudentsForDate(classId, dateStr);

    return {
      date: dateStr,
      class_id: classId,
      schoolDay: schoolDay,
      confirmation: confirmation || {
        confirm_status: 'draft',
        expected_student_count: students.length,
        exception_count: 0,
        actual_meal_count: students.length
      },
      students: students
    };
  }

  /**
   * 儲存草稿
   */
  function saveDraft(classId, dateStr, exceptionEntries) {
    AuthService.requireClassScoping(classId);
    validateEntryDeadline(dateStr);

    // 確保期間未鎖定
    PeriodLockService.assertDateWritable(dateStr);

    return LockService.runWithLock(function() {
      // 檢查是否已鎖定
      var confirmation = SheetRepository.findRecords('DailyClassConfirmations', function(x) {
        return x.date === dateStr && x.class_id === classId;
      })[0];

      if (confirmation && (confirmation.confirm_status === 'confirmed' || confirmation.confirm_status === 'locked')) {
        throw new Error('🛑 修改受阻：班級本日用餐紀錄已完成確認或鎖定，無法再儲存草稿。');
      }

      var identity = AuthService.getCurrentIdentity();
      var currentDateTime = Utils.formatDateTime(new Date());

      // A. 清除原有的手動未用餐紀錄
      var oldExceptions = SheetRepository.findRecords('MealExceptions', function(x) {
        return x.date === dateStr && x.class_id === classId && x.source_type === 'manual';
      });
      oldExceptions.forEach(function(ex) {
        SheetRepository.deleteRecord('MealExceptions', 'exception_id', ex.exception_id);
      });

      // B. 寫入新草稿紀錄
      exceptionEntries.forEach(function(entry) {
        var record = {
          exception_id: Utils.generateUUID(),
          date: dateStr,
          student_id: entry.student_id,
          class_id: classId,
          exception_type: entry.exception_type || 'leave',
          reason: entry.reason || '',
          meal_count: 1,
          status: 'active',
          created_by: identity.email,
          created_at: currentDateTime,
          updated_by: identity.email,
          updated_at: currentDateTime,
          source_type: 'manual',
          source_record_id: '',
          confirmation_id: confirmation ? confirmation.confirmation_id : '',
          enabled: true,
          deleted_by: '',
          deleted_at: '',
          deletion_reason: ''
        };
        SheetRepository.appendRecord('MealExceptions', record);
      });

      // C. 建立/更新確認草稿
      var confId = confirmation ? confirmation.confirmation_id : Utils.generateUUID();
      var students = listClassStudentsForDate(classId, dateStr);
      var manualCount = exceptionEntries.length;
      var suspensionCount = students.filter(function(s) { return s.is_long_term_suspended; }).length;

      var newConf = {
        confirmation_id: confId,
        date: dateStr,
        class_id: classId,
        expected_student_count: students.length,
        exception_count: manualCount + suspensionCount,
        actual_meal_count: students.length - (manualCount + suspensionCount),
        confirm_status: 'draft',
        confirmed_by: '',
        confirmed_at: '',
        reopened_by: confirmation ? (confirmation.reopened_by || '') : '',
        reopened_at: confirmation ? (confirmation.reopened_at || '') : '',
        reopen_reason: confirmation ? (confirmation.reopen_reason || '') : ''
      };

      SheetRepository.upsertRecord('DailyClassConfirmations', 'confirmation_id', confId, newConf);

      // 紀錄確認歷程
      var chRecord = {
        history_id: Utils.generateUUID(),
        confirmation_id: confId,
        action: 'create_draft',
        before_status: confirmation ? confirmation.confirm_status : 'none',
        after_status: 'draft',
        reason: '儲存草稿變更',
        acted_by: identity.email,
        acted_at: currentDateTime
      };
      SheetRepository.appendRecord('DailyConfirmationHistory', chRecord);

      return newConf;
    }).error;
  }

  /**
   * 導師完成登記確認
   */
  function confirmClassDay(classId, dateStr, exceptionEntries) {
    AuthService.requireClassScoping(classId);
    validateEntryDeadline(dateStr);

    // 確保期間未鎖定
    PeriodLockService.assertDateWritable(dateStr);

    return LockService.runWithLock(function() {
      var confirmation = SheetRepository.findRecords('DailyClassConfirmations', function(x) {
        return x.date === dateStr && x.class_id === classId;
      })[0];

      if (confirmation && confirmation.confirm_status === 'locked') {
        throw new Error('🛑 修改受阻：班級本日用餐紀錄已隨月結鎖定，無法修改。');
      }

      var identity = AuthService.getCurrentIdentity();
      var currentDateTime = Utils.formatDateTime(new Date());

      // 1. 清空原有的手動未用餐紀錄
      var oldExceptions = SheetRepository.findRecords('MealExceptions', function(x) {
        return x.date === dateStr && x.class_id === classId && x.source_type === 'manual';
      });
      oldExceptions.forEach(function(ex) {
        SheetRepository.deleteRecord('MealExceptions', 'exception_id', ex.exception_id);
      });

      // 2. 寫入最新的手動停餐紀錄
      var confId = confirmation ? confirmation.confirmation_id : Utils.generateUUID();
      exceptionEntries.forEach(function(entry) {
        var record = {
          exception_id: Utils.generateUUID(),
          date: dateStr,
          student_id: entry.student_id,
          class_id: classId,
          exception_type: entry.exception_type || 'leave',
          reason: entry.reason || '',
          meal_count: 1,
          status: 'active',
          created_by: identity.email,
          created_at: currentDateTime,
          updated_by: identity.email,
          updated_at: currentDateTime,
          source_type: 'manual',
          source_record_id: '',
          confirmation_id: confId,
          enabled: true,
          deleted_by: '',
          deleted_at: '',
          deletion_reason: ''
        };
        SheetRepository.appendRecord('MealExceptions', record);
      });

      // 3. 計算預估數據並寫入確認表
      var students = listClassStudentsForDate(classId, dateStr);
      var manualCount = exceptionEntries.length;
      var suspensionCount = students.filter(function(s) { return s.is_long_term_suspended; }).length;

      var newConf = {
        confirmation_id: confId,
        date: dateStr,
        class_id: classId,
        expected_student_count: students.length,
        exception_count: manualCount + suspensionCount,
        actual_meal_count: students.length - (manualCount + suspensionCount),
        confirm_status: 'confirmed',
        confirmed_by: identity.email,
        confirmed_at: currentDateTime,
        reopened_by: confirmation ? (confirmation.reopened_by || '') : '',
        reopened_at: confirmation ? (confirmation.reopened_at || '') : '',
        reopen_reason: confirmation ? (confirmation.reopen_reason || '') : ''
      };

      SheetRepository.upsertRecord('DailyClassConfirmations', 'confirmation_id', confId, newConf);

      // 4. 紀錄確認歷程
      var chRecord = {
        history_id: Utils.generateUUID(),
        confirmation_id: confId,
        action: confirmation ? 'reconfirm' : 'confirm',
        before_status: confirmation ? confirmation.confirm_status : 'none',
        after_status: 'confirmed',
        reason: '完成每日用餐登記確認',
        acted_by: identity.email,
        acted_at: currentDateTime
      };
      SheetRepository.appendRecord('DailyConfirmationHistory', chRecord);

      AuditService.log({
        action: 'CONFIRM_CLASS_MEAL_DAY',
        module: 'meal_exception',
        recordId: confId,
        afterData: newConf,
        reason: '導師完成班級每日用餐登記確認。實到餐數: ' + newConf.actual_meal_count
      });

      return newConf;
    }).error;
  }

  /**
   * 午餐管理員解鎖/退回重開
   */
  function reopenClassDay(classId, dateStr, reason) {
    // 檢查退回重開角色權限
    var rolesAllowed = (Config.get('REOPEN_CONFIRM_ROLE') || 'system_admin,lunch_admin').split(',');
    var identity = AuthService.getCurrentIdentity();
    if (rolesAllowed.indexOf(identity.role) === -1) {
      throw new Error('🛑 權限不足：您所屬的角色無權執行退回重開班級登記的作業。');
    }
    if (!reason) {
      throw new Error('🛑 原因未填：退回重開班級登記時必須填寫退回原因。');
    }

    // 確保期間未鎖定
    PeriodLockService.assertDateWritable(dateStr);

    return LockService.runWithLock(function() {
      var confirmation = SheetRepository.findRecords('DailyClassConfirmations', function(x) {
        return x.date === dateStr && x.class_id === classId;
      })[0];

      if (!confirmation) {
        throw new Error('該班級本日尚未建立任何登記，無須退回重開。');
      }
      if (confirmation.confirm_status === 'locked') {
        throw new Error('🛑 鎖定限制：本日用餐資料已被月結歸檔鎖定，禁止退回修改。');
      }

      var currentDateTime = Utils.formatDateTime(new Date());
      var updated = JSON.parse(JSON.stringify(confirmation));
      updated.confirm_status = 'reopened';
      updated.reopened_by = identity.email;
      updated.reopened_at = currentDateTime;
      updated.reopen_reason = reason;

      SheetRepository.upsertRecord('DailyClassConfirmations', 'confirmation_id', confirmation.confirmation_id, updated);

      // 紀錄確認歷程
      var chRecord = {
        history_id: Utils.generateUUID(),
        confirmation_id: confirmation.confirmation_id,
        action: 'reopen',
        before_status: confirmation.confirm_status,
        after_status: 'reopened',
        reason: reason,
        acted_by: identity.email,
        acted_at: currentDateTime
      };
      SheetRepository.appendRecord('DailyConfirmationHistory', chRecord);

      AuditService.log({
        action: 'REOPEN_CLASS_MEAL_DAY',
        module: 'meal_exception',
        recordId: confirmation.confirmation_id,
        reason: '管理員退回班級登記，開放導師補正。原因: ' + reason
      });

      return updated;
    }).error;
  }

  /**
   * 取得午餐管理員當日全校完成狀況統計儀表板數據
   */
  function getClassConfirmationsDashboard(dateStr) {
    AuthService.requireAnyRole(['system_admin', 'lunch_admin', 'accountant', 'viewer']);

    // 1. 取得所有啟用班級
    var classes = SheetRepository.findRecords('Classes', function(c) {
      return c.enabled === true || c.enabled === 'TRUE';
    });

    // 2. 取得當日所有確認
    var confirmations = SheetRepository.findRecords('DailyClassConfirmations', function(x) {
      return x.date === dateStr;
    });
    var confMap = {};
    confirmations.forEach(function(c) { confMap[c.class_id] = c; });

    var stats = {
      date: dateStr,
      total_classes: classes.length,
      confirmed_classes: 0,
      draft_classes: 0,
      not_started_classes: 0,
      reopened_classes: 0,
      completion_rate: 0,
      estimated_school_meals: 0,
      total_suspensions: 0,
      total_manual_exceptions: 0,
      anomalies_count: 0
    };

    var classDashboardList = [];

    classes.forEach(function(c) {
      var conf = confMap[c.class_id];
      var status = conf ? conf.confirm_status : 'not_started';
      
      if (status === 'confirmed' || status === 'locked') stats.confirmed_classes++;
      else if (status === 'draft') stats.draft_classes++;
      else if (status === 'reopened') stats.reopened_classes++;
      else stats.not_started_classes++;

      // 取得班級當天學生名單及異常
      var students = listClassStudentsForDate(c.class_id, dateStr);
      var subSuspCount = students.filter(function(s) { return s.is_long_term_suspended; }).length;
      var subManualCount = students.filter(function(s) { return s.is_manual_exception; }).length;
      
      stats.total_suspensions += subSuspCount;
      stats.total_manual_exceptions += subManualCount;
      
      var estimatedMeals = students.length - (subSuspCount + subManualCount);
      stats.estimated_school_meals += estimatedMeals;

      // 異常檢測
      var anomalyReason = '';
      if (!c.teacher_email) {
        anomalyReason = '班級未指派導師 Email';
        stats.anomalies_count++;
      }

      classDashboardList.push({
        class_id: c.class_id,
        class_name: c.class_name,
        teacher_name: c.teacher_name,
        students_count: students.length,
        suspensions_count: subSuspCount,
        manual_exceptions_count: subManualCount,
        estimated_meals: estimatedMeals,
        confirm_status: status,
        updated_at: conf ? (conf.confirmed_at || '') : '',
        anomaly_reason: anomalyReason
      });
    });

    stats.completion_rate = classes.length > 0 ? Math.round((stats.confirmed_classes / classes.length) * 100) : 0;
    stats.classes_list = classDashboardList;

    return stats;
  }

  return {
    listClassStudentsForDate: listClassStudentsForDate,
    getClassMealEntry: getClassMealEntry,
    saveDraft: saveDraft,
    confirmClassDay: confirmClassDay,
    reopenClassDay: reopenClassDay,
    getClassConfirmationsDashboard: getClassConfirmationsDashboard,
    validateEntryDeadline: validateEntryDeadline
  };
})();
