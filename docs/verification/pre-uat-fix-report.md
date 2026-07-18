# Pre-UAT 阻斷問題修正報告 (pre-uat-fix-report.md)

## 1. 修正前與修正後 Commit
* **修正前 Commit**: `13f4ca7a1a36230101eb300281c62393faedc9c1`
* **修正後 Commit**: `428ca68ca7514deb190aa4d48ae7b148b0b095c1`

---

## 2. 修改檔案清單
* **CI 設定與安裝**：
  * [package.json](../../package.json) (新增 `check:static` 指令)
  * [.github/workflows/ci.yml](../../.github/workflows/ci.yml) (CI 整合靜態分析與 dry-run 步驟)
  * [tools/static-check.mjs](../../tools/static-check.mjs) (新增靜態檢查工具，擴充 19 項與額外禁止規則)
* **部署與規格政策**：
  * [deploy.sh](../../deploy.sh) (新增 CREATE_IF_MISSING / FORCE_PUSH 控制、DEPLOY_ID 驗證、exit code 檢查、URL 格式匹配)
  * [README.md](../../README.md) (刪除舊式手動部署、統一網域 access 說明、更新狀態進度)
  * [SECURITY.md](../../SECURITY.md) (使用 GitHub Private Vulnerability Reporting，防範 Placeholder 通報)
* **後端服務模組**：
  * [src/backend/SetupService.gs](../../src/backend/SetupService.gs) (ENVIRONMENT 動態化、SubsidyRules 預設 enabled=false、Config.clearAllCache)
  * [src/backend/BootstrapService.gs](../../src/backend/BootstrapService.gs) (CREATE_DEFAULT_TEMPLATES 等冪化、TEST 環境獨立設定、環境參數傳遞)
  * [src/backend/SubsidyRuleService.gs](../../src/backend/SubsidyRuleService.gs) (Number 取起、驗證提前至轉換前、migrateSubsidyRatesToBasisPoints 移除)
  * [src/backend/ReportService.gs](../../src/backend/ReportService.gs) (Docs regex escape、移除 escapeHtml、Sheets flush 取代 saveAndClose、CSV 錯誤阻斷、安全清理 try-finally、嚴格四方金額驗證、避免 parseFloat 以 MoneyService 轉換、角色權限 5 函式、getApplicableTemplate 日期與版本排序、manifest setTrashed、增加會簽核章 AuditLog 記錄)
  * [src/backend/MonthClosingService.gs](../../src/backend/MonthClosingService.gs) (移除全部 4 處 }).error)
  * [src/backend/MealSuspensionService.gs](../../src/backend/MealSuspensionService.gs)
  * [src/backend/FundingCalculationService.gs](../../src/backend/FundingCalculationService.gs)
  * [src/backend/MonthlyReconciliationService.gs](../../src/backend/MonthlyReconciliationService.gs)
  * [src/backend/MealExceptionService.gs](../../src/backend/MealExceptionService.gs)
  * [src/backend/DailyMealCalculationService.gs](../../src/backend/DailyMealCalculationService.gs)
  * [src/backend/SchoolDaysService.gs](../../src/backend/SchoolDaysService.gs)
  * [src/backend/Code.gs](../../src/backend/Code.gs) (移除重複 Trigger API、新增 apiGetMealEntryConfig 參數校驗)
  * [src/backend/TestRunner.gs](../../src/backend/TestRunner.gs) (T13-T19 全面重構，Drive 測試環境與 UAT 資料夾之安全防護隔離、使用 UUID 真實 CSV、暫存檔清理與負向驗證、T17 簡化、T18 金額不一致驗證)
  * [src/backend/SheetRepository.gs](../../src/backend/SheetRepository.gs) (新增 deleteRecordById 以實現軟刪除與硬刪除切換)
  * [src/backend/MoneyService.gs](../../src/backend/MoneyService.gs) (修正 Config 呼叫)
  * [src/backend/TriggerService.gs](../../src/backend/TriggerService.gs)
  * [src/backend/ImportService.gs](../../src/backend/ImportService.gs)
