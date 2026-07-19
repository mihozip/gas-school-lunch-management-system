// tools/static-check.mjs
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

let errorsCount = 0;

function logError(msg) {
  console.error(`❌ [STATIC CHECK ERROR]: ${msg}`);
  errorsCount++;
}

function checkCodeGsDuplicateApis() {
  const codeGsPath = 'src/backend/Code.gs';
  if (!fs.existsSync(codeGsPath)) return;
  const content = fs.readFileSync(codeGsPath, 'utf8');
  
  const regex = /^function\s+(api[a-zA-Z0-9_]+)\s*\(/gm;
  let match;
  const apis = [];
  while ((match = regex.exec(content)) !== null) {
    apis.push(match[1]);
  }
  
  const duplicates = apis.filter((item, index) => apis.indexOf(item) !== index);
  if (duplicates.length > 0) {
    logError(`Code.gs 頂層 API 函式名稱重複：${[...new Set(duplicates)].join(', ')}`);
  } else {
    console.log('✓ Code.gs API names check passed.');
  }
}

function checkBannedPatterns() {
  const banned = [
    { pattern: 'LockService.runWithLock', desc: '不得呼召原生 LockService.runWithLock，應使用 LockServiceHelper.runWithLock' },
    { pattern: 'SetupService.bootstrapSystem', desc: '舊初始化 bootstrapSystem 應移除' },
    { pattern: 'apiBootstrapSystem', desc: '舊 API apiBootstrapSystem 應移除' },
    { pattern: '1AbC_doc_id_xyz', desc: '測試中不得出現假 Doc File ID placeholder' },
    { pattern: '1AbC_sheet_id_xyz', desc: '測試中不得出現假 Sheet File ID placeholder' },
    { pattern: '}).error', desc: '不得以 }).error 讀取鎖定回傳值，LockServiceHelper 已直回傳 fn 的執行結果' },
    { pattern: 'ss.saveAndClose()', desc: 'Spreadsheet 無 saveAndClose 方法，應使用 SpreadsheetApp.flush()' },
    { pattern: "expected: 'approved', actual: 'approved'", desc: 'TestRunner 中禁止使用寫死的 approved 驗證案例' },
    { pattern: 'Config.get(', desc: '禁止出現 Config.get(，應使用 Config.getSystemConfig(' },
    { pattern: 'SheetRepository.all(', desc: '禁止出現 SheetRepository.all(，應使用 SheetRepository.getAllRecords(' },
    { pattern: 'SheetRepository.deleteRecord(', desc: '禁止使用已刪除 the deleteRecord 方法' },
    { pattern: 'CLOSE_DUMMY', desc: '禁止出現 CLOSE_DUMMY' },
    { pattern: "approver_email: 'lunch@school.example'", desc: '禁止直接組 ApprovalRecords 假測試' }
  ];
  
  const searchInDir = (dir) => {
    fs.readdirSync(dir).forEach(file => {
      const fullPath = path.join(dir, file);
      if (fs.statSync(fullPath).isDirectory()) {
        searchInDir(fullPath);
      } else if (file.endsWith('.gs') || file.endsWith('.html') || file.endsWith('.sh') || file.endsWith('.json') || file.endsWith('.md')) {
        if (fullPath.includes('node_modules') || fullPath.includes('tools/')) return;
        const content = fs.readFileSync(fullPath, 'utf8');
        banned.forEach(b => {
          if (content.includes(b.pattern)) {
            logError(`檔案 ${fullPath} 含有禁用欄位或內容 "${b.pattern}" (${b.desc})`);
          }
        });
      }
    });
  };
  
  searchInDir('src');
  console.log('✓ Banned patterns check completed.');
}

function checkPlaceholderTests() {
  const testRunnerPath = 'src/backend/TestRunner.gs';
  if (!fs.existsSync(testRunnerPath)) return;
  const content = fs.readFileSync(testRunnerPath, 'utf8');
  
  if (content.includes("expected: 'success', actual: 'success'")) {
    logError('TestRunner.gs 含有未實作的假測試 (expected/actual placeholder)');
  }
  if (content.includes("name = '***'")) {
    logError("TestRunner.gs 中禁止手動 name = '***' 進行測試掩蓋，必須呼叫正式的 privacy masking 或 buildReportDataModel");
  }
  
  console.log('✓ Placeholder and handcoded masking tests check completed.');
}

function checkSetupServiceExports() {
  const setupPath = 'src/backend/SetupService.gs';
  if (!fs.existsSync(setupPath)) return;
  const content = fs.readFileSync(setupPath, 'utf8');
  
  const matches = [...content.matchAll(/return\s*\{([\s\S]*?)\}/g)];
  if (matches.length === 0) {
    logError('無法在 SetupService.gs 中找到 return 面板');
    return;
  }
  
  const lastMatch = matches[matches.length - 1];
  const exports = lastMatch[1].split(',').map(x => x.split(':')[0].trim());
  const required = ['initializeDatabaseForSs', 'getSystemStatus'];
  required.forEach(req => {
    if (!exports.includes(req)) {
      logError(`SetupService.gs 未匯出供 BootstrapService 呼叫的方法: ${req}`);
    }
  });
  console.log('✓ SetupService exports check passed.');
}

function checkReportTemplatesApprovedStatus() {
  const setupPath = 'src/backend/SetupService.gs';
  if (!fs.existsSync(setupPath)) return;
  const content = fs.readFileSync(setupPath, 'utf8');
  
  const regex = /'approved'\s*,\s*settings\.adminEmail\s*,\s*Utils\.formatDateTime/i;
  if (regex.test(content)) {
    logError('SetupService.gs 中預設範本狀態不得為 approved，必須為 draft');
  } else {
    console.log('✓ ReportTemplates status check passed.');
  }
}

function checkSubsidyRulesDecimals() {
  const setupPath = 'src/backend/SetupService.gs';
  if (!fs.existsSync(setupPath)) return;
  const content = fs.readFileSync(setupPath, 'utf8');
  
  if (content.includes("'0.50'") || content.includes("'1.00'") || content.includes("rate: 0.5") || content.includes("rate: 1.0")) {
    logError('SetupService.gs 中預設 percentage rate 必須為 0~10000 的 Basis Points 整數，不得為 0.50 或 1.00 小數');
  } else {
    console.log('✓ SubsidyRules rates check passed.');
  }
}

function checkReadmeDeploymentDescription() {
  const readmePath = 'README.md';
  if (!fs.existsSync(readmePath)) return;
  const content = fs.readFileSync(readmePath, 'utf8');
  if (content.includes('ANYONE') && content.includes('DOMAIN')) {
    logError('README.md 同時包含 ANYONE 與 DOMAIN 正式部署說明，這兩者是矛盾的（應以 DOMAIN 為主）');
  } else {
    console.log('✓ README deployment description check passed.');
  }
}

function checkPackageJsonLifecycleScript() {
  const packagePath = 'package.json';
  if (!fs.existsSync(packagePath)) return;
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const scripts = packageJson.scripts || {};
  
  if (scripts.install || scripts.postinstall || scripts.preinstall) {
    logError('package.json 不得定義 install 系列生命週期腳本');
  } else {
    console.log('✓ package.json lifecycle scripts check passed.');
  }

  if (!scripts['check:static']) {
    logError('package.json scripts 中必須存在 check:static 指令');
  } else {
    console.log('✓ package.json check:static script check passed.');
  }
}

function checkBootstrapDraftSet() {
  const bootstrapPath = 'src/backend/BootstrapService.gs';
  if (!fs.existsSync(bootstrapPath)) return;
  const content = fs.readFileSync(bootstrapPath, 'utf8');
  if (content.includes("setValue('draft')")) {
    logError("BootstrapService.gs 中禁止使用 tplSheet.getRange(...).setValue('draft') 批次改寫所有範本狀態。");
  } else {
    console.log('✓ BootstrapService draft setValue check passed.');
  }
}

function checkReportServiceRoles() {
  const reportPath = 'src/backend/ReportService.gs';
  if (!fs.existsSync(reportPath)) return;
  const content = fs.readFileSync(reportPath, 'utf8');
  const required = ['generatePreviewReport', 'generateOfficialReport', 'approveReport', 'rejectReport'];
  required.forEach(func => {
    const regex = new RegExp('function\\s+' + func + '\\s*\\([\\s\\S]*?\\)\\s*\\{[^}]*\\}');
    const matches = content.match(regex);
    // 使用簡單包含檢查，防止大括號嵌套匹配不全，我們直接搜尋 require 呼叫是否存在於該檔案中，且在函數定義區間中
    if (content.includes('function ' + func)) {
      const idx = content.indexOf('function ' + func);
      const sub = content.substring(idx, idx + 800);
      if (!sub.includes('AuthService.require') && !sub.includes('validateApprovalRoleForStage')) {
        logError(`ReportService.gs 中的函式 ${func} 缺少 AuthService 權限或角色驗證！`);
      }
    }
  });
  console.log('✓ ReportService functions roles validation check passed.');
}

function checkSubsidyRateMigrationExport() {
  const subsidyPath = 'src/backend/SubsidyRuleService.gs';
  if (!fs.existsSync(subsidyPath)) return;
  const content = fs.readFileSync(subsidyPath, 'utf8');
  if (content.includes('migrateSubsidyRatesToBasisPoints:')) {
    logError('SubsidyRuleService.gs 不得再匯出 migrateSubsidyRatesToBasisPoints 方法。');
  } else {
    console.log('✓ SubsidyRuleService migration export check passed.');
  }
}

function checkDeployShValidation() {
  const deployPath = 'deploy.sh';
  if (!fs.existsSync(deployPath)) return;
  const content = fs.readFileSync(deployPath, 'utf8');
  if (!content.includes('DEPLOYMENT_ID_NOT_FOUND')) {
    logError('deploy.sh 必須包含對 DEPLOY_ID 是否為空的校驗，且失敗時回報 DEPLOYMENT_ID_NOT_FOUND！');
  } else {
    console.log('✓ deploy.sh DEPLOY_ID check passed.');
  }
}

function checkRequireRoleArguments() {
  const searchInDir = (dir) => {
    fs.readdirSync(dir).forEach(file => {
      const fullPath = path.join(dir, file);
      if (fs.statSync(fullPath).isDirectory()) {
        searchInDir(fullPath);
      } else if (file.endsWith('.gs')) {
        const content = fs.readFileSync(fullPath, 'utf8');
        // requireRole 只能傳 1 個參數
        const regex = /requireRole\s*\([^)]*,[^)]*\)/;
        if (regex.test(content)) {
          logError(`檔案 ${fullPath} 中的 requireRole 傳入了多個參數！如果需要多角色請使用 requireAnyRole。`);
        }
      }
    });
  };
  searchInDir('src');
  console.log('✓ requireRole arguments check completed.');
}

