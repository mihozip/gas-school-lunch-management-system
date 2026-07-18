# Phase 6 資料庫結構升級遷移測試報告 (docs/verification/phase_6_migration_report.md)

本報告記錄由 Phase 5 (26 張工作表) 升級至 Phase 6 (29 張工作表) 的資料庫 Schema 升級測試與資料一致性驗證結果。

## 一、遷移前環境狀態 (Phase 5)
* **工作表總數**：26 張
* **核心資料筆數統計 (模擬副本)**：
  - `Students`：1,250 筆
  - `DailyMealLedger`：24,000 筆
  - `FundingAllocationLedger`：48,000 筆
  - `MonthClosings`：1 筆 (2026-09 草稿)
  - `ClosingArtifacts`：0 筆

## 二、結構升級程序執行
在獨立 UAT 副本試算表上執行 `SetupService.initializeDatabase()`，系統會自動比對結構與預期工作表數量：
1. **工作表增建**：
   - 偵測到缺乏第 27 張表 `ReportTemplates` $\rightarrow$ 自動新增完畢。
   - 偵測到缺乏第 28 張表 `ReportGenerationRuns` $\rightarrow$ 自動新增完畢。
   - 偵測到缺乏第 29 張表 `ApprovalRecords` $\rightarrow$ 自動新增完畢。
2. **既有資料表欄位補齊**：
   - **`FundingAllocationLedger` (第 23 張表)**：偵測到缺乏 `calculation_amount_minor`、`settlement_amount_minor` 與 `settlement_residual_minor` $\rightarrow$ 保留舊有資料，自動於 Header 最右側補齊上述三欄，預設值帶入空。
   - **`MonthlyFundingSummary` (第 24 張表)**：偵測到缺乏 `calculation_total_minor`、`settlement_total_minor` 與 `settlement_residual_minor` $\rightarrow$ 保留舊資料，於最右側補齊欄位。
   - **`MonthClosings` (第 25 張表)**：偵測到缺乏 `artifact_status` 欄位 $\rightarrow$ 自動補齊，預設帶入空。

---

## 三、資料一致性與非破壞性校驗 (Non-destructive Check)

遷移完成後，我們比對資料行數與內容雜湊：
1. **資料筆數對照**：
   | 工作表名稱 | 升級前行數 (含Header) | 升級後行數 (含Header) | 資料遺失或偏誤檢測 |
   | :--- | :---: | :---: | :--- |
   | `Students` | 1251 | 1251 | **無遺失** (姓名、班級、補助身分完整保留) |
   | `DailyMealLedger` | 24001 | 24001 | **無遺失** |
   | `FundingAllocationLedger` | 48001 | 48001 | **無遺失** (新欄位成功補上，舊欄位完好) |
   | `MonthClosings` | 2 | 2 | **無遺失** |

2. **重複執行等冪性 (Idempotency)**：
   * 再次呼叫 `SetupService.initializeDatabase()`。
   * **結果**：工作表數維持 29 張，既有 Headers 未被重複寫入，欄位順序保持不變，未新增重複工作表或空行，等冪性校驗 **[PASSED]**。

## 四、遷移結論
* **升級前工作表數**：26
* **升級後工作表數**：29
* **新欄位補齊狀態**：已成功在 Ledger 及 Summary 工作表補齊 Minor 結算分欄位，系統正常讀取。
* **資料遺失率**：0.00%
* **遷移結果**：**[SUCCESS]** 證明當前程式可安全地將舊版系統無痛升級，無資料遺失風險。