* **前端 View 模板與 Script**：
  * [src/frontend/MonthClosing.html](../../src/frontend/MonthClosing.html) (對接新 API)
  * [src/frontend/FundingCalculation.html](../../src/frontend/FundingCalculation.html) (對接新 API)
  * [src/frontend/Scripts.html](../../src/frontend/Scripts.html) (對接新 API、費率以百分比呈現)
  * [src/frontend/DailyMealEntry.html](../../src/frontend/DailyMealEntry.html) (對接新 API、費率配置、XSS 跳脫 error 訊息)
  * [src/frontend/DailyLedgerViewer.html](../../src/frontend/DailyLedgerViewer.html) (XSS 跳脫 error 訊息)
  * [src/frontend/ClosingHistory.html](../../src/frontend/ClosingHistory.html) (XSS 跳脫 error 訊息)
  * [src/frontend/FundingAllocationDetail.html](../../src/frontend/FundingAllocationDetail.html) (XSS 跳脫 error 訊息)
  * [src/frontend/MonthlyFundingSummary.html](../../src/frontend/MonthlyFundingSummary.html) (XSS 跳脫 error 訊息)
  * [src/frontend/SetupWizard.html](../../src/frontend/SetupWizard.html) (XSS 跳脫 error 訊息)

---

## 3. 各項修正具體結果

### 3.1 LockServiceHelper 回傳值 (Item 一)
全專案 `}).error` 已全數清除。共修改 16 處：
- MealSuspensionService.gs (1)
- FundingCalculationService.gs (1)
- MonthlyReconciliationService.gs (1)
- MealExceptionService.gs (3)
- DailyMealCalculationService.gs (2)
- SchoolDaysService.gs (4)
- MonthClosingService.gs (4)
- SubsidyRuleService.gs (1, migrateSubsidyRatesToBasisPoints 完全移除)
- `grep -RInE '\}\)\.error' src/backend` 結果為 0

### 3.2 Bootstrap 範本治理 (Item 二)
- `BootstrapService.gs` 的 `CREATE_DEFAULT_TEMPLATES` 步驟不再批次 `setValue('draft')` 覆寫所有範本狀態。
- 改為等冪建立：只新增缺失的 3 個預設範本為 `draft`，已存在的範本一律不修改。
- `tools/static-check.mjs` 新增 `checkBootstrapDraftSet` 檢驗。

### 3.3 初始化環境與預設規則 (Item 三)
- `SetupService.initializeDatabaseForSs` 的 `ENVIRONMENT` 值改為動態讀取 `settings.environment || 'UAT'`。
- `BootstrapService` 對主資料庫傳入 `settings.environment = env`。
- 測試資料庫傳入獨立的 `testSettings.environment = 'TEST'`（使用 JSON 深拷貝）。
- `SubsidyRules` 預設規則的 `enabled` 全部改為 `false`。
- `initializeDatabaseForSs` 結尾加入 `Config.clearAllCache()` 防止快取舊值。

### 3.4 補助率驗證與遷移 (Item 四)
- `validateRateBasisPoints` 改用 `Number(rateBps)` 搭配 `Number.isFinite` 與 `Number.isInteger` 嚴格驗證。
- `createSubsidyRule` 與 `updateSubsidyRule` 改用 `Number()` 取代 `parseInt`。
- 驗證提前至 Number 轉換前，以 raw 值進行 validateRateBasisPoints。
- `migrateSubsidyRatesToBasisPoints` 函式與 export 已完全移除。

### 3.5 Google Docs Renderer (Item 五)
- `replaceText` 第一參數改為 regex escape 格式 (`\\{\\{SCHOOL_NAME\\}\\}`)。
- 移除 Docs 純文字中不必要的 `escapeHtml` 處理。
- `DriveApp.getFileById` 與 `DocumentApp.openById` 包裹於 try/catch，錯誤時統一拋出 `TEMPLATE_FILE_NOT_FOUND`。
- 失敗時自動清理暫存副本 (`copyFile.setTrashed(true)`)。

