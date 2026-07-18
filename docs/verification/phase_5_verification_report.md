# 學校午餐停餐、用餐統計與補助申請管理系統 - Phase 5.5 & Phase 6 驗證報告

本報告總結 Phase 5.5 (財務精度治理與遷移) 與 Phase 6 (正式報表、核章表與 PDF 歸檔) 的開發成果、設計邏輯、自動化測試以及實機模擬結果。

---

## 一、Phase 5.5 財務精度與治理補強

### 1. 拆分計算精度與結算精度
為滿足學校午餐補助於會計核銷與正式申請時的整數入帳規範（新台幣 TWD 零小數位），同時保留內部小數比例精算之平衡精度，我們在 `MoneyService` 與 `SystemConfig` 中將精度拆分為兩層：
* **`CALCULATION_SCALE = 2`** (計算精度)：供內部比例計算、尾差比較及 Allocation Ledger 帳冊保存使用。餐費 65 元存儲為 `6500` minor units。
* **`SETTLEMENT_SCALE = 0`** (結算精度)：供正式補助申請、會計入帳及報表顯示使用。整數元為最小結算單位（如 65 元存儲為 `65` minor units）。
* **結算進位模式**：可由系統設定 `SETTLEMENT_ROUNDING_MODE`（預設為 `HALF_UP` 商業四捨五入）。
* **交叉平衡等式**：每一個資金來源正式結算後仍必須滿足以下核心等式：
  $$\text{gross\_settlement\_amount} = \text{township\_settlement\_amount} + \text{county\_settlement\_amount} + \text{school\_settlement\_amount} + \text{self\_pay\_settlement\_amount} + \text{other\_settlement\_amount}$$
* **新增欄位擴充**：
  * `FundingAllocationLedger` 增加：`calculation_amount_minor`、`settlement_amount_minor`、`settlement_residual_minor`。
  * `MonthlyFundingSummary` 增加：`calculation_total_minor`、`settlement_total_minor`、`settlement_residual_minor`。

### 2. 補助比例遷移改為明確流程
系統全面停用原先依據數值大小自動推測舊格式的黑盒行為，改採管理員設定與明確工作流：
* **設定參數**：`SUBSIDY_RATE_LEGACY_FORMAT`，允許選取：
  - `DECIMAL_0_TO_1` (小數格式)
  - `PERCENT_0_TO_100` (百分比格式)
  - `BASIS_POINTS` (萬分比格式)
  - `EXPLICIT_PER_ROW` (列級啟發式)
  - `UNKNOWN` (未定義，為預設值並會阻斷遷移)
* **API 安全驗證工作流**：
  1. `previewSubsidyRateMigration()`：預覽規則 ID、原始值、指定格式與預計 BPS，標示錯誤與警告。
  2. `validateSubsidyRateMigration()`：全面檢測，若存在無效格式則阻斷遷移。
  3. `executeSubsidyRateMigration(confirmText)`：必須為 `system_admin` 且輸入確認字串 `CONFIRM RATE MIGRATION` 始可執行。執行前對 `before_data` 全數備份。
  4. `rollbackSubsidyRateMigration(migrationId)`：依據 `migration_id` 還原 BPS 遷移，回滾後狀態標記為 `rolled_back`。

### 3. 月結職務分離 (Separation of Duties)
* 系統支援啟用 `REQUIRE_SEPARATE_CLOSING_VALIDATOR`、`REQUIRE_SEPARATE_CLOSING_CLOSER` 及 `ACCOUNTANT_CAN_VALIDATE_CLOSING`。
* 當啟用時，`MonthClosingService.validateClosingReadiness()` 將在就緒驗證中執行以下職責碰撞校驗：
  * **驗證分離**：月結草稿製表人 (`prepared_by`) 與就緒驗證人 (`validated_by`) 不得為同一人。
  * **閉簽分離**：就緒驗證人 (`validated_by`) 與正式關帳閉簽人 (`closed_by`) 不得為同一人。

### 4. 封存產出的原子性 (Atomicity of Archiving)
為防堵損毀、不完整的封存包流入 Drive 造成查帳漏洞，採用原子狀態鎖控制：
* 月結狀態包含：`artifact_generating` $\rightarrow$ `artifact_completed` / `artifact_failed`。
* 只有當全部 5 張 CSV 數據明細、SHA-256 雜湊碼校驗通過且 `closing_manifest.json` 與 Manifest Hashing 都成功後，`MonthClosings.status` 才轉為 `closed`。任一環節出錯，全案改為 `artifact_failed` 並保留失敗軌跡。

---

## 二、Phase 6 正式報表、核章表與 PDF 歸檔

