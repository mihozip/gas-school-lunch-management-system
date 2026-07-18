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

    // 步驟順序防護
    var currentStep = props.getProperty('BOOTSTRAP_CURRENT_STEP') || 'CREATE_ROOT_FOLDER';
    if (stepName !== currentStep) {
      lock.releaseLock();
      throw new Error('BOOTSTRAP_STEP_MISMATCH: 步驟不符。預期執行：' + currentStep + '，實際收到：' + stepName);
    }

    if (currentStatus === 'NOT_STARTED') {
      props.setProperty('BOOTSTRAP_STATUS', 'IN_PROGRESS');
      props.setProperty('BOOTSTRAP_STARTED_AT', Utils.formatDateTime(new Date()));
      var inputEnv = settings.environment || 'UAT';
      if (inputEnv !== 'UAT' && inputEnv !== 'PRODUCTION') {
        inputEnv = 'UAT';
      }
      props.setProperty('ENVIRONMENT', inputEnv);
      props.setProperty('DEPLOYMENT_MODE', inputEnv);
    }

    var env = props.getProperty('ENVIRONMENT') || 'UAT';
    if (currentStatus !== 'NOT_STARTED' && settings.environment && settings.environment !== env) {
      lock.releaseLock();
      throw new Error('BOOTSTRAP_ENV_MISMATCH: 禁止在初始化過程中修改執行環境！');
    }

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
          settings.environment = env;
          SetupService.initializeDatabaseForSs(dbSs, settings);
          
          if (env !== 'PRODUCTION') {
            var testId = props.getProperty('TEST_SPREADSHEET_ID');
            if (testId) {
              var testSs = SpreadsheetApp.openById(testId);
              var testSettings = JSON.parse(JSON.stringify(settings));
              testSettings.environment = 'TEST';
              SetupService.initializeDatabaseForSs(testSs, testSettings);
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
          
          // UAT 與 PRODUCTION 寫入 SystemConfig ENVIRONMENT 屬性
          var dbId = props.getProperty('DATABASE_SPREADSHEET_ID');
          var dbSs = SpreadsheetApp.openById(dbId);
          var configSheet = dbSs.getSheetByName('SystemConfig');
          if (configSheet) {
            // 先找是否已有 ENVIRONMENT
            var rows = configSheet.getDataRange().getValues();
            var exists = false;
            for (var r = 1; r < rows.length; r++) {
              if (rows[r][0] === 'ENVIRONMENT') {
                configSheet.getRange(r + 1, 2).setValue(env);
                exists = true;
                break;
              }
            }
            if (!exists) {
              configSheet.appendRow(['ENVIRONMENT', env, '系統執行環境', Utils.formatDateTime(new Date()), email]);
            }
          }
          
          props.setProperty('BOOTSTRAP_CURRENT_STEP', 'CREATE_SYSTEM_ADMIN');
          break;

        case 'CREATE_SYSTEM_ADMIN':
          var dbId = props.getProperty('DATABASE_SPREADSHEET_ID');
          if (!dbId) {
            throw new Error('DATABASE_NOT_FOUND: 找不到資料庫 ID，請先執行 CREATE_DATABASE 步驟。');
          }
          var dbSs = SpreadsheetApp.openById(dbId);
          var userSheet = dbSs.getSheetByName('Users');
          if (!userSheet) {
            throw new Error('USERS_SHEET_NOT_FOUND: 找不到 Users 工作表。');
          }
          
          var userRows = userSheet.getDataRange().getValues();
          var userHeaders = userRows[0];
          var emailIdx = userHeaders.indexOf('email');
          if (emailIdx === -1) throw new Error('USERS_EMAIL_COLUMN_NOT_FOUND: Users 表缺少 email 欄位。');
          
          var userExists = false;
          for (var r = 1; r < userRows.length; r++) {
            if (String(userRows[r][emailIdx]).trim().toLowerCase() === email.trim().toLowerCase()) {
              userExists = true;
              break;
            }
          }
          
          if (!userExists) {
            var userId = 'USER_' + new Date().getTime();
            var newRow = [];
            userHeaders.forEach(function(header) {
              switch (header) {
                case 'user_id': newRow.push(userId); break;
                case 'email': newRow.push(email); break;
                case 'name': newRow.push(settings.adminName || '系統管理員'); break;
                case 'role': newRow.push('system_admin'); break;
                case 'class_id': newRow.push(''); break;
                case 'enabled': newRow.push(true); break;
                case 'created_at': newRow.push(Utils.formatDateTime(new Date())); break;
                case 'updated_at': newRow.push(Utils.formatDateTime(new Date())); break;
                default: newRow.push('');
              }
            });
            userSheet.appendRow(newRow);
            
            // 寫入 AuditLogs
            var auditSheet = dbSs.getSheetByName('AuditLogs');
            if (auditSheet) {
              var auditHeaders = auditSheet.getDataRange().getValues()[0];
              var auditRow = [];
              auditHeaders.forEach(function(header) {
                switch (header) {
                  case 'log_id': auditRow.push(Utils.generateUUID()); break;
                  case 'timestamp': auditRow.push(Utils.formatDateTime(new Date())); break;
                  case 'user_email': auditRow.push(email); break;
                  case 'action': auditRow.push('CREATE_SYSTEM_ADMIN'); break;
                  case 'module': auditRow.push('BOOTSTRAP'); break;
                  case 'record_id': auditRow.push(email); break;
                  case 'before_data': auditRow.push(''); break;
                  case 'after_data': auditRow.push(JSON.stringify({ role: 'system_admin' })); break;
                  case 'reason': auditRow.push('一鍵初始化建立系統管理員'); break;
                  case 'ip_or_session': auditRow.push(''); break;
                  case 'calculation_version': auditRow.push(0); break;
                  default: auditRow.push('');
                }
              });
              auditSheet.appendRow(auditRow);
            }
          }
          props.setProperty('BOOTSTRAP_CURRENT_STEP', 'CREATE_DEFAULT_TEMPLATES');
          break;

        case 'CREATE_DEFAULT_TEMPLATES':
          var dbId = props.getProperty('DATABASE_SPREADSHEET_ID');
          var ss = SpreadsheetApp.openById(dbId);
          var tplSheet = ss.getSheetByName('ReportTemplates');
          if (tplSheet) {
            var rows = tplSheet.getDataRange().getValues();
            var existingTplIds = rows.slice(1).map(function(r) { return r[0]; });
            var defaultTpls = [
              ['TMP_TOWNSHIP_V1', 'TOWNSHIP_FUNDING_APPLICATION', '通用版公所補助申請表', '1', 'HTML', 'HTML_BUILTIN', '', '{}', '{}', '2026-01-01', '2099-12-31', true, 'draft', email, Utils.formatDateTime(new Date()), '', '', '', '預設公所範本', 'INTERNAL_STUDENT_DETAIL'],
              ['TMP_COUNTY_V1', 'COUNTY_FUNDING_APPLICATION', '通用版縣府補助申請表', '1', 'HTML', 'HTML_BUILTIN', '', '{}', '{}', '2026-01-01', '2099-12-31', true, 'draft', email, Utils.formatDateTime(new Date()), '', '', '', '預設縣府範本', 'INTERNAL_STUDENT_DETAIL'],
              ['TMP_MEAL_SUM_V1', 'MONTHLY_MEAL_SUMMARY', '通用版每月餐數統計表', '1', 'HTML', 'HTML_BUILTIN', '', '{}', '{}', '2026-01-01', '2099-12-31', true, 'draft', email, Utils.formatDateTime(new Date()), '', '', '', '預設月餐統計範本', 'PUBLIC_SUMMARY']
            ];
            
            var newTpls = [];
            defaultTpls.forEach(function(tpl) {
              if (existingTplIds.indexOf(tpl[0]) === -1) {
                newTpls.push(tpl);
              }
            });
            if (newTpls.length > 0) {
              tplSheet.getRange(tplSheet.getLastRow() + 1, 1, newTpls.length, 20).setValues(newTpls);
            }
          }
          props.setProperty('BOOTSTRAP_CURRENT_STEP', 'RUN_HEALTH_CHECK');
          break;

        case 'RUN_HEALTH_CHECK':
          // 實際呼叫 SetupService.getSystemStatus()
          var status = SetupService.getSystemStatus();
          var errors = [];
          
          if (status.sheetsCount.current !== 29) {
            errors.push('資料表數量不符：預期 29，實際為 ' + status.sheetsCount.current);
          }
          if (!status.isInitialized) {
            errors.push('系統未完成初始化 (isInitialized 為 false)');
          }
          if (!status.requiredConfigComplete) {
            errors.push('必要設定未完成 (requiredConfigComplete 為 false)');
          }
          if (status.blockingIssues && status.blockingIssues.length > 0) {
            errors.push('存在阻斷性問題：' + status.blockingIssues.join('; '));
          }
          if (!status.timezoneCheck.matches) {
            errors.push('時區不相符或非 Asia/Taipei。Script 時區: ' + status.timezoneCheck.scriptTimeZone + ', Spreadsheet 時區: ' + status.timezoneCheck.spreadsheetTimeZone);
          }
          if (!status.folderStatus.writable) {
            errors.push('報表資料夾不具備寫入權限');
          }
          
          if (errors.length > 0) {
            var errorMsg = '健康檢查失敗：' + errors.join(' | ');
            props.setProperty('BOOTSTRAP_LAST_ERROR', errorMsg);
            props.setProperty('BOOTSTRAP_STATUS', 'FAILED');
            lock.releaseLock();
            throw new Error(errorMsg);
          }
          
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