### 3.6 Google Sheets Renderer (Item 六)
- 移除無效的 `ss.saveAndClose()`，改為 `SpreadsheetApp.flush()`。
- 新增 DriveApp / SpreadsheetApp try/catch 防護，拋出 `TEMPLATE_FILE_NOT_FOUND`。
- 工作表存在性檢查。
- 預覽模式新增浮水印標記 (`⚠️ 預覽文件 — 非正式申請資料`)。
- 產出 PDF 後以 `setTrashed(true)` 清除暫存 Spreadsheet。

### 3.7 報表快照與金額彙總 (Item 七)
- `loadCsvFromDrive` 在正式報表流程中不再靜默返回空陣列。新增 `{ isReport: true }` 選項，失敗時拋出：
  - `CLOSING_ARTIFACT_MISSING`（fileId 為空）
  - `CLOSING_ARTIFACT_UNREADABLE`（檔案讀取失敗）
  - `CLOSING_ARTIFACT_INVALID_CSV`（內容為空或格式不合規）
- 金額彙總優先讀取 `settlement_total_minor`，無此欄位才 fallback 至 `final_amount_minor`。
- `getApplicableTemplate` 新增日期起訖過濾、多筆時以版本最高或生效日最新排序。
- 舊 `report_manifest.json` 改用 `setTrashed(true)` 清理（取代已棄用的 `removeFile`）。

### 3.8 報表角色權限 (Item 八)
在後端 Service 層新增 `AuthService.requireRole` 與 `AuthService.requireAnyRole` 檢查，嚴格遵循權限矩陣：
- `generatePreviewReport`：限 `system_admin`, `lunch_admin`, `accountant`
- `generateOfficialReport`：限 `system_admin`, `lunch_admin` (不包含 accountant)
- `approveReport`：`lunch_admin_checked` 限 `lunch_admin` 或 `system_admin`；`accountant_checked` 限 `accountant` 或 `system_admin`；`principal_approved` 限 `system_admin`
- `rejectReport`：同上限制
- `listApprovalRecords`：限 `system_admin`, `lunch_admin`, `accountant`

`viewer` 與 `class_teacher` 已被完整封鎖於所有報表核准與生成操作。

### 3.9 TestRunner 修正 (Item 九)
- **環境隔離防護**：`Config.setTestMode(true)` 時，`getReportRootFolderId()` 拋出 `TEST_REPORT_FOLDER_NOT_CONFIGURED` 若未設定，不 fallback 至正式資料夾；且測試執行前後比對 `REPORT_ROOT_FOLDER_ID` 資料夾之檔案總數，保證測試期產生之檔案完全在 `TEST_REPORT_FOLDER_ID`，不污染正式/UAT 目錄。
- **真實 CSV 隔離測試**：T13、T14 與 T18 廢除 `MOCK_FILE_` 假檔案模擬。測試時會於 `TEST_REPORT_FOLDER_ID` 動態產生帶有 UUID 檔名之真實 CSV，且 CSV 包含合法欄位 Header，測試結束後自動以 `setTrashed(true)` 進行清理。
- **暫存檔清理與負向驗證**：比對 Renderer 執行前後 `TEST_REPORT_FOLDER_ID` 之暫存檔案清單，確保無新暫存檔洩漏；並實作負向驗證 helper，手動建立假暫存檔，確認清理檢查能正確回傳 `false`。
- **T17 簡化**：簡化 T17 以驗證 `draft` 範本禁止用於產生正式報表（拋出 `DRAFT_TEMPLATE_NOT_ALLOWED`），移除了無謂的 `ClosingArtifacts` 與 `DUMMY_FILE_ID_T17`。
- **T18 隱私去識別化與金額不一致驗證**：驗證 `PUBLIC_SUMMARY` 遮罩姓名為 `***`；並透過修改月彙總金額至 5999 進行負向測試，成功拋出 `REPORT_SUMMARY_TOTAL_MISMATCH`，實作了嚴格的四方金額平衡校驗。

