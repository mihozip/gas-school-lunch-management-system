# 自動化測試證據審計範本 (test-evidence-template.md)

每次執行 `TestRunner.runAllTests()` 後，系統必須自動於 Drive 的 `TEST_REPORT_FOLDER_ID` 中導出測試證據 JSON。以下為該證據 JSON 檔案之規定欄位與審計基準。

## 📋 JSON 欄位定義與規範

| 欄位名稱 | 類型 | 說明 |
| :--- | :--- | :--- |
| `execution_id` | STRING | 唯一執行批次序號，格式為 `EXEC_時間戳記` |
| `schema_version` | STRING | 測試資料庫綱要版本 (當前為 `5.0`) |
| `application_version`| STRING | 系統軟體版本 |
| `environment` | STRING | 必須等於 `TEST`，否則拒絕執行 |
| `masked_spreadsheet_id`| STRING | 遮蔽後的測試試算表 ID，如 `1AbC****XyZ9` |
| `test_started_at` | DATETIME | 測試開始時間 (YYYY-MM-DD HH:mm:ss) |
| `test_finished_at` | DATETIME | 測試結束時間 |
| `total_duration_ms` | INTEGER | 測試總執行耗時 (毫秒) |
| `passed` | INTEGER | 通過的測試情境數 |
| `failed` | INTEGER | 失敗的測試情境數 |
| `skipped` | INTEGER | 跳過的測試情境數 |
| `errors` | ARRAY | 執行期間拋出的任何全域崩潰或嚴重錯誤 |
| `performance` | OBJECT | 性能監控指標 (如 1000 筆 Ledger 運算耗時) |
| `test_results` | ARRAY | 逐筆測試詳細紀錄 (見下方定義) |

### 逐筆測試詳細紀錄 (`test_results` 項)

```json
{
  "test_id": "T1",
  "test_name": "測試情境名稱",
  "status": "passed" | "failed",
  "expected": "斷言預期值",
  "actual": "實際產出值",
  "duration_ms": 35,
  "affected_sheets": ["Students", "DailyMealLedger"],
  "before_row_counts": { "Students": 42, "DailyMealLedger": 0 },
  "after_row_counts": { "Students": 42, "DailyMealLedger": 20 },
  "error_code": "錯誤代碼",
  "error_message": "錯誤訊息",
  "stack": "異常堆疊軌跡"
}
```

## 🕵️ 審計複核重點
1. **防撬安全檢驗**：若 `environment !== "TEST"`，此 JSON 不得產生，且必須立即報警。
2. **零容忍原則**：任何一筆 `status` 為 `failed` 時，全案判定為未通過，禁止進入生產環境部署。
3. **性能下限**：1,000名學員大宗分攤計算之 `performance.funding_calculation_1000_rows_ms` 必須在 15,000 毫秒（15秒）內完成。
