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
    { pattern: '1AbC_sheet_id_xyz', desc: '測試中不得出現假 Sheet File ID placeholder' }
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

checkCodeGsDuplicateApis();
checkBannedPatterns();
checkPlaceholderTests();
checkSetupServiceExports();
checkReportTemplatesApprovedStatus();
checkSubsidyRulesDecimals();
checkReadmeDeploymentDescription();
checkPackageJsonLifecycleScript();

if (errorsCount > 0) {
  console.error(`\n🛑 靜態完整性檢查失敗！共發現 ${errorsCount} 個錯誤。`);
  process.exit(1);
} else {
  console.log('\n🎉 所有靜態完整性檢查通過！');
  process.exit(0);
}
