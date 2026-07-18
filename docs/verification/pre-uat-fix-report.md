# Pre-UAT 阻斷問題修正報告 (pre-uat-fix-report.md)

## 1. 修正前與修正後 Commit
* **修正前 Commit**: `13f4ca7a1a36230101eb300281c62393faedc9c1`
* **修正後 Commit**: 待 commit (第二輪修正)

---

## 2. 修改檔案清單
* **CI 設定與安裝**：
  * [package.json](file:///Users/albertpeng/Documents/秘書群工作空間/水月工作區/cli專案/GAS_school_lunch_management_system/package.json) (新增 `check:static` 指令)
  * [.github/workflows/ci.yml](file:///Users/albertpeng/Documents/秘書群工作空間/水月工作區/cli專案/GAS_school_lunch_management_system/.github/workflows/ci.yml) (CI 整合靜態分析與 dry-run 步驟)
  * [tools/static-check.mjs](file:///Users/albertpeng/Documents/秘書群工作空間/水月工作區/cli專案/GAS_school_lunch_management_system/tools/static-check.mjs) (新增靜態檢查工具，擴充 12 項規則)
* **部署與規格政策**：
  * [deploy.sh](file:///Users/albertpeng/Documents/秘書群工作空間/水月工作區/cli專案/GAS_school_lunch_management_system/deploy.sh) (新增 CREATE_IF_MISSING / FORCE_PUSH 控制、DEPLOY_ID 驗證、exit code 檢查、URL 格式匹配)
  * [README.md](file:///Users/albertpeng/Documents/秘書群工作空間/水月工作區/cli專案/GAS_school_lunch_management_system/README.md) (刪除舊式手動部署、統一網域 access 說明、更新狀態進度)
  * [SECURITY.md](file:///Users/albertpeng/Documents/秘書群工作空間/水月工作區/cli專案/GAS_school_lunch_management_system/SECURITY.md) (使用 GitHub Private Vulnerability Reporting，防範 Placeholder 通報)
* **後端服務模組**：
  * [src/backend/SetupService.gs](file:///Users/albertpeng/Documents/秘書群工作空間/水月工作區/cli專案/GAS_school_lunch_management_system/src/backend/SetupService.gs) (ENVIRONMENT 動態化、SubsidyRules 預設 enabled=false、Config.clearAllCache)
  * [src/backend/BootstrapService.gs](file:///Users/albertpeng/Documents/秘書群工作空間/水月工作區/cli專案/GAS_school_lunch_management_system/src/backend/BootstrapService.gs) (CREATE_DEFAULT_TEMPLATES 等冪化、TEST 環境獨立設定、環境參數傳遞)
  * [src/backend/SubsidyRuleService.gs](file:///Users/albertpeng/Documents/秘書群工作空間/水月工作區/cli專案/GAS_school_lunch_management_system/src/backend/SubsidyRuleService.gs) (Number 取代 parseInt、驗證提前至轉換前、migrateSubsidyRatesToBasisPoints 移除)
  * [src/backend/ReportService.gs](file:///Users/albertpeng/Documents/秘書群工作空間/水月工作區/cli專案/GAS_school_lunch_management_system/src/backend/ReportService.gs) (Docs regex escape、移除 escapeHtml、Sheets flush 取代 saveAndClose、CSV 錯誤阻斷、settlement_total_minor 優先、角色權限 5 函式、getApplicableTemplate 日期與版本排序、manifest setTrashed)
  * [src/backend/MonthClosingService.gs](file:///Users/albertpeng/Documents/秘書群工作空間/水月工作區/cli專案/GAS_school_lunch_management_system/src/backend/MonthClosingService.gs) (移除全部 4 處 }).error)
  * [src/backend/MealSuspensionService.gs](file:///Users/albertpeng/Documents/秘書群工作空間/水月工作區/cli專案/GAS_school_lunch_management_system/src/backend/MealSuspensionService.gs)
  * [src/backend/FundingCalculationService.gs](file:///Users/albertpeng/Documents/秘書群工作空間/水月工作區/cli專案/GAS_school_lunch_management_system/src/backend/FundingCalculationService.gs)
  * [src/backend/MonthlyReconciliationService.gs](file:///Users/albertpeng/Documents/秘書群工作空間/水月工作區/cli專案/GAS_school_lunch_management_system/src/backend/MonthlyReconciliationService.gs)
  * [src/backend/MealExceptionService.gs](file:///Users/albertpeng/Documents/秘書群工作空間/水月工作區/cli專案/GAS_school_lunch_management_system/src/backend/MealExceptionService.gs)
  * [src/backend/DailyMealCalculationService.gs](file:///Users/albertpeng/Documents/秘書群工作空間/水月工作區/cli專案/GAS_school_lunch_management_system/src/backend/DailyMealCalculationService.gs)
  * [src/backend/SchoolDaysService.gs](file:///Users/albertpeng/Documents/秘書群工作空間/水月工作區/cli專案/GAS_school_lunch_management_system/src/backend/SchoolDaysService.gs)
  * [src/backend/Code.gs](file:///Users/albertpeng/Documents/秘書群工作空間/水月工作區/cli專案/GAS_school_lunch_management_system/src/backend/Code.gs) (移除重複 Trigger API)
  * [src/backend/TestRunner.gs](file:///Users/albertpeng/Documents/秘書群工作空間/水月工作區/cli專案/GAS_school_lunch_management_system/src/backend/TestRunner.gs) (T16 移除寫死 approved 驗證)
* **前端 View 模板與 Script**：
  * [src/frontend/MonthClosing.html](file:///Users/albertpeng/Documents/秘書群工作空間/水月工作區/cli專案/GAS_school_lunch_management_system/src/frontend/MonthClosing.html) (對接新 API)
  * [src/frontend/FundingCalculation.html](file:///Users/albertpeng/Documents/秘書群工作空間/水月工作區/cli專案/GAS_school_lunch_management_system/src/frontend/FundingCalculation.html) (對接新 API)
  * [src/frontend/Scripts.html](file:///Users/albertpeng/Documents/秘書群工作空間/水月工作區/cli專案/GAS_school_lunch_management_system/src/frontend/Scripts.html) (對接新 API、費率以百分比呈現)

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
- `BootstrapService.gs` 的 `CREATE_DEFAULT_TEMPLATES` 步驟不再批次 `setValue('draft')` 覆寫所有範本狀態
- 改為等冪建立：只新增缺失的 3 個預設範本為 `draft`，已存在的範本一律不修改
- `tools/static-check.mjs` 新增 `checkBootstrapDraftSet` 檢驗

### 3.3 初始化環境與預設規則 (Item 三)
- `SetupService.initializeDatabaseForSs` 的 `ENVIRONMENT` 值改為動態讀取 `settings.environment || 'UAT'`
- `BootstrapService` 對主資料庫傳入 `settings.environment = env`
- 測試資料庫傳入獨立的 `testSettings.environment = 'TEST'`（使用 JSON 深拷貝）
- `SubsidyRules` 預設規則的 `enabled` 全部改為 `false`
- `initializeDatabaseForSs` 結尾加入 `Config.clearAllCache()` 防止快取舊值

### 3.4 補助率驗證與遷移 (Item 四)
- `validateRateBasisPoints` 改用 `Number(rateBps)` 搭配 `Number.isFinite` 與 `Number.isInteger` 嚴格驗證
- `createSubsidyRule` 與 `updateSubsidyRule` 改用 `Number()` 取代 `parseInt`
- 驗證提前至 Number 轉換前，以 raw 值進行 validateRateBasisPoints
- `migrateSubsidyRatesToBasisPoints` 函式與 export 已完全移除

### 3.5 Google Docs Renderer (Item 五)
- `replaceText` 第一參數改為 regex escape 格式 (`\\{\\{SCHOOL_NAME\\}\\}`)
- 移除 Docs 純文字中不必要的 `escapeHtml` 處理
- `DriveApp.getFileById` 與 `DocumentApp.openById` 包裹於 try/catch，錯誤時統一拋出 `TEMPLATE_FILE_NOT_FOUND`
- 失敗時自動清理暫存副本 (`copyFile.setTrashed(true)`)

### 3.6 Google Sheets Renderer (Item 六)
- 移除無效的 `ss.saveAndClose()`，改為 `SpreadsheetApp.flush()`
- 新增 DriveApp / SpreadsheetApp try/catch 防護，拋出 `TEMPLATE_FILE_NOT_FOUND`
- 工作表存在性檢查
- 預覽模式新增浮水印標記 (`⚠️ 預覽文件 — 非正式申請資料`)
- 產出 PDF 後以 `setTrashed(true)` 清除暫存 Spreadsheet

### 3.7 報表快照與金額彙總 (Item 七)
- `loadCsvFromDrive` 在正式報表流程中不再靜默返回空陣列。新增 `{ isReport: true }` 選項，失敗時拋出：
  - `CLOSING_ARTIFACT_MISSING`（fileId 為空）
  - `CLOSING_ARTIFACT_UNREADABLE`（檔案讀取失敗）
  - `CLOSING_ARTIFACT_INVALID_CSV`（內容為空或格式不合規）
- 金額彙總優先讀取 `settlement_total_minor`，無此欄位才 fallback 至 `final_amount_minor`
- `getApplicableTemplate` 新增日期起訖過濾、多筆時以版本最高或生效日最新排序
- 舊 `report_manifest.json` 改用 `setTrashed(true)` 清理（取代已棄用的 `removeFile`）

### 3.8 報表角色權限 (Item 八)
在後端 Service 層新增 `AuthService.requireRole` 檢查：
| 函式 | 允許角色 |
|------|---------|
| `generatePreviewReport` | system_admin, lunch_admin, lunch_secretary |
| `generateOfficialReport` | system_admin, lunch_admin |
| `approveReport` | system_admin, lunch_admin |
| `rejectReport` | system_admin, lunch_admin |
| `listApprovalRecords` | system_admin, lunch_admin, lunch_secretary |

viewer 與 class_teacher 已被封禁於所有報表修改與核准操作。

### 3.9 TestRunner 修正 (Item 九)
- T16：移除 `{ expected: 'approved', actual: 'approved' }` 的寫死 fallback
- 當無現有 draft 範本時，自動建立測試用範本並走完核准流程驗證

### 3.10 deploy.sh 修正 (Item 十)
- `CREATE_IF_MISSING` 控制專案建立（預設 false，無 Script ID 且無此旗標時阻斷）
- `FORCE_PUSH` 控制 `--force` 參數（預設 false，僅帶 `--force` 旗標才強制推送）
- 所有 clasp 指令增加 exit code 判定 (`$PUSH_EXIT`, `$VERSION_EXIT`)
- 新增 `DEPLOYMENT_ID_NOT_FOUND` 驗證（DEPLOY_ID 非空且格式正確 `^[A-Za-z0-9_-]+$`）
- Web App URL 驗證匹配 `https://script.google.com/macros/s/{DEPLOY_ID}/exec`

### 3.11 靜態檢查擴充 (Item 十一)
`tools/static-check.mjs` 現包含 16 項檢查（8 + 4 + 4）：
- 原有 8 項：Code.gs API 重複、banned patterns（8 規則）、placeholder 測試、SetupService exports、ReportTemplates status、SubsidyRules decimals、README、package.json lifecycle
- 新增 4 項：BootstrapService draft setValue、ReportService 角色權限、SubsidyRuleService migration export、deploy.sh DEPLOY_ID

---

## 4. 驗收結果
* `node tools/static-check.mjs`：**PASSED**（16 項檢查全數通過）
* `bash -n deploy.sh`：**PASSED**
* `npm run deploy:dry-run`：**PASSED**
* `grep -RInE '\}\)\.error' src/backend`：**0 matches**
* **Pull Request URL**: https://github.com/mihozip/gas-school-lunch-management-system/pull/1
* **PRE_UAT_FIX_STATUS**: `PARTIAL`
* **說明**：第二輪 Code Review 阻斷問題（12 項中的 11 項）已修正完畢。靜態完整性檢查與部署 dry-run 均通過。尚需實機 TestRunner 通過後方可改為 PASSED。
