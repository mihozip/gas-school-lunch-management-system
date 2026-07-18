# 資料庫備份與還原指南 (docs/deployment/backup-restore-guide.md)

本系統以 Google Sheets 作為資料儲存庫。為防止因操作失誤、惡意篡改或不可抗力之災害，本指南說明如何建立定期備份與系統回復機制。

---

## 一、定期備份機制

由於 Google 試算表具備原生版本歷程功能，我們採用雙軌備份策略：

### 1. 試算表原生版本歷程
* **操作方式**：Google Sheets 會自動儲存所有單格異動歷程。
* **命名標籤**：建議在每個月完成月結鎖定時，於 Google 試算表選單中點選「檔案 (File)」 $\rightarrow$ 「版本歷程紀錄 (Version history)」 $\rightarrow$ 「為目前版本命名 (Name current version)」，命名為 `V{月結版本}-{年月} 關帳備份`。

### 2. 獨立複本封存 (每月關帳強制執行)
* **操作方式**：當 MonthClosing 狀態移轉至 `closed` 時，系統會透過 `MonthClosingService.archiveClosingData()` 自動將點名 Ledger、補助 Allocation 等資料導出為 CSV 封存至 Google Drive。
* **安全儲存**：這些封存 CSV 檔案預設被存放在獨立的 `reports/official/` 與 `data/` 資料夾下，並以 SHA-256 雜湊防篡改校驗。
* **手動異地備份**：每學期末，系統管理員應下載 `reports/` 下所有 PDF 與 `report_manifest.json` 下載封存至學校內部實體伺服器 (NAS)。

---

## 二、災難還原步驟 (Restore)

若發生資料庫毀損，請遵循以下步驟進行還原：

1. **鎖定系統存取**：
   * 為防止還原期間用戶繼續寫入，至 Apps Script 的 Script Properties 中，將 `ENVIRONMENT` 暫時改為 `MAINTENANCE`，系統 Web App 將會阻斷所有非管理員使用者的登入。
2. **複製備份副本**：
   * 找到毀損前最後一次正常命名標籤的試算表備份副本，將其複製一份，命名為 `[RESTORED]-學校午餐資料庫`。
3. **更換資料庫 ID 綁定**：
   * 進入 Apps Script 的指令碼屬性設定。
   * 將 `DATABASE_SPREADSHEET_ID` 修改為還原後的試算表 ID。
4. **重新對帳與驗收**：
   * 登入系統管理員帳號，至「系統健康狀態」執行快速診斷。
   * 比對 `MonthClosings` 中最後一筆 `closed` 月份的雜湊值是否與備份副本中的 `report_manifest.json` 一致。
5. **恢復系統營運**：
   * 將 `ENVIRONMENT` 屬性恢復為 `PRODUCTION`。
   * 通知教師與行政同仁系統已恢復正常運作。
