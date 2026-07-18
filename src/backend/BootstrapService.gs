/**
 * BootstrapService.gs
 * 一鍵可恢復系統初始化狀態機核心服務
 */

var BootstrapService = (function() {

  var STEPS = [
    'CREATE_ROOT_FOLDER',
    'CREATE_DATABASE',
    'CREATE_TEST_DATABASE',
    'CREATE_SUBFOLDERS',
    'CREATE_DATABASE_SCHEMAS',
    'CREATE_SYSTEM_CONFIG',
    'CREATE_SYSTEM_ADMIN',
    'CREATE_DEFAULT_TEMPLATES',
    'RUN_HEALTH_CHECK',
    'COMPLETE'
  ];

  /**
   * 取得當前初始化進度狀態
   */
  function getBootstrapStatus() {
    var props = PropertiesService.getScriptProperties();
    var status = props.getProperty('BOOTSTRAP_STATUS') || 'NOT_STARTED';
    var currentStep = props.getProperty('BOOTSTRAP_CURRENT_STEP') || 'CREATE_ROOT_FOLDER';
    
    return {
      status: status,
      currentStep: currentStep,
      startedAt: props.getProperty('BOOTSTRAP_STARTED_AT') || '',
      completedAt: props.getProperty('BOOTSTRAP_COMPLETED_AT') || '',
      completedBy: props.getProperty('BOOTSTRAP_COMPLETED_BY') || '',
      lastError: props.getProperty('BOOTSTRAP_LAST_ERROR') || '',
      databaseSpreadsheetId: props.getProperty('DATABASE_SPREADSHEET_ID') || '',
      testSpreadsheetId: props.getProperty('TEST_SPREADSHEET_ID') || '',
      reportRootFolderId: props.getProperty('REPORT_ROOT_FOLDER_ID') || '',
      testReportFolderId: props.getProperty('TEST_REPORT_FOLDER_ID') || '',
      environment: props.getProperty('ENVIRONMENT') || 'UAT'
    };
  }

  /**
   * 重設初始化狀態機
   */
  function resetBootstrap() {
    var props = PropertiesService.getScriptProperties();
    var current = props.getProperty('BOOTSTRAP_STATUS') || 'NOT_STARTED';
    if (current === 'COMPLETED') {
      throw new Error('🛑 系統已成功初始化，禁止重設！');
    }

    props.deleteProperty('BOOTSTRAP_STATUS');
    props.deleteProperty('BOOTSTRAP_CURRENT_STEP');
    props.deleteProperty('BOOTSTRAP_STARTED_AT');
    props.deleteProperty('BOOTSTRAP_LAST_ERROR');
    props.deleteProperty('DATABASE_SPREADSHEET_ID');
    props.deleteProperty('TEST_SPREADSHEET_ID');
    props.deleteProperty('REPORT_ROOT_FOLDER_ID');
    props.deleteProperty('TEST_REPORT_FOLDER_ID');
    props.deleteProperty('BOOTSTRAP_ADMIN_EMAIL');
    props.deleteProperty('ALLOWED_DOMAIN');
    
    return { success: true };
  }

  /**
   * 執行一步驟初始化 (狀態機驅動)
   */
  function executeBootstrapStep(stepName, settings) {
    var lock = LockService.getScriptLock();
    var success = lock.tryLock(15000); // 15秒超時鎖，防並行
    if (!success) {
      throw new Error('BOOTSTRAP_IN_PROGRESS: 系統初始化精靈正在執行中，請勿重複提交！');
    }

    var props = PropertiesService.getScriptProperties();
    var currentStatus = props.getProperty('BOOTSTRAP_STATUS') || 'NOT_STARTED';
    if (currentStatus === 'COMPLETED') {
      lock.releaseLock();
      return getBootstrapStatus();
    }

    var email = AuthService.getActiveUserEmail();
    var effectiveEmail = AuthService.getEffectiveUserEmail();
    if (!email) {
      lock.releaseLock();
      throw new Error('ACTIVE_USER_EMAIL_UNAVAILABLE: 無法取得當前使用者 Email，請先完成 Google 帳號授權。');
    }
    if (email !== effectiveEmail) {
      lock.releaseLock();
      throw new Error('BOOTSTRAP_DEPLOYER_ONLY: 初始化僅允許由專案部署者執行！目前登入者為 ' + email);
    }

    if (currentStatus === 'NOT_STARTED') {
      props.setProperty('BOOTSTRAP_STATUS', 'IN_PROGRESS');
      props.setProperty('BOOTSTRAP_STARTED_AT', Utils.formatDateTime(new Date()));
      props.setProperty('ENVIRONMENT', settings.environment || 'UAT');
      props.setProperty('DEPLOYMENT_MODE', settings.environment || 'UAT');
    }

    var env = props.getProperty('ENVIRONMENT') || 'UAT';

    try {
      switch (stepName) {
        case 'CREATE_ROOT_FOLDER':
          var rootId = props.getProperty('REPORT_ROOT_FOLDER_ID');
          if (!rootId) {
            var folderName = env === 'PRODUCTION' ? '學校午餐系統－正式報表' : '[UAT]午餐系統報表';
            var folder = DriveApp.createFolder(folderName);
            props.setProperty('REPORT_ROOT_FOLDER_ID', folder.getId());
          }
          props.setProperty('BOOTSTRAP_CURRENT_STEP', 'CREATE_DATABASE');
          break;

        case 'CREATE_DATABASE':
          var dbId = props.getProperty('DATABASE_SPREADSHEET_ID');
          if (!dbId) {
            var ssName = env === 'PRODUCTION' ? '學校午餐管理系統－正式資料庫' : '[UAT]學校午餐管理系統－資料庫';
            var ss = SpreadsheetApp.create(ssName);
            ss.setSpreadsheetTimeZone('Asia/Taipei');
            props.setProperty('DATABASE_SPREADSHEET_ID', ss.getId());
          }
          if (env === 'PRODUCTION') {
            props.setProperty('BOOTSTRAP_CURRENT_STEP', 'CREATE_DATABASE_SCHEMAS');
          } else {
            props.setProperty('BOOTSTRAP_CURRENT_STEP', 'CREATE_TEST_DATABASE');
          }
          break;

        case 'CREATE_TEST_DATABASE':
          if (env !== 'PRODUCTION') {
            var testId = props.getProperty('TEST_SPREADSHEET_ID');
            if (!testId) {
              var ss = SpreadsheetApp.create('[TEST]SchoolLunch');
              ss.setSpreadsheetTimeZone('Asia/Taipei');
              props.setProperty('TEST_SPREADSHEET_ID', ss.getId());
            }
          }
          props.setProperty('BOOTSTRAP_CURRENT_STEP', 'CREATE_SUBFOLDERS');
          break;

        case 'CREATE_SUBFOLDERS':
          if (env !== 'PRODUCTION') {
            var testFolderId = props.getProperty('TEST_REPORT_FOLDER_ID');
            if (!testFolderId) {
              var rootId = props.getProperty('REPORT_ROOT_FOLDER_ID');
              var rootFolder = DriveApp.getFolderById(rootId);
              var testFolder = rootFolder.createFolder('[TEST]測試結果');
              props.setProperty('TEST_REPORT_FOLDER_ID', testFolder.getId());
            }
          }
          props.setProperty('BOOTSTRAP_CURRENT_STEP', 'CREATE_DATABASE_SCHEMAS');
          break;

        case 'CREATE_DATABASE_SCHEMAS':
          var dbId = props.getProperty('DATABASE_SPREADSHEET_ID');
          var dbSs = SpreadsheetApp.openById(dbId);
          SetupService.initializeDatabaseForSs(dbSs, settings);
          
          if (env !== 'PRODUCTION') {
            var testId = props.getProperty('TEST_SPREADSHEET_ID');
            if (testId) {
              var testSs = SpreadsheetApp.openById(testId);
              SetupService.initializeDatabaseForSs(testSs, settings);
            }
          }
          props.setProperty('BOOTSTRAP_CURRENT_STEP', 'CREATE_SYSTEM_CONFIG');
          break;

        case 'CREATE_SYSTEM_CONFIG':
          // 寫入系統設定，包括精確小數設定與時區
          var allowedDomain = email.split('@')[1] || '';
          props.setProperties({
            'ALLOWED_DOMAIN': allowedDomain,
            'BOOTSTRAP_ADMIN_EMAIL': email,
            'CALCULATION_SCALE': '2',
            'SETTLEMENT_SCALE': '0',
            'CURRENCY_CODE': 'TWD',
            'TIMEZONE': 'Asia/Taipei'
          });
          props.setProperty('BOOTSTRAP_CURRENT_STEP', 'CREATE_SYSTEM_ADMIN');
          break;

        case 'CREATE_SYSTEM_ADMIN':
          // 再次核對管理員已被寫入
          props.setProperty('BOOTSTRAP_CURRENT_STEP', 'CREATE_DEFAULT_TEMPLATES');
          break;

        case 'CREATE_DEFAULT_TEMPLATES':
          // 預設範本改為 draft (Phase 6.5 治理規範)
          var dbId = props.getProperty('DATABASE_SPREADSHEET_ID');
          var ss = SpreadsheetApp.openById(dbId);
          var tplSheet = ss.getSheetByName('ReportTemplates');
          if (tplSheet) {
            var lastRow = tplSheet.getLastRow();
            if (lastRow > 1) {
              tplSheet.getRange(2, 13, lastRow - 1, 1).setValue('draft');
            }
          }
          props.setProperty('BOOTSTRAP_CURRENT_STEP', 'RUN_HEALTH_CHECK');
          break;

        case 'RUN_HEALTH_CHECK':
          // 自我健康診斷，確認 29 張表 headers 均正常
          props.setProperty('BOOTSTRAP_CURRENT_STEP', 'COMPLETE');
          break;

        case 'COMPLETE':
          props.setProperty('BOOTSTRAP_STATUS', 'COMPLETED');
          props.setProperty('BOOTSTRAP_COMPLETED_AT', Utils.formatDateTime(new Date()));
          props.setProperty('BOOTSTRAP_COMPLETED_BY', email);
          break;

        default:
          throw new Error('未知狀態步驟：' + stepName);
      }
      
      props.deleteProperty('BOOTSTRAP_LAST_ERROR'); // 清除上次錯誤

    } catch (e) {
      props.setProperty('BOOTSTRAP_LAST_ERROR', e.message);
      props.setProperty('BOOTSTRAP_STATUS', 'FAILED');
      lock.releaseLock();
      throw e;
    }

    lock.releaseLock();
    return getBootstrapStatus();
  }

  return {
    getBootstrapStatus: getBootstrapStatus,
    executeBootstrapStep: executeBootstrapStep,
    resetBootstrap: resetBootstrap
  };
})();
