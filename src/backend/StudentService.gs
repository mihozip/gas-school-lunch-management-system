/**
 * StudentService.gs
 * 學生名冊管理與狀態服務
 */

var StudentService = (function() {

  /**
   * 姓名遮罩防護 (個資去識別化)
   */
  function maskName(name) {
    if (!name) return '';
    var len = name.length;
    if (len <= 2) {
      return name.substring(0, 1) + '*';
    }
    return name.substring(0, 1) + '*'.repeat(len - 2) + name.substring(len - 1);
  }

  /**
   * 依日期與學籍條件判定學生當日是否合規用餐 (學籍有效性)
   * @param {object} student 學生資料
   * @param {string} targetDate 目的日期 (YYYY-MM-DD)
   * @return {boolean} 是否合規用餐
   */
  function isStudentActiveOnDate(student, targetDate) {
    var enabled = student.enabled === true || student.enabled === 'TRUE';
    if (!enabled) return false;

    // 字串比較 YYYY-MM-DD 避免 JS Timezone 偏位問題
    var start = student.start_date;
    var end = student.end_date;

    if (targetDate < start) return false;
    if (end && targetDate > end) return false;

    // status 判定
    var status = student.meal_status;
    if (status === 'transferred' || status === 'graduated') return false;
    if (status === 'suspended') return false; // 長期停餐不計入正常供餐

    return true;
  }

  /**
   * 取得學生清單 (支援多篩選條件與個資遮罩)
   */
  function listStudents(filters) {
    AuthService.requireAuthenticatedUser();
    var identity = AuthService.getCurrentIdentity();
    var role = identity.role;

    // 1. viewer 角色不允許查看任何學生清單
    if (role === 'viewer') {
      return [];
    }

    var students = SheetRepository.getAllRecords('Students');

    // 2. class_teacher 限制只能看自己所屬班級
    if (role === 'class_teacher') {
      if (!identity.class_id) return [];
      students = students.filter(function(s) {
        return s.class_id === identity.class_id;
      });
    }

    // 3. 套用過濾器
    if (filters) {
      if (filters.school_year) {
        students = students.filter(function(s) {
          return String(s.school_year) === String(filters.school_year);
        });
      }
      if (filters.class_id) {
        // 如果是導師，且帶了別人的 class_id，強制導回自己班級
        var targetClassId = filters.class_id;
        if (role === 'class_teacher') {
          targetClassId = identity.class_id;
        }
        students = students.filter(function(s) {
          return s.class_id === targetClassId;
        });
      }
      if (filters.grade) {
        // 需要關聯 Classes 查 Grade
        var classMap = {};
        SheetRepository.getAllRecords('Classes').forEach(function(c) {
          classMap[c.class_id] = c.grade;
        });
        students = students.filter(function(s) {
          return String(classMap[s.class_id]) === String(filters.grade);
        });
      }
      if (filters.meal_status) {
        students = students.filter(function(s) {
          return s.meal_status === filters.meal_status;
        });
      }
      if (filters.enabled !== undefined && filters.enabled !== null && filters.enabled !== '') {
        var isEnabled = filters.enabled === 'true' || filters.enabled === true;
        students = students.filter(function(s) {
          return (s.enabled === true || s.enabled === 'TRUE') === isEnabled;
        });
      }
      if (filters.subsidy_category_id) {
        students = students.filter(function(s) {
          return s.subsidy_category_id === filters.subsidy_category_id;
        });
      }
      if (filters.dietary_type) {
        students = students.filter(function(s) {
          return s.dietary_type === filters.dietary_type;
        });
      }
      if (filters.search) {
        var query = filters.search.toLowerCase();
        students = students.filter(function(s) {
          return (s.student_name && s.student_name.toLowerCase().indexOf(query) !== -1) ||
                 (s.student_number && s.student_number.toLowerCase().indexOf(query) !== -1);
        });
      }
    }

    // 4. 個資遮蔽處理：accountant 顯示遮罩姓名，管理者與導師顯示真實姓名
    students.forEach(function(s) {
      if (role === 'accountant') {
        s.student_name = maskName(s.student_name);
      }
    });

    // 5. 排序：學年度、班級、座號
    var classCodes = {};
    SheetRepository.getAllRecords('Classes').forEach(function(c) {
      classCodes[c.class_id] = c.class_code;
    });

    students.sort(function(a, b) {
      if (a.school_year !== b.school_year) return b.school_year - a.school_year;
      var codeA = classCodes[a.class_id] || '';
      var codeB = classCodes[b.class_id] || '';
      if (codeA !== codeB) return codeA.localeCompare(codeB);
      return (a.seat_number || 0) - (b.seat_number || 0);
    });

    return students;
  }

  /**
   * 取得單一學生詳細資料 (含遮罩)
   */
  function getStudent(studentId) {
    AuthService.requireAuthenticatedUser();
    var identity = AuthService.getCurrentIdentity();
    var role = identity.role;

    if (role === 'viewer') {
      throw new Error('您的權限無法查看學生個資。');
    }

    var student = SheetRepository.findById('Students', 'student_id', studentId);
    if (!student) {
      throw new Error('找不到該學生，ID: ' + studentId);
    }

    // 導師權限限制
    if (role === 'class_teacher' && student.class_id !== identity.class_id) {
      throw new Error('您只能查看自己班級的學生。');
    }

    if (role === 'accountant') {
      student.student_name = maskName(student.student_name);
    }

    return student;
  }

  /**
   * 檢查學生唯一性限制
   */
  function checkStudentUniqueness(schoolYear, studentNumber, excludeStudentId) {
    if (!studentNumber) return;
    
    var mode = Config.getSystemConfig('STUDENT_UNIQUE_KEY_MODE', 'SCHOOL_YEAR_AND_STUDENT_NUMBER');
    var duplicates = [];

    if (mode === 'SCHOOL_YEAR_AND_STUDENT_NUMBER') {
      duplicates = SheetRepository.findRecords('Students', function(r) {
        return String(r.school_year) === String(schoolYear) && 
               String(r.student_number) === String(studentNumber) &&
               r.student_id !== excludeStudentId;
      });
    } else if (mode === 'STUDENT_NUMBER_ONLY') {
      duplicates = SheetRepository.findRecords('Students', function(r) {
        return String(r.student_number) === String(studentNumber) &&
               r.student_id !== excludeStudentId;
      });
    }

    if (duplicates.length > 0) {
      throw new Error('學號 ' + studentNumber + ' 已被佔用，不允許重複註冊。');
    }
  }

  /**
   * 建立學生
   */
  function createStudent(studentData) {
    AuthService.requireAnyRole(['system_admin', 'lunch_admin']);
    var identity = AuthService.getCurrentIdentity();
    var currentDateTime = Utils.formatDateTime(new Date());

    if (!studentData.student_name || !studentData.class_id || !studentData.school_year) {
      throw new Error('請填寫必填欄位 (學生姓名、班級、學年度)');
    }

    // 檢查班級存在
    var cls = SheetRepository.findById('Classes', 'class_id', studentData.class_id);
    if (!cls) {
      throw new Error('所選的班級不存在。');
    }

    checkStudentUniqueness(studentData.school_year, studentData.student_number);

    var studentId = Utils.generateUUID();
    var newRecord = {
      student_id: studentId,
      student_number: studentData.student_number || '',
      school_year: parseInt(studentData.school_year, 10),
      class_id: studentData.class_id,
      seat_number: parseInt(studentData.seat_number || 0, 10),
      student_name: studentData.student_name,
      subsidy_category_id: studentData.subsidy_category_id || 'GENERAL',
      dietary_type: studentData.dietary_type || '葷食',
      meal_status: studentData.meal_status || 'normal',
      start_date: studentData.start_date || Utils.formatDate(new Date()),
      end_date: studentData.end_date || '',
      enabled: studentData.enabled !== false && studentData.enabled !== 'FALSE',
      note: studentData.note || '',
      created_at: currentDateTime,
      created_by: identity.email,
      updated_at: currentDateTime,
      updated_by: identity.email
    };

    // 1. 寫入 Students
    SheetRepository.appendRecord('Students', newRecord);

    // 2. 建立首筆班級歷程
    StudentClassHistoryService.createInitialHistory(studentId, newRecord.class_id, newRecord.start_date);

    // 3. 建立首筆補助歷程
    StudentSubsidyHistoryService.createInitialHistory(studentId, newRecord.subsidy_category_id, newRecord.start_date);

    AuditService.log({
      action: 'CREATE_STUDENT',
      module: 'student_management',
      recordId: studentId,
      afterData: newRecord,
      reason: '手動建立學生'
    });

    return newRecord;
  }

  /**
   * 修改學生
   */
  function updateStudent(studentId, studentData) {
    AuthService.requireAnyRole(['system_admin', 'lunch_admin']);
    var identity = AuthService.getCurrentIdentity();
    var currentDateTime = Utils.formatDateTime(new Date());

    var oldRecord = SheetRepository.findById('Students', 'student_id', studentId);
    if (!oldRecord) {
      throw new Error('找不到該學生，ID: ' + studentId);
    }

    checkStudentUniqueness(studentData.school_year || oldRecord.school_year, studentData.student_number || oldRecord.student_number, studentId);

    var updatedRecord = {
      student_id: studentId,
      student_number: studentData.student_number !== undefined ? studentData.student_number : oldRecord.student_number,
      school_year: parseInt(studentData.school_year || oldRecord.school_year, 10),
      class_id: oldRecord.class_id, // 不得直接覆蓋 class_id 換班，必須經由換班流程
      seat_number: parseInt(studentData.seat_number !== undefined ? studentData.seat_number : oldRecord.seat_number, 10),
      student_name: studentData.student_name || oldRecord.student_name,
      subsidy_category_id: oldRecord.subsidy_category_id, // 不得直接覆蓋身分
      dietary_type: studentData.dietary_type || oldRecord.dietary_type,
      meal_status: studentData.meal_status || oldRecord.meal_status,
      start_date: studentData.start_date || oldRecord.start_date,
      end_date: studentData.end_date !== undefined ? studentData.end_date : oldRecord.end_date,
      enabled: studentData.enabled !== undefined ? (studentData.enabled === true || studentData.enabled === 'TRUE') : (oldRecord.enabled === true || oldRecord.enabled === 'TRUE'),
      note: studentData.note !== undefined ? studentData.note : oldRecord.note,
      created_at: oldRecord.created_at,
      created_by: oldRecord.created_by,
      updated_at: currentDateTime,
      updated_by: identity.email
    };

    // 確保受影響期間未鎖定
    if (studentData.start_date && studentData.start_date !== oldRecord.start_date) {
      PeriodLockService.assertDateWritable(studentData.start_date);
    }
    if (studentData.end_date !== undefined && studentData.end_date !== oldRecord.end_date) {
      if (studentData.end_date) PeriodLockService.assertDateWritable(studentData.end_date);
    }

    SheetRepository.upsertRecord('Students', 'student_id', studentId, updatedRecord);

    AuditService.log({
      action: 'UPDATE_STUDENT',
      module: 'student_management',
      recordId: studentId,
      beforeData: oldRecord,
      afterData: updatedRecord,
      reason: '手動修改學生資訊'
    });

    return updatedRecord;
  }

  /**
   * 停用學生 (Soft Delete / 供餐狀態停餐)
   */
  function disableStudent(studentId, reason) {
    AuthService.requireAnyRole(['system_admin', 'lunch_admin']);
    var identity = AuthService.getCurrentIdentity();
    var currentDateTime = Utils.formatDateTime(new Date());

    var oldRecord = SheetRepository.findById('Students', 'student_id', studentId);
    if (!oldRecord) {
      throw new Error('找不到該學生，ID: ' + studentId);
    }

    var todayStr = Utils.formatDate(new Date());
    // 確保今日未鎖定
    PeriodLockService.assertDateWritable(todayStr);
    
    var updatedRecord = JSON.parse(JSON.stringify(oldRecord));
    updatedRecord.enabled = false;
    updatedRecord.meal_status = 'transferred';
    updatedRecord.end_date = todayStr;
    updatedRecord.updated_at = currentDateTime;
    updatedRecord.updated_by = identity.email;

    // 1. 更新學籍狀態
    SheetRepository.upsertRecord('Students', 'student_id', studentId, updatedRecord);

    // 2. 終止班級與補助歷程
    StudentClassHistoryService.closeCurrentHistory(studentId, todayStr);
    StudentSubsidyHistoryService.closeCurrentHistory(studentId, todayStr);

    AuditService.log({
      action: 'DISABLE_STUDENT',
      module: 'student_management',
      recordId: studentId,
      beforeData: oldRecord,
      afterData: updatedRecord,
      reason: reason || '停用(軟刪除)學生學籍'
    });

    return updatedRecord;
  }

  /**
   * 轉出/畢業作業
   */
  function transferStudent(studentId, endDate, status, reason) {
    AuthService.requireAnyRole(['system_admin', 'lunch_admin']);
    var identity = AuthService.getCurrentIdentity();
    var currentDateTime = Utils.formatDateTime(new Date());

    var oldRecord = SheetRepository.findById('Students', 'student_id', studentId);
    if (!oldRecord) {
      throw new Error('找不到該學生，ID: ' + studentId);
    }

    if (!endDate) {
      throw new Error('必須指定轉出/畢業生效日期。');
    }
    // 確保結束日期未鎖定
    PeriodLockService.assertDateWritable(endDate);

    var updatedRecord = JSON.parse(JSON.stringify(oldRecord));
    updatedRecord.enabled = false;
    updatedRecord.meal_status = status || 'transferred';
    updatedRecord.end_date = endDate;
    updatedRecord.updated_at = currentDateTime;
    updatedRecord.updated_by = identity.email;

    SheetRepository.upsertRecord('Students', 'student_id', studentId, updatedRecord);

    // 終止歷程
    StudentClassHistoryService.closeCurrentHistory(studentId, endDate);
    StudentSubsidyHistoryService.closeCurrentHistory(studentId, endDate);

    AuditService.log({
      action: 'TRANSFER_STUDENT',
      module: 'student_management',
      recordId: studentId,
      beforeData: oldRecord,
      afterData: updatedRecord,
      reason: '學生轉出/畢業: ' + (reason || '')
    });

    return updatedRecord;
  }

  return {
    listStudents: listStudents,
    getStudent: getStudent,
    createStudent: createStudent,
    updateStudent: updateStudent,
    disableStudent: disableStudent,
    transferStudent: transferStudent,
    isStudentActiveOnDate: isStudentActiveOnDate
  };
})();