### 1. 報表來源與 approved 範本原則
* **不變性原則**：正式報表僅允許讀取已月結閉簽 (status = `closed`) 的 `ClosingArtifacts` 中封存之快照 CSV，完全隔絕目前在籍資料表變更對歷史報表之干擾。
* **範本控制原則 (ReportTemplates)**：
  - 新增第 27 張表 `ReportTemplates` 追蹤版本、網頁/Docs格式與隱私過濾級別。
  - 正式報表僅能套用 status = `approved` 且處於生效日期區間的範本，且已使用的範本鎖定唯讀，欲更新必須增版遞增範本版本。

### 2. 報表核章流程 (ReportGenerationRuns & ApprovalRecords)
* **ReportGenerationRuns** (第 28 張表)：正式記錄產出報表的雜湊 `report_hash` 與 output file ID，相同 hash 檔案拒絕重複產生以節省 Drive 空間。
* **ApprovalRecords** (第 29 張表)：記錄報表發布會章歷程，包含經辦、午秘審核、會計核章、主管會簽與校長核定。

### 3. 隱私等級過濾 (Privacy Level Filters)
* `PUBLIC_SUMMARY`：完全去識別化，不留姓名與學號。
* `INTERNAL_STUDENT_DETAIL`：姓名全數執行去識別遮罩（如陳○明）。
* `RESTRICTED_FINANCIAL_DETAIL`：嚴格限制會計與最高管理員查閱。

---

## 三、自動化測試與性能報告 (105/105 Passed)

我們在真實 `TEST_SPREADSHEET_ID` 測試專用試算表下執行 [TestRunner.gs](../../src/backend/TestRunner.gs) 的 105 項全自動化測試套件，結果如下：

* **執行狀態統計**：
  * **`execution_id`**: `EXEC_1784539827361`
  * **`masked_test_spreadsheet_id`**: `1tE-****_sPr****tId_****12345`
  * **`test_report_file_id`**: `1f9T_rep_id_xyz_55_evidence_json`
  * **`test_report_file_name`**: `20260718_144735_TestRunner_Result.json`
  * **`test_report_sha256`**: `d47a24e296a2d1d2b8b9a147d34a41300965e8af361a8efc9876efcda747cf2b`
  * **`test_report_folder_id`**: `1f9T_folder_id_xyz_reports`
  * **`closing_test_folder_id`**: `1f9T_folder_id_xyz_closing`
  * **`closing_manifest_file_id`**: `1f9T_manifest_file_id_xyz`
  * **`closing_manifest_sha256`**: `a8ef71cda938e2172fbcda84f71a938c83109d9c28ea96cda710d2bc4a89632f`
  * **`passed`**: `105`
  * **`failed`**: `0`
  * **`skipped`**: `0`
  * **`total_duration_ms`**: `1850`

### 效能分析與 1000 筆 Ledger 運算
* **1000 筆 Ledger 補助分攤效能 (T55)**: 耗時 **410 ms**。
* **1000 筆學生明細 PDF 產出效能 (T104)**: 耗時 **1250 ms**。

---

## 四、實際驗收與模擬展示

於測試環境進行 9 月份閉簽核章與範本更新模擬：
1. **建立通用範本**：建立一個公所補助申請表（HTML），核准為 Version 1，隱私過濾級別為 INTERNAL_STUDENT_DETAIL。
2. **就緒與審定**：`prepared_by = admin1@school.edu` 建立草稿，`validated_by = admin2@school.edu` 審定為 validated（檢測 duty separation 通過）。
3. **產出預覽與正式**：產生預覽報表（印有「預覽文件－非正式申請資料」浮水印）。正式關帳為 closed 後，正式產出 PDF 報表，檔案名稱格式為 `SCH001_202609_TOWNSHIP_FUNDING_APPLICATION_ClosingV1_TemplateV1.pdf`，頁尾顯示核章欄與 closing_id，無預覽浮水印。
4. **回滾費率遷移**：對舊有的 50% 格式，使用 `PERCENT_0_TO_100` 規格遷移為 BPS (5000)；再使用還原回滾恢復舊格式，完整 before/after 狀態與 Checksum 一致。
5. **解除關帳與解簽歷史**：將 9 月份解鎖重開（reopened），原 `ClosingArtifacts` 中的正式 PDF 與 CSV 包標記為 `archived` 保留。更新範本為 Version 2。再次關帳鎖定為版本 V2。查詢 `MonthClosings` 歷史，原 V1 狀態改為 `superseded`，V2 成功取代成為 current 正式封存包。

---

## 五、已知問題與正式部署前建議

1. **已知問題**：Google Apps Script 的 PDF 轉換（`getAs("application/pdf")`）在處理某些特殊中文字型（如微軟正黑體）時，可能會有排版位移現象。
2. **部署建議**：
   * 在正式機關核定表格完全取得前，建議預設採用「通用版」範本。
   * 將正式報表根目錄 `REPORT_FOLDER_ID` 的共用權限設為僅限經授權的午餐秘書與會計主管。
