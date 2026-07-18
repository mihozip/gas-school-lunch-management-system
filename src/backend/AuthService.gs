/**
 * AuthService.gs
 * 使用者身份驗證與角色授權服務
 */

var AuthService = (function() {

  /**
   * 驗證 Email 網域是否屬於允許的 Google Workspace 網域
   * @param {string} email 使用者 Email
   * @return {boolean} 是否符合網域
   */
  function validateDomain(email) {
    if (!email) return false;
    var allowedDomain = Config.getAllowedDomain();
    if (!allowedDomain) return true; // 若未設定允許網域，則不限制 (允許所有人)
    
    var parts = email.split('@');
    if (parts.length < 2) return false;
    return parts[1].toLowerCase() === allowedDomain.toLowerCase();
  }

  /**
   * 取得當前存取者的 Email
   * @return {string} 使用者 Email
   */
  function getActiveUserEmail() {
    try {
      return Session.getActiveUser().getEmail();
    } catch (e) {
      return '';
    }
  }

  /**
   * 取得執行應用程式的使用者 Email (部署者)
   * @return {string} 部署者 Email
   */
  function getEffectiveUserEmail() {
    try {
      return Session.getEffectiveUser().getEmail();
    } catch (e) {
      return '';
    }
  }

  /**
   * 獲取當前登入使用者的系統身份與權限資訊
   * @return {object} { email, name, role, class_id, enabled, isBootstrapper }
   */
  function getCurrentIdentity() {
    var email = getActiveUserEmail();
    var effectiveEmail = getEffectiveUserEmail();
    
    var identity = {
      email: email,
      name: '未登入或無法取得身份',
      role: '',
      class_id: null,
      enabled: false,
      isBootstrapper: false
    };

    // 檢查是否為部署者本人 (即系統引導啟動者)
    if (email && email === effectiveEmail) {
      identity.isBootstrapper = true;
    }

    if (!email) {
      return identity;
    }

    // 驗證網域
    if (!validateDomain(identity.email)) {
      return identity;
    }

    try {
      // 從 Users 工作表查詢權限
      if (SheetRepository.sheetExists('Users')) {
        var user = SheetRepository.findById('Users', 'email', identity.email);
        if (user) {
          identity.name = user.name;
          identity.role = user.role;
          identity.class_id = user.class_id || null;
          identity.enabled = (user.enabled === true || user.enabled === 'TRUE');
        } else if (identity.isBootstrapper) {
          // 資料庫中還沒有部署者的帳號，但因為他是部署者本人且正在初始化，特許為最高管理員
          identity.name = '系統部署者 (開發臨時帳號)';
          identity.role = 'system_admin';
          identity.enabled = true;
        }
      } else if (identity.isBootstrapper) {
        // 工作表根本還沒建立 (未初始化狀態)，特許部署者為最高管理員以利執行 SetupService
        identity.name = '系統引導者 (未初始化)';
        identity.role = 'system_admin';
        identity.enabled = true;
      }
    } catch (e) {
      // 讀取 Users 表失敗時 (如未初始化)，若是部署者本人仍視為 system_admin
      if (identity.isBootstrapper) {
        identity.name = '系統部署者 (讀取失敗異常)';
        identity.role = 'system_admin';
        identity.enabled = true;
      }
    }

    return identity;
  }

  /**
   * 強制要求使用者必須登入，Email 不得為空，且必須啟用
   */
  function requireAuthenticatedUser() {
    var identity = getCurrentIdentity();
    if (!identity.email) {
      throw new Error('未登入或無法取得 Google 帳號 Email，請確認瀏覽器授權。');
    }
    if (!identity.enabled) {
      throw new Error('使用者帳號已停用或未授權，Email: ' + identity.email);
    }
    return identity;
  }

  /**
   * 檢查並限制特定角色存取權限
   * @param {string} role 要求的角色 (例如 system_admin)
   */
  function requireRole(role) {
    var identity = requireAuthenticatedUser();
    if (identity.role !== role) {
      throw new Error('權限不足，必須具備 ' + role + ' 權限。');
    }
    return identity;
  }

  /**
   * 檢查並限制具備多個角色之一的存取權限
   * @param {string[]} roles 要求的角色清單
   */
  function requireAnyRole(roles) {
    var identity = requireAuthenticatedUser();
    if (roles.indexOf(identity.role) === -1) {
      throw new Error('權限不足，無存取權限。');
    }
    return identity;
  }

  /**
   * 限制僅能存取特定班級 (導師限定自己班，管理員可存取所有班)
   * @param {string} classId 欲存取的班級 ID
   */
  function requireClassAccess(classId) {
    var identity = requireAuthenticatedUser();
    if (identity.role === 'class_teacher') {
      if (String(identity.class_id) !== String(classId)) {
        throw new Error('權限不足，導師僅能操作所屬班級。');
      }
    } else {
      // 必須是管理員或相關行政才能存取
      requireAnyRole(['system_admin', 'lunch_admin', 'accountant', 'viewer']);
    }
    return identity;
  }

  /**
   * 獲取完整的登入與權限診斷資訊 (不包含任何敏感的 OAuth Token)
   * @return {object} 診斷資料
   */
  function getAuthorizationDiagnostic() {
    var activeEmail = getActiveUserEmail();
    var effectiveEmail = getEffectiveUserEmail();
    var currentDomain = '';
    if (activeEmail) {
      var parts = activeEmail.split('@');
      if (parts.length >= 2) currentDomain = parts[1];
    }

    var identity = getCurrentIdentity();
    
    var diagnostic = {
      activeUserEmail: activeEmail,
      effectiveUserEmail: effectiveEmail,
      temporaryUserKey: activeEmail ? Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, activeEmail)).substring(0, 10) : 'N/A',
      scriptTimeZone: Session.getScriptTimeZone(),
      spreadsheetTimeZone: 'N/A',
      deploymentMode: Config.getDeploymentMode(),
      authorizationStatus: activeEmail ? 'AUTHORIZED' : 'NO_EMAIL',
      currentDomain: currentDomain,
      currentUserRole: identity.role || 'NONE',
      spreadsheetReadable: false,
      reportFolderReadable: false,
      reportFolderWritable: false
    };

    // 檢查試算表與雲端硬碟資料夾存取權限
    try {
      var ssId = Config.getSpreadsheetId();
      if (ssId) {
        var ss = SpreadsheetApp.openById(ssId);
        diagnostic.spreadsheetTimeZone = ss.getSpreadsheetTimeZone();
        diagnostic.spreadsheetReadable = true;
      }
    } catch (e) {}

    try {
      var folderId = Config.getReportRootFolderId();
      if (folderId) {
        var folder = DriveApp.getFolderById(folderId);
        diagnostic.reportFolderReadable = true;
        
        // 測試建立與刪除暫存檔案以確認寫入權限
        var testFile = folder.createFile('temp_auth_test.txt', 'test');
        testFile.setTrashed(true);
        diagnostic.reportFolderWritable = true;
      }
    } catch (e) {}

    return diagnostic;
  }

  return {
    validateDomain: validateDomain,
    getActiveUserEmail: getActiveUserEmail,
    getEffectiveUserEmail: getEffectiveUserEmail,
    getCurrentIdentity: getCurrentIdentity,
    requireAuthenticatedUser: requireAuthenticatedUser,
    requireRole: requireRole,
    requireAnyRole: requireAnyRole,
    requireClassAccess: requireClassAccess,
    getAuthorizationDiagnostic: getAuthorizationDiagnostic
  };
})();