function checkDeployShOrTrue() {
  const deployPath = 'deploy.sh';
  if (!fs.existsSync(deployPath)) return;
  const content = fs.readFileSync(deployPath, 'utf8');
  if (content.includes('|| true')) {
    logError('deploy.sh 中不得對 clasp 呼叫使用 || true，必須檢查 exit status 或使用 set -e 攔截錯誤。');
  } else {
    console.log('✓ deploy.sh || true check passed.');
  }
}

function checkServiceExportsAndCalls() {
  const gsFiles = {};
  const serviceExports = {};

  // 1. Read all .gs files
  const backendDir = 'src/backend';
  fs.readdirSync(backendDir).forEach(file => {
    if (file.endsWith('.gs')) {
      const content = fs.readFileSync(path.join(backendDir, file), 'utf8');
      gsFiles[file] = content;

      const serviceMatch = content.match(/var\s+(\w+)\s*=\s*\(function\s*\(\)\s*\{/);
      if (serviceMatch) {
        const serviceName = serviceMatch[1];
        const lastReturnIdx = content.lastIndexOf('return {');
        if (lastReturnIdx !== -1) {
          const returnBlock = content.substring(lastReturnIdx);
          const startBracket = returnBlock.indexOf('{');
          const endBracket = returnBlock.indexOf('}');
          if (startBracket !== -1 && endBracket !== -1) {
            const exportContent = returnBlock.substring(startBracket + 1, endBracket);
            const exportLines = exportContent.split(',');
            const exports = [];
            exportLines.forEach(line => {
              const parts = line.split(':');
              const expName = parts[0].trim();
              if (expName) {
                exports.push(expName);
              }
            });
            serviceExports[serviceName] = exports;
          }
        }
      }
    }
  });

  // 2. Scan all calls like ServiceName.methodName
  Object.keys(gsFiles).forEach(file => {
    const content = gsFiles[file];
    const matches = [...content.matchAll(/(\w+)\.(\w+)\s*\(/g)];
    matches.forEach(m => {
      const serviceName = m[1];
      const methodName = m[2];
      
      const excluded = ['SpreadsheetApp', 'DriveApp', 'Math', 'Date', 'DocumentApp', 'Utilities', 'ScriptApp', 'PropertiesService', 'CacheService', 'Session', 'Object', 'JSON', 'String', 'Number', 'Array', 'console', 'process', 'fs', 'path', 'e'];
      if (excluded.includes(serviceName)) return;

      if (serviceExports[serviceName]) {
        if (!serviceExports[serviceName].includes(methodName)) {
          logError(`檔案 ${file} 呼叫了 ${serviceName}.${methodName}()，但該 Service 未匯出此方法！`);
        }
      }
    });
  });
  console.log('✓ Service method calls and exports check passed.');
}

function checkFrontendNoDirectConfig() {
  const searchInDir = (dir) => {
    fs.readdirSync(dir).forEach(file => {
      const fullPath = path.join(dir, file);
      if (fs.statSync(fullPath).isDirectory()) {
        searchInDir(fullPath);
      } else if (file.endsWith('.html')) {
        const content = fs.readFileSync(fullPath, 'utf8');
        if (content.includes('Config.get(') || content.includes('Config.getSystemConfig(') || /<\?.*Config/.test(content)) {
          logError(`前端檔案 ${fullPath} 中禁止直接呼叫 Config service！請改用後端 API。`);
        }
      }
    });
  };
  searchInDir('src/frontend');
  console.log('✓ Frontend Config service calls check completed.');
}

function checkBannedIntegrityRules() {
  const searchInDir = (dir) => {
    fs.readdirSync(dir).forEach(file => {
      const fullPath = path.join(dir, file);
      if (fs.statSync(fullPath).isDirectory()) {
        searchInDir(fullPath);
      } else {
        const content = fs.readFileSync(fullPath, 'utf8');
        
        // 1. getFilesByName with *
        if (/getFilesByName\([^)]*\*/.test(content)) {
          logError(`檔案 ${fullPath} 中的 getFilesByName 呼叫含有 * 萬用字元！`);
        }
        
        // 2. innerHTML + err.message in frontend
        if (file.endsWith('.html')) {
          const lines = content.split('\n');
          lines.forEach((line, idx) => {
            if (line.includes('innerHTML') && line.includes('err.message')) {
              if (!line.includes('escapeHtml(')) {
                logError(`前端檔案 ${fullPath} 第 ${idx + 1} 行之 innerHTML 呼叫含有未跳脫之 err.message！`);
              }
            }
          });
        }

        // 3. parseFloat(l.meal_price_snapshot
        if (content.includes('parseFloat(l.meal_price_snapshot')) {
          logError(`檔案 ${fullPath} 含有 parseFloat(l.meal_price_snapshot)！`);
        }
        
        // 4. MOCK_FILE_ in backend
        if (fullPath.includes('src/backend') && content.includes('MOCK_FILE_')) {
          logError(`後端檔案 ${fullPath} 含有 MOCK_FILE_！`);
        }

        // 5. DUMMY_FILE_ in TestRunner
        if (fullPath.includes('TestRunner.gs') && content.includes('DUMMY_FILE_')) {
          logError(`TestRunner.gs 含有 DUMMY_FILE_！`);
        }
      }
    });
  };
  searchInDir('src');
  console.log('✓ Banned integrity rules check completed.');
}

function checkReportServiceNoYuanToMinor() {
  const reportPath = 'src/backend/ReportService.gs';
  if (!fs.existsSync(reportPath)) return;
  const content = fs.readFileSync(reportPath, 'utf8');
  if (content.includes('MoneyService.yuanToMinor(')) {
    logError('ReportService.gs 中禁止呼召寬鬆的 MoneyService.yuanToMinor()！必須改用 MoneyService.yuanToMinorStrict()。');
  } else {
    console.log('✓ ReportService no yuanToMinor check passed.');
  }
}

function checkNoMinorLogicalOr() {
  const searchInDir = (dir) => {
    fs.readdirSync(dir).forEach(file => {
      const fullPath = path.join(dir, file);
      if (fs.statSync(fullPath).isDirectory()) {
        searchInDir(fullPath);
      } else if (file.endsWith('.gs')) {
        if (fullPath.includes('node_modules') || fullPath.includes('tools/')) return;
        const content = fs.readFileSync(fullPath, 'utf8');
        const bannedKeys = [
          'settlement_amount_minor',
          'final_amount_minor',
          'settlement_total_minor',
          'gross_amount_minor',
          'residual_adjustment_minor'
        ];
        bannedKeys.forEach(key => {
          const regexStr = key + '\\s*\\|\\|';
          const regex = new RegExp(regexStr, 'g');
          if (regex.test(content)) {
            logError(`檔案 ${fullPath} 含有財務欄位 "${key}" 邏輯或 (||) 串接，應使用 firstPresentValue 處理。`);
          }
        });
      }
    });
  };
  searchInDir('src');
  console.log('✓ No minor logical OR check completed.');
}

function checkParseMinorStrictAllowNegative() {
  const moneyPath = 'src/backend/MoneyService.gs';
  if (!fs.existsSync(moneyPath)) return;
  const content = fs.readFileSync(moneyPath, 'utf8');
  if (!content.includes('allowNegative')) {
    logError('MoneyService.gs 中的 parseMinorStrict 必須支援 options.allowNegative 參數與規格！');
  } else {
    console.log('✓ parseMinorStrict allowNegative check passed.');
  }
}

function checkYuanToMinorStrictDecimals() {
  const moneyPath = 'src/backend/MoneyService.gs';
  if (!fs.existsSync(moneyPath)) return;
  const content = fs.readFileSync(moneyPath, 'utf8');
  if (!content.includes('yuanToMinorStrict') || !content.includes('MONEY_INVALID_DECIMAL')) {
    logError('MoneyService.gs 中的 yuanToMinorStrict 必須進行標準十進位驗證，並回傳 MONEY_INVALID_DECIMAL 錯誤碼！');
  } else {
    console.log('✓ yuanToMinorStrict decimal verification check passed.');
  }
}

function checkDeployScriptCreationCommands() {
  const deployPath = 'deploy.sh';
  if (!fs.existsSync(deployPath)) return;
  const content = fs.readFileSync(deployPath, 'utf8');
  if (!content.includes('create-script')) {
    logError('deploy.sh 必須使用 clasp create-script 命令！');
  }
  if (content.includes('clasp create --type webapp') || content.includes('create --type webapp')) {
    logError('deploy.sh 中不得呼叫 clasp create --type webapp！');
  }
  if (!content.includes('--type standalone')) {
    logError('deploy.sh 中自動建立專案必須使用 --type standalone 參數！');
  }
  if (content.includes('clasp status')) {
    logError('deploy.sh 中不得使用 clasp status 進行登入驗證，必須使用 show-authorized-user --json！');
  }
  console.log('✓ deploy.sh script creation commands check completed.');
}

function checkTestRunnerFixtureIdUniqueness() {
  const runnerPath = 'src/backend/TestRunner.gs';
  if (!fs.existsSync(runnerPath)) return;
  const content = fs.readFileSync(runnerPath, 'utf8');
  const bannedIds = ['CLOSE_TEST_T13', 'TMP_TEST_T13', 'ART_T13_L', 'CLOSE_TEST_T14', 'TMP_TEST_T14', 'ART_T14_L', 'CLOSE_TEST_T18', 'TMP_TEST_T18', 'ART_T18_L'];
  bannedIds.forEach(id => {
    if (content.includes(`'${id}'`) || content.includes(`"${id}"`)) {
      logError(`TestRunner.gs 不得使用寫死的固定 ID "${id}"，必須包含唯一 testRunId！`);
    }
  });
  console.log('✓ TestRunner fixture ID uniqueness check completed.');
}

function checkReportCommitHash() {
  const reportPath = 'docs/verification/pre-uat-fix-report.md';
  if (!fs.existsSync(reportPath)) return;
  const content = fs.readFileSync(reportPath, 'utf8');
  const match = content.match(/\*\*修正後 Commit\*\*:\s*`([a-f0-9]+)`/i);
  if (!match) {
    logError('無法在 pre-uat-fix-report.md 中找到「修正後 Commit」！');
    return;
  }
  const reportCommit = match[1];
  
  let latestProgramCommit = '';
  try {
    latestProgramCommit = execSync('git log -1 --format=%H -- src tools deploy.sh .github/workflows package.json package-lock.json appsscript.json').toString().trim();
  } catch (e) {
    logError('無法取得最新程式 Commit Hash！');
    return;
  }
  
  const statusOut = execSync('git status --porcelain').toString();
  const hasProgramChanges = statusOut.split('\n').some(line => {
    const file = line.substring(3);
    return file.startsWith('src/') || 
           file.startsWith('tools/') || 
           file === 'deploy.sh' ||
           file.startsWith('.github/workflows/') ||
           file === 'package.json' ||
           file === 'package-lock.json' ||
           file === 'appsscript.json';
  });
  
  if (!hasProgramChanges && reportCommit !== latestProgramCommit) {
    logError(`驗證報告中的修正後 Commit (${reportCommit}) 與最新程式 Commit (${latestProgramCommit}) 不符！`);
  } else {
    console.log(`✓ pre-uat-fix-report.md commit hash check passed (${reportCommit}).`);
  }
}

checkCodeGsDuplicateApis();
checkBannedPatterns();
checkPlaceholderTests();
checkSetupServiceExports();
checkReportTemplatesApprovedStatus();
checkSubsidyRulesDecimals();
checkReadmeDeploymentDescription();
checkPackageJsonLifecycleScript();
checkBootstrapDraftSet();
checkReportServiceRoles();
checkSubsidyRateMigrationExport();
checkDeployShValidation();
checkRequireRoleArguments();
checkDeployShOrTrue();
checkServiceExportsAndCalls();
checkFrontendNoDirectConfig();
checkBannedIntegrityRules();

checkReportServiceNoYuanToMinor();
checkNoMinorLogicalOr();
checkParseMinorStrictAllowNegative();
checkYuanToMinorStrictDecimals();
checkDeployScriptCreationCommands();
checkTestRunnerFixtureIdUniqueness();
checkReportCommitHash();

if (errorsCount > 0) {
  console.error(`\n🛑 靜態完整性檢查失敗！共發現 ${errorsCount} 個錯誤。`);
  process.exit(1);
} else {
  console.log('\n🎉 所有靜態完整性檢查通過！');
  process.exit(0);
}
