/**
 * ClassService.gs
 * 班級管理服務
 */

var ClassService = (function() {

  /**
   * 取得班級清單 (支援搜尋與篩選)
   * @param {object} filters { school_year, grade, enabled, search }
   * @return {object[]} 班級清單
   */
  function listClasses(filters) {
    // 角色權限檢驗
    AuthService.requireAuthenticatedUser();
    var identity = AuthService.getCurrentIdentity();
    
    var records = SheetRepository.getAllRecords('Classes');
    
    // 如果是 class_teacher，只能看到自己所屬的班級
    if (identity.role === 'class_teacher') {
      records = records.filter(function(r) {
        return r.class_id === identity.class_id;
      });
    }

    // 套用過濾條件
    if (filters) {
      if (filters.school_year) {
        records = records.filter(function(r) {
          return String(r.school_year) === String(filters.school_year);
        });
      }
      if (filters.grade) {
        records = records.filter(function(r) {
          return String(r.grade) === String(filters.grade);
        });
      }
      if (filters.enabled !== undefined && filters.enabled !== null && filters.enabled !== '') {
        var isEnabled = filters.enabled === 'true' || filters.enabled === true;
        records = records.filter(function(r) {
          return (r.enabled === true || r.enabled === 'TRUE') === isEnabled;
        });
      }
      if (filters.search) {
        var query = filters.search.toLowerCase();
        records = records.filter(function(r) {
          return (r.class_name && r.class_name.toLowerCase().indexOf(query) !== -1) ||
                 (r.class_code && r.class_code.toLowerCase().indexOf(query) !== -1) ||
                 (r.teacher_name && r.teacher_name.toLowerCase().indexOf(query) !== -1);
        });
      }
    }

    // 依 display_order 與 class_code 排序
    records.sort(function(a, b) {
      var ordA = parseInt(a.display_order || 0, 10);
      var ordB = parseInt(b.display_order || 0, 10);
      if (ordA !== ordB) return ordA - ordB;
      return String(a.class_code).localeCompare(String(b.class_code));
    });

    return records;
  }

  /**
   * 驗證教師 Email 是否合法存在於 Users 帳號名冊中
   * @param {string} email 教師 Email
   */
  function validateTeacherEmail(email) {
    if (!email) return;
    var user = SheetRepository.findById('Users', 'email', email);
    if (!user) {
      throw new Error('教師帳號 ' + email + ' 尚未在「系統使用者」中建立，請先至使用者設定頁面建立該帳號。');
    }
  }

  /**
   * 檢查班級唯一性 (school_year + class_code)
   */
  function checkClassUniqueness(schoolYear, classCode, excludeClassId) {
    var duplicates = SheetRepository.findRecords('Classes', function(r) {
      return String(r.school_year) === String(schoolYear) && 
             String(r.class_code).toUpperCase() === String(classCode).toUpperCase() &&
             r.class_id !== excludeClassId;
    });
    if (duplicates.length > 0) {
      throw new Error('在此學年度 (' + schoolYear + ') 下已存在相同班級代碼 (' + classCode + ') 的班級。');
    }
  }

  /**
   * 建立班級
   * @param {object} classData 班級資料
   */
  function createClass(classData) {
    AuthService.requireAnyRole(['system_admin', 'lunch_admin']);
    var identity = AuthService.getCurrentIdentity();
    var currentDateTime = Utils.formatDateTime(new Date());

    if (!classData.school_year || !classData.class_name || !classData.class_code) {
      throw new Error('請輸入必填欄位 (學年度、班級名稱、班級代碼)');
    }

    // 檢查教師
    validateTeacherEmail(classData.teacher_email);
    // 檢查唯一性
    checkClassUniqueness(classData.school_year, classData.class_code);

    var classId = Utils.generateUUID();
    var newRecord = {
      class_id: classId,
      school_year: parseInt(classData.school_year, 10),
      grade: parseInt(classData.grade || 1, 10),
      class_name: classData.class_name,
      class_code: String(classData.class_code).toUpperCase(),
      class_type: classData.class_type || 'regular',
      teacher_name: classData.teacher_name || '',
      teacher_email: classData.teacher_email || '',
      display_order: parseInt(classData.display_order || 99, 10),
      enabled: classData.enabled !== false && classData.enabled !== 'FALSE',
      created_at: currentDateTime,
      created_by: identity.email,
      updated_at: currentDateTime,
      updated_by: identity.email
    };

    SheetRepository.appendRecord('Classes', newRecord);

    // 寫入 AuditLogs
    AuditService.log({
      action: 'CREATE_CLASS',
      module: 'class_management',
      recordId: classId,
      afterData: newRecord,
      reason: '手動建立班級'
    });

    return newRecord;
  }

  /**
   * 修改班級
   * @param {string} classId 班級 ID
   * @param {object} classData 修改資料
   */
  function updateClass(classId, classData) {
    AuthService.requireAnyRole(['system_admin', 'lunch_admin']);
    var identity = AuthService.getCurrentIdentity();
    var currentDateTime = Utils.formatDateTime(new Date());

    var oldRecord = SheetRepository.findById('Classes', 'class_id', classId);
    if (!oldRecord) {
      throw new Error('找不到該班級，ID: ' + classId);
    }

    validateTeacherEmail(classData.teacher_email);
    checkClassUniqueness(classData.school_year || oldRecord.school_year, classData.class_code || oldRecord.class_code, classId);

    var updatedRecord = {
      class_id: classId,
      school_year: parseInt(classData.school_year || oldRecord.school_year, 10),
      grade: parseInt(classData.grade || oldRecord.grade, 10),
      class_name: classData.class_name || oldRecord.class_name,
      class_code: String(classData.class_code || oldRecord.class_code).toUpperCase(),
      class_type: classData.class_type || oldRecord.class_type,
      teacher_name: classData.teacher_name !== undefined ? classData.teacher_name : oldRecord.teacher_name,
      teacher_email: classData.teacher_email !== undefined ? classData.teacher_email : oldRecord.teacher_email,
      display_order: parseInt(classData.display_order !== undefined ? classData.display_order : oldRecord.display_order, 10),
      enabled: classData.enabled !== undefined ? (classData.enabled === true || classData.enabled === 'TRUE') : (oldRecord.enabled === true || oldRecord.enabled === 'TRUE'),
      created_at: oldRecord.created_at,
      created_by: oldRecord.created_by,
      updated_at: currentDateTime,
      updated_by: identity.email
    };

    SheetRepository.upsertRecord('Classes', 'class_id', classId, updatedRecord);

    AuditService.log({
      action: 'UPDATE_CLASS',
      module: 'class_management',
      recordId: classId,
      beforeData: oldRecord,
      afterData: updatedRecord,
      reason: '手動修改班級'
    });

    return updatedRecord;
  }

  /**
   * 停用班級 (僅當無任何關聯學生時允許)
   * @param {string} classId 班級 ID
   */
  function disableClass(classId) {
    AuthService.requireAnyRole(['system_admin', 'lunch_admin']);
    var identity = AuthService.getCurrentIdentity();
    var currentDateTime = Utils.formatDateTime(new Date());

    var oldRecord = SheetRepository.findById('Classes', 'class_id', classId);
    if (!oldRecord) {
      throw new Error('找不到該班級，ID: ' + classId);
    }

    // 檢查是否有學生關聯 (Students 工作表中含有此 class_id 的學生)
    var associatedStudents = SheetRepository.findRecords('Students', function(r) {
      return r.class_id === classId;
    });

    if (associatedStudents.length > 0) {
      throw new Error('該班級目前名冊中尚有 ' + associatedStudents.length + ' 名學生，無法直接停用或刪除該班級。請先將學生轉至其他班級。');
    }

    var updatedRecord = JSON.parse(JSON.stringify(oldRecord));
    updatedRecord.enabled = false;
    updatedRecord.updated_at = currentDateTime;
    updatedRecord.updated_by = identity.email;

    SheetRepository.upsertRecord('Classes', 'class_id', classId, updatedRecord);

    AuditService.log({
      action: 'DISABLE_CLASS',
      module: 'class_management',
      recordId: classId,
      beforeData: oldRecord,
      afterData: updatedRecord,
      reason: '停用班級'
    });

    return updatedRecord;
  }

  /**
   * 批次建立班級
   * @param {object[]} classesList 班級物件陣列
   */
  function batchCreateClasses(classesList) {
    AuthService.requireAnyRole(['system_admin', 'lunch_admin']);
    var results = { successCount: 0, errors: [] };

    classesList.forEach(function(c, index) {
      try {
        createClass(c);
        results.successCount++;
      } catch (e) {
        results.errors.push('第 ' + (index + 1) + ' 筆建立失敗: ' + e.message);
      }
    });

    return results;
  }

  return {
    listClasses: listClasses,
    createClass: createClass,
    updateClass: updateClass,
    disableClass: disableClass,
    batchCreateClasses: batchCreateClasses
  };
})();
