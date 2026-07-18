# 月結核銷證據與治理審計範本 (closing-evidence-template.md)

當月份被正式月結鎖定 (closed) 後，系統必須在 Google Drive 歸檔路徑生成封存檔案包，且其中包含核心的 `closing_manifest.json` 與相關明細 CSV。

## 📋 closing_manifest.json 欄位定義與規範

| 欄位名稱 | 類型 | 說明 |
| :--- | :--- | :--- |
| `school_name` | STRING | 學校名稱 |
| `school_code` | STRING | 學校代碼 |
| `school_year` | INTEGER | 系統當前學年度 |
| `semester` | INTEGER | 學期 |
| `year_month` | STRING | 月結月份 (YYYY-MM) |
| `closing_id` | STRING | 月結識別碼 (CLOSE_年月_V版本_隨機碼) |
| `closing_version` | INTEGER | 月結封存版本號 |
| `total_meal_count` | INTEGER | 當月符合補助用餐之實到餐數總和 |
| `gross_amount_minor`| INTEGER | 原始餐費總金額 (整數分單位) |
| `allocation_by_source`| OBJECT | 各機關來源分攤總額快照 (township, county, school, self_pay) |
| `file_manifest` | OBJECT | 封存之 CSV 檔案路徑、ID、大小及 SHA-256 驗證雜湊值 |
| `closed_by` | STRING | 執行月結核銷之人員 Email |
| `closed_at` | DATETIME | 正式閉簽鎖定時間 |
| `application_version`| STRING | 應用程式版本 |
| `schema_version` | STRING | 資料庫綱要版本 |

## ⚖️ 職務分離 (Separation of Duties) 審計原則
當系統啟用強效治理模式時：
1. **驗證分離**：月結草稿建立者（`prepared_by`）與月結就緒性核可者（`validated_by`）不得為同一人。
2. **閉簽分離**：就緒性核可者（`validated_by`）與正式執行關帳閉簽者（`closed_by`）不得為同一人。
3. **會計授權**：主計/會計人員能否執行 validation 階段，由全域參數 `ACCOUNTANT_CAN_VALIDATE_CLOSING` 控制。

## 🛡 封存產出的原子性 (Atomicity) 審計原則
為避免產生破損的封存包：
* 必須確保全部 5 張核心對帳明細 CSV 及 Manifest 生成成功，且每個檔案大小 > 0 並且 SHA-256 雜湊完全對應後，MonthClosing 狀態才允許從 `draft` / `validated` 變更為 `closed`。
* 若中途發生斷線或儲存空間不足，狀態必須標記為 `artifact_failed`，清除殘留不完整檔案，不允許留下偽裝成已 closed 的不完整封存包。
