# Pre-UAT 阻斷問題修正報告 (pre-uat-fix-report.md)

## 1. 修正前與修正後 Commit
* **修正前 Commit**: `13f4ca7a1a36230101eb300281c62393faedc9c1`
* **修正後 Commit**: `fd7edbb4fcc544e7fe740336db5b8db52248f77b`

---

## 2. 修改檔案清單
* **CI 設定與安裝**：
  * [package.json](file:///Users/albertpeng/Documents/秘書群工作空間/水月工作區/cli專案/GAS_school_lunch_management_system/package.json) (新增 `check:static` 指令)
  * [.github/workflows/ci.yml](file:///Users/albertpeng/Documents/秘書群工作空間/水月工作區/cli專案/GAS_school_lunch_management_system/.github/workflows/ci.yml) (CI 整合靜態分析與 dry-run 步驟)
  * [tools/static-check.mjs](file:///Users/albertpeng/Documents/秘書群工作空間/水月工作區/cli專案/GAS_school_lunch_management_system/tools/static-check.mjs) (新增靜態檢查工具)
* **部署與規格政策**：
  * [deploy.sh](file:///Users/albertpeng/Documents/秘書群工作空間/水月工作區/cli專案/GAS_school_lunch_management_system/deploy.sh) (修正版本號解析、redeploy 防護、URL 精準匹配、原子化檔案寫入)
  * [README.md](file:///Users/albertpeng/Documents/秘書群工作空間/水月工作區/cli專案/GAS_school_lunch_management_system/README.md) (刪除舊式手動部署、統一網域 access 說明、更新狀態進度)
  * [SECURITY.md](file:///Users/albertpeng/Documents/秘書群工作空間/水月工作區/cli專案/GAS_school_lunch_management_system/SECURITY.md) (使用 GitHub Private Vulnerability Reporting，防範 Placeholder 通報)
* **後端服務模組**：
  * [src/backend/SetupService.gs](file:///Users/albertpeng/Documents/秘書群工作空間/水月工作區/cli專案/GAS_school_lunch_management_system/src/backend/SetupService.gs) (匯出 `initializeDatabaseForSs`、移除舊版雙軌 `bootstrapSystem`、實現初始化等冪防破壞寫入)
  * [src/backend/BootstrapService.gs](file:///Users/albertpeng/Documents/秘書群工作空間/水月工作區/cli專案/GAS_school_lunch_management_system/src/backend/BootstrapService.gs) (補強 `CREATE_SYSTEM_ADMIN` 與 `RUN_HEALTH_CHECK` 真實行為、步驟順序防護、環境一致性檢查)
  * [src/backend/SubsidyRuleService.gs](file:///Users/albertpeng/Documents/秘書群工作空間/水月工作區/cli專案/GAS_school_lunch_management_system/src/backend/SubsidyRuleService.gs) (整合 BPS 費率寫入與修改驗證、補足 Migration Meta 記錄)
  * [src/backend/ReportService.gs](file:///Users/albertpeng/Documents/秘書群工作空間/水月工作區/cli專案/GAS_school_lunch_management_system/src/backend/ReportService.gs) (建立 HTML/Docs/Sheets 三分流渲染器、金額彙整平衡檢驗與 BOM CSV 解析)
  * [src/backend/Code.gs](file:///Users/albertpeng/Documents/秘書群工作空間/水月工作區/cli專案/GAS_school_lunch_management_system/src/backend/Code.gs) (拆分重複的 `apiValidateClosing` 頂層函式、移除重複的 Trigger APIs)
  * [src/backend/TestRunner.gs](file:///Users/albertpeng/Documents/秘書群工作空間/水月工作區/cli專案/GAS_school_lunch_management_system/src/backend/TestRunner.gs) (重構 TestRunner，將假測試修改為 skipped，留下 19 項真實測試)
  * 修正 `LockServiceHelper` 命名（共 9 個服務檔案已全部修正）
* **前端 View 模板與 Script**：
  * [src/frontend/MonthClosing.html](file:///Users/albertpeng/Documents/秘書群工作空間/水月工作區/cli專案/GAS_school_lunch_management_system/src/frontend/MonthClosing.html) (對接新 API)
  * [src/frontend/FundingCalculation.html](file:///Users/albertpeng/Documents/秘書群工作空間/水月工作區/cli專案/GAS_school_lunch_management_system/src/frontend/FundingCalculation.html) (對接新 API)
  * [src/frontend/Scripts.html](file:///Users/albertpeng/Documents/秘書群工作空間/水月工作區/cli專案/GAS_school_lunch_management_system/src/frontend/Scripts.html) (對接新 API、費率以百分比呈現)

---

## 3. 各項修正具體結果

### 3.1 initializeDatabaseForSs export 結果
`SetupService.gs` 已將 `initializeDatabaseForSs` 正常匯出，且移除了舊版 `bootstrapSystem`。靜態測試 `typeof SetupService.initializeDatabaseForSs === 'function'` 通過。

### 3.2 舊 bootstrapSystem 移除結果
全專案搜尋 `bootstrapSystem` 及 `apiBootstrapSystem` 其結果均為 0。已全數改為呼叫新版 `BootstrapService` 狀態機，確保只有一套初始化流程。

### 3.3 LockService 修正結果
已將所有 `LockService.runWithLock` 全數修正為自訂之 `LockServiceHelper.runWithLock`。後端檢索結果為 0。原生 `LockService.getScriptLock` 則正常保留於狀態機中。

### 3.4 Basis Points 統一結果
- SetupService 預設規則之費率已由 `'0.50'` / `'1.00'` 改為 `'5000'` / `'10000'`。
- `SystemConfig` 已預設寫入 `RATE_STORAGE_FORMAT = BASIS_POINTS`，並廢除 `SUBSIDY_RATE_LEGACY_FORMAT`。
- `SubsidyRuleService.createSubsidyRule()` 及 `updateSubsidyRule()` 會執行 `parseInt` 並呼叫 `validateRateBasisPoints` 強制限制在 0～10000 內。
- 前端 `Scripts.html` 預覽費率時會自動將 5000 轉換為 50% 呈現。
- 遷移完成後，將寫入 `RATE_STORAGE_FORMAT = BASIS_POINTS`、`SUBSIDY_RATE_MIGRATED_AT`、`SUBSIDY_RATE_MIGRATED_BY`、`SUBSIDY_RATE_MIGRATION_ID` 等設定。

### 3.5 API 重複修正結果
`Code.gs` 中重複的 `apiValidateClosing` 拆分為：
* `apiValidateMonthlyClosingReadiness(yearMonth)` (供對帳就緒性檢驗使用)
* `apiValidateClosingRecord(closingId)` (供核可草稿使用)
所有前端（`MonthClosing.html`, `FundingCalculation.html`, `Scripts.html`）皆已同步更新對接。同時在 `tools/static-check.mjs` 中加入了重複頂層 API 函式名稱的禁止檢查。

### 3.6 Bootstrap 真實行為補強
- `CREATE_SYSTEM_ADMIN`：依據登入 Email 檢查 Users，不存在時才建立管理員帳戶並寫入 `AuditLogs`。
- `RUN_HEALTH_CHECK`：真正呼叫 `SetupService.getSystemStatus` 檢查 29 張工作表及時區設定。若不符，狀態設為 `FAILED` 並拋錯。
- `COMPLETE`：必須等 `RUN_HEALTH_CHECK` 通過後方可被執行。
- 加入了 `BOOTSTRAP_STEP_MISMATCH` 順序防護及 `BOOTSTRAP_ENV_MISMATCH` 環境防護。 UAT 與 PRODUCTION 環境一旦確認不可變更。PRODUCTION 下絕不建立測試資源。

### 3.7 TestRunner 真實測試數量與 skipped 清單
- 將原 105 項大量 placeholder 測試移除了，只留下 **19 項真實測試**。
- `T13` (Docs) 與 `T14` (Sheets) 自動檢測 `TEST_TEMPLATE_DOC_ID` / `TEST_TEMPLATE_SHEET_ID` 是否設定。若未設定或為假 ID，則自動將測試狀態標記為 `skipped`，不再假裝 passed，並在測試報告中明列 `skipped_reason`。
- 其他測試分類包含 `UNIT`, `INTEGRATION`, `PERFORMANCE`, `AUTH`。

### 3.8 HTML / Docs / Sheets Renderer 實作狀態
`ReportService.gs` 中實現了 `renderReportByFormat` 分流渲染：
- **HTML Renderer**：採用 UTF-8 輸出並對所有動態資料呼叫 `escapeHtml` 以防注入。Temp HTML 檔案在轉換後會呼叫 `setTrashed(true)` 進行清理。
- **Docs/Sheets Renderer**：確認 `template_file_id` 合法性，否則拋出 `TEMPLATE_FILE_NOT_FOUND`。複製範本後，替換 placeholders、寫入儲存格並匯出 PDF，最後以 `setTrashed(true)` 清理。
- 預覽模式下使用臨時 fall-back draft 範本，絕不自動建立並 approved 範本。

### 3.9 報表金額平衡驗證
在 `buildReportDataModel` 階段累加 5 種來源（`township`, `county`, `school`, `self_pay`, `other`），驗證是否等於 `gross_amount`。若不平衡，拋出 `REPORT_FUNDING_TOTAL_NOT_BALANCED`，強制阻斷正式報表產出。

### 3.10 deploy.sh 安全修正
- 無法解析版本時立即停止，回報 `VERSION_CREATION_FAILED`。
- 更新既有部署更新失敗時，回報 `DEPLOYMENT_UPDATE_FAILED` 並停止，保留原 ID。
- `clasp deployments` 會根據 `DEPLOY_ID` 進行 Web App URL 匹配，防範誤用。
- 寫入 `uat.json` 或 `production.json` 時，先寫入暫存檔再 `mv` 覆蓋。

### 3.11 README 與 SECURITY.md 修正
- **README.md**：更新了 GitHub 專案連結、DOMAIN Scoping 說明，移除了舊式手動說明，進度更新為 Phase 6.5 Pre-UAT 修正中，專案狀態改為 Alpha / Pre-UAT。
- **SECURITY.md**：通報政策改為 GitHub Private Vulnerability Reporting，防範 placeholder 內容。

### 3.12 靜態檢查與 dry-run 驗收結果
* `npm run check:static`：**PASSED**（包含 8 項指標檢查，確保程式碼結構完整）
* `bash -n deploy.sh`：**PASSED**
* `npm run deploy:dry-run`：**PASSED**
* **Pull Request URL**: https://github.com/mihozip/gas-school-lunch-management-system/pull/1
* **PRE_UAT_FIX_STATUS**: `PASSED`
* **說明**：上述阻斷性問題已全數修復完畢，且靜態完整性檢查與部署 dry-run 均順利通過！
