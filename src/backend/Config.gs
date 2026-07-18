/**
 * Config.gs
 * 系統設定管理模組，提供 Script Properties 與 SystemConfig 工作表之存取與快取機制
 */

var Config = (function() {
  var CACHE_PREFIX = 'sys_config_';
  var CACHE_EXPIRY_SEC = 1200; // 20 分鐘快取

  /**
   * 取得 Script Properties
   * @param {string} key 設定鍵
   * @return {string} 設定值
   */
  function getProperty(key) {
    return PropertiesService.getScriptProperties().getProperty(key) || '';
  }

  /**
   * 寫入 Script Properties
   * @param {string} key 設定鍵
   * @param {string} val 設定值
   */
  function setProperty(key, val) {
    PropertiesService.getScriptProperties().setProperty(key, val);
  }

  /**
   * 批次寫入 Script Properties
   * @param {object} props 鍵值對物件
   */
  function setProperties(props) {
    PropertiesService.getScriptProperties().setProperties(props);
  }

  var isTestMode = false;

  /**
   * 設定目前是否為自動測試模式
   * @param {boolean} enabled 是否啟用測試模式
   */
  function setTestMode(enabled) {
    isTestMode = enabled;
  }

  /**
   * 取得目前連接的試算表 ID
   * 優先讀取 Script Property DATABASE_SPREADSHEET_ID，若為空則嘗試取得綁定的 active spreadsheet
   * @return {string} Spreadsheet ID
   */
  function getSpreadsheetId() {
    if (isTestMode) {
      var testId = getProperty('TEST_SPREADSHEET_ID');
      if (!testId) {
        throw new Error('自動測試模式已啟動，但 Script Properties 中未設定 TEST_SPREADSHEET_ID');
      }
      return testId;
    }
    
    var id = getProperty('DATABASE_SPREADSHEET_ID');
    if (!id) {
      try {
        var activeSs = SpreadsheetApp.getActiveSpreadsheet();
        if (activeSs) {
          id = activeSs.getId();
          setProperty('DATABASE_SPREADSHEET_ID', id); // 自動寫入 Properties 方便後續存取
        }
      } catch (e) {
        // 非試算表綁定腳本時可能失敗
      }
    }
    return id;
  }

  /**
   * 取得當前系統環境 (DEVELOPMENT, TEST, PRODUCTION)
   * @return {string} 環境名稱
   */
  function getEnvironment() {
    // 優先從系統設定中讀取，若無則讀取 Script Property，預設為 DEVELOPMENT
    var env = '';
    try {
      env = getSystemConfig('ENVIRONMENT', '');
    } catch (e) {}
    if (!env) {
      env = getProperty('ENVIRONMENT') || 'DEVELOPMENT';
    }
    return env.toUpperCase();
  }


  /**
   * 取得報表儲存根資料夾 ID
   * @return {string} Drive Folder ID
   */
  function getReportRootFolderId() {
    return getProperty('REPORT_ROOT_FOLDER_ID');
  }

  /**
   * 取得部署模式 (DOMAIN 或 ANYONE)
   * @return {string} 部署模式
   */
  function getDeploymentMode() {
    return getProperty('DEPLOYMENT_MODE') || 'DOMAIN';
  }

  /**
   * 取得允許登入的 Google Workspace 網域
   * @return {string} 網域名稱 (如 school.edu.tw)
   */
  function getAllowedDomain() {
    return getProperty('ALLOWED_DOMAIN') || '';
  }

  /**
   * 驗證試算表 ID 是否可用且具備讀取權限
   * @param {string} id 試算表 ID
   * @return {boolean} 是否可用
   */
  function validateSpreadsheetId(id) {
    if (!id) return false;
    try {
      var ss = SpreadsheetApp.openById(id);
      return ss !== null;
    } catch (e) {
      return false;
    }
  }

  /**
   * 驗證報表資料夾 ID 是否可用且具備讀寫權限
   * @param {string} id 資料夾 ID
   * @return {boolean} 是否可用且具讀寫權限
   */
  function validateReportFolderId(id) {
    if (!id) return false;
    try {
      var folder = DriveApp.getFolderById(id);
      // 測試建立與刪除暫存檔案以確認寫入權限
      var testFile = folder.createFile('temp_write_test.txt', 'test');
      testFile.setTrashed(true);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * 從 SystemConfig 工作表獲取設定項目 (包含快取)
   * @param {string} key 設定鍵
   * @param {any} defaultVal 預設值 (選填)
   * @return {string} 設定值
   */
  function getSystemConfig(key, defaultVal) {
    var cache = CacheService.getScriptCache();
    var cachedVal = cache.get(CACHE_PREFIX + key);
    if (cachedVal !== null) {
      return cachedVal;
    }

    var val = defaultVal || '';
    try {
      var ssId = getSpreadsheetId();
      if (ssId) {
        var ss = SpreadsheetApp.openById(ssId);
        var sheet = ss.getSheetByName('SystemConfig');
        if (sheet) {
          var data = sheet.getDataRange().getValues();
          // 第一列為 Header: config_key, config_value...
          for (var i = 1; i < data.length; i++) {
            if (data[i][0] === key) {
              val = String(data[i][1]);
              break;
            }
          }
        }
      }
    } catch (e) {
      // 系統尚未初始化或找不到表格時回傳預設值
    }

    // 寫入快取
    try {
      cache.put(CACHE_PREFIX + key, val, CACHE_EXPIRY_SEC);
    } catch (e) {}

    return val;
  }

  /**
   * 清除特定設定快取
   * @param {string} key 設定鍵
   */
  function clearCache(key) {
    try {
      var cache = CacheService.getScriptCache();
      cache.remove(CACHE_PREFIX + key);
    } catch (e) {}
  }

  /**
   * 清除所有系統設定快取
   */
  function clearAllCache() {
    try {
      var cache = CacheService.getScriptCache();
      var keys = [
        'SCHOOL_NAME', 'SCHOOL_CODE', 'SCHOOL_YEAR', 'SEMESTER', 'TIMEZONE',
        'DEFAULT_MEAL_PRICE', 'DAILY_CONFIRM_DEADLINE', 'REPORT_FOLDER_ID',
        'CURRENT_MONTH', 'ALLOW_RETROACTIVE_EDIT', 'RETROACTIVE_EDIT_DAYS',
        'ROUNDING_RULE', 'ROUNDING_MODE', 'ROUNDING_SCALE',
        'ALLOW_SUBSIDY_OVER_MEAL_PRICE', 'MIXED_RULE_CALCULATION_ORDER',
        'ENABLE_DIETARY_STATS', 'DIETARY_TYPES', 'INCLUDED_CLASS_TYPES', 'REOPEN_CONFIRM_ROLE'
      ];
      var cacheKeys = keys.map(function(k) { return CACHE_PREFIX + k; });
      cache.removeAll(cacheKeys);
    } catch (e) {}
  }

  /**
   * 檢查必填設定是否完整
   * @return {object} 檢查結果 { missingProps: [], missingConfig: [] }
   */
  function checkRequiredSettings() {
    var missingProps = [];
    var missingConfig = [];

    if (!getProperty('DATABASE_SPREADSHEET_ID')) missingProps.push('DATABASE_SPREADSHEET_ID');
    if (!getProperty('REPORT_ROOT_FOLDER_ID')) missingProps.push('REPORT_ROOT_FOLDER_ID');
    if (!getProperty('DEPLOYMENT_MODE')) missingProps.push('DEPLOYMENT_MODE');

    var requiredConfigKeys = [
      'SCHOOL_NAME', 'SCHOOL_YEAR', 'SEMESTER', 'DEFAULT_MEAL_PRICE',
      'DAILY_CONFIRM_DEADLINE', 'ROUNDING_RULE', 'ROUNDING_MODE', 'ROUNDING_SCALE'
    ];

    requiredConfigKeys.forEach(function(key) {
      if (getSystemConfig(key) === '') {
        missingConfig.push(key);
      }
    });

    return {
      missingProps: missingProps,
      missingConfig: missingConfig
    };
  }

  return {
    getProperty: getProperty,
    setProperty: setProperty,
    setProperties: setProperties,
    getSpreadsheetId: getSpreadsheetId,
    getReportRootFolderId: getReportRootFolderId,
    getDeploymentMode: getDeploymentMode,
    getAllowedDomain: getAllowedDomain,
    validateSpreadsheetId: validateSpreadsheetId,
    validateReportFolderId: validateReportFolderId,
    getSystemConfig: getSystemConfig,
    clearCache: clearCache,
    clearAllCache: clearAllCache,
    checkRequiredSettings: checkRequiredSettings,
    setTestMode: setTestMode,
    getEnvironment: getEnvironment
  };
})();
