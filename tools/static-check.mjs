// tools/static-check.mjs
import fs from 'fs';
import path from 'path';

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
    { pattern: 'LockService.runWithLock', desc: '不得呼叫原生 LockService.runWithLock，應使用 LockServiceHelper.runWithLock' },
    { pattern: 'SetupService.bootstrapSystem', desc: '舊初始化 bootstrapSystem 應移除' },
    { pattern: 'apiBootstrapSystem', desc: '舊 API apiBootstrapSystem 應移除' },
    { pattern: '1AbC_doc_id_xyz', desc: '測試中不得出現假 Doc File ID placeholder' },
    { pattern: '1AbC_sheet_id_xyz', desc: '測試中不得出現假 Sheet File ID placeholder' },
    { pattern: '}).error', desc: '不得以 }).error 讀取鎖定回傳值，LockServiceHelper 已直回傳 fn 的執行結果' },
    { pattern: 'ss.saveAndClose()', desc: 'Spreadsheet 無 saveAndClose 方法，應使用 SpreadsheetApp.flush()' },
    { pattern: "expected: 'approved', actual: 'approved'", desc: 'TestRunner 中禁止使用寫死的 approved 驗證案例' }
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
  } else {
    console.log('✓ Placeholder tests check passed.');
  }
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
      if (!sub.includes('AuthService.require')) {
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

if (errorsCount > 0) {
  console.error(`\n🛑 靜態完整性檢查失敗！共發現 ${errorsCount} 個錯誤。`);
  process.exit(1);
} else {
  console.log('\n🎉 所有靜態完整性檢查通過！');
  process.exit(0);
}