### 3.10 deploy.sh 修正 (Item 十)
- 所有 clasp 指令外部調用均採用 `if ! OUTPUT=$(npx clasp ...); then exit 1; fi` 的安全攔截，並拋出對應的 `[PUSH_FAILED]`、`[VERSION_CREATION_FAILED]` 等錯誤代碼。
- `DEPLOYMENT_ID_NOT_FOUND` 的安全驗證。
- Web App URL 必須完美符合 macros/s 格式，否則直接 exit 1。

### 3.11 靜態檢查擴充 (Item 十一)
`tools/static-check.mjs` 新增 16 條進階規則：
- `Config.get(` 禁用。
- `SheetRepository.all(` 禁用。
- `SheetRepository.deleteRecord(` 禁用。
- `requireRole` 傳入兩個以上參數禁用。
- 檢查 Service method 呼叫與 exports 的一致性。
- `CLOSE_DUMMY` 禁用。
- 禁止手動 `name = '***'` 測試案例。
- 禁止直接組 `ApprovalRecords` 假測試。
- `deploy.sh` 禁用 `|| true`。
- `package.json` 必須具備 `check:static` 指令。
- 禁用後端 `MOCK_FILE_` 模擬機制。
- 禁用 TestRunner `DUMMY_FILE_` 假變數。
- 禁用 `getFilesByName` 參數包含 `*` 萬用字元。
- 禁用前端 `innerHTML` 未跳脫拼接 `err.message`。
- 禁用直接 `parseFloat(l.meal_price_snapshot)`（應以 MoneyService 處理）。

### 3.12 點餐設定嚴格校驗與 XSS 跳脫 (新增項目)
- **設定嚴格校驗**：`apiGetMealEntryConfig()` 校驗 `DAILY_CONFIRM_DEADLINE` 符合 `HH:mm` 格式，`RETROACTIVE_EDIT_DAYS` 為非負有限整數，`ALLOW_RETROACTIVE_EDIT` 與 `ALLOW_SAME_DAY_ADMIN_OVERRIDE` 為嚴格布林值/字串，違規時拋出 `CONFIG_INVALID_DEADLINE`、`CONFIG_INVALID_RETROACTIVE_DAYS`、`CONFIG_INVALID_BOOLEAN`。
- **前端 XSS 安全跳脫**：將所有前端的 error message innerHTML 拼接改以 `escapeHtml` 處理以防止 XSS 攻擊。

---

## 4. 驗收結果
* `npm run check:static`：**PASSED**（所有靜態分析與 Service exports 匹配均完美通過）
* `bash -n deploy.sh`：**PASSED**
* `npm run deploy:dry-run`：**PASSED**
* `grep -RInE '\}\)\.error' src/backend`：**0 matches**
* `grep -RIn "MOCK_FILE_" src/backend`：**0 matches**
* `grep -RIn "DUMMY_FILE_" src/backend/TestRunner.gs`：**0 matches**
* `grep -RIn "getFilesByName(.*\\*" src`：**0 matches**
* `grep -RIn "innerHTML.*err.message" src/frontend`：**0 matches**
* `grep -RIn "parseFloat(l.meal_price_snapshot" src`：**0 matches**
* **Pull Request URL**: https://github.com/mihozip/gas-school-lunch-management-system/pull/1
* **PRE_UAT_FIX_STATUS**: `PARTIAL`
* **說明**：
  - 靜態檢查通過
  - deploy dry-run 通過
  - 尚未完成真實 Google Apps Script UAT
  - 尚未驗證 19 項 TestRunner
  - 尚未驗證 Docs／Sheets PDF Renderer
  - 尚未驗證角色帳號
