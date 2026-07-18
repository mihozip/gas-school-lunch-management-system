# 上線後維護與定期稽核檢核表 (docs/deployment/post-deployment-checklist.md)

本檢核表供系統管理員與主計/會計人員於系統正式上線營運後，進行每月定期維護與安全性稽核時使用。

---

## 🔍 定期稽核與維護項目

### 1. 每日運作狀況監控 (建議：每日或每週)
* **[ ] 導師停餐完成率**：確認各班導師每日是否在截止時間（如 `09:00`）前完成停餐登記與確認。
* **[ ] Trigger 執行紀錄**：至 Google Apps Script 執行項目 (Executions) 檢查排程 Trigger 執行狀態，有無逾時 (Timeout) 或權限失效錯誤。
* **[ ] 每日餐數計算 (CalculationRuns)**：確認每日自動餐數計算有無異常 issues 產生。

### 2. 每月關帳核銷稽核 (建議：每月月底)
* **[ ] 月結就緒性檢驗 (Validation Check)**：在執行關帳前，檢驗對帳明細與異常 issues，確保 $roster\_count - suspension\_count - exception\_count$ 計算正確。
* **[ ] 計算與結算分流對帳**：確認 Ledger 逐餐分攤金額與 Summaries 月度統計金額完美相符，結算尾差已全數分配至指定來源（自付或公所）。
* **[ ] 封存 Manifest 雜湊校驗**：檢查 `reports/official/` 下產生的 `report_manifest.json` 與 `closing_manifest.json` 雜湊簽章，手動下載並抽樣校驗檔案雜湊值以防防撬漏洞。

### 3. 半年/每學期安全審查 (建議：學期末)
* **[ ] 補助費率遷移核對**：檢視 `SubsidyRules` 與已結束學期之補助金額，確認費率全數為 Basis Points 格式，並無 Legacy 格式殘留。
* **[ ] 歷史備份封存**：下載該學期所有 closed 狀態的正式報表 PDF 與 CSV 檔案包，上傳至學校異地 NAS 封存。
* **[ ] 權限審查 (User Audit)**：檢查 `Users` 清單中已轉調或離職的教師/承辦人，其 `enabled` 屬性是否已切換為 `FALSE`。
