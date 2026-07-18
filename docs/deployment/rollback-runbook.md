# 版本回滾與災難復原演練手冊 (docs/deployment/rollback-runbook.md)

本 Runbook 提供當新版 Web App 部署上線後發生非預期嚴重故障（如 API 崩潰、個資洩漏風險、金額計算錯誤）時，快速且安全地回滾至前一正常版本的標準操作流程。

---

## 一、Apps Script 程式版本回滾 (Rollback App Version)

### 1. 說明
Google Apps Script Web App 的網址中帶有 `/exec`，這個網址在重新部署時可以保持**不變**（只要您是更新同一個 Deployment 的版本，而不是新建一個 Deployment）。

### 2. 回滾步驟
1. 進入 Google Apps Script 編輯器首頁。
2. 點選上方「網頁部署 (Deploy)」 $\rightarrow$ 「管理部署 (Manage deployments)」。
3. 在左側清單中選取目前作用中的 Web App 部署。
4. 點選右上角的「編輯 (Edit)」按鈕 (鉛筆圖示)。
5. 在「版本 (Version)」下拉選單中，**不要**選擇「新版本 (New version)」，而是選回上一個正常運作的版本編號 (例如：從版本 12 改選為版本 11)。
6. 點選「部署 (Deploy)」保存。
7. **驗證**：在瀏覽器中重新整理 Web App `/exec` 網頁，確認網址不變且系統功能已復原回舊版畫面。

* **回滾耗時預估**：約 **3 分鐘**。

---

## 二、資料庫狀態回滾 (Rollback Database)

如果程式回滾的同時，伴隨著資料庫 Schema 變更衝突，則必須對 Google Sheets 進行還原：

1. **斷開連接**：
   * 於 Apps Script Properties 中，更換 `DATABASE_SPREADSHEET_ID` 為臨時的 dummy ID，以阻斷任何可能寫入的連線。
2. **回復試算表版本**：
   * 開啟原 Google 試算表。
   * 點選「檔案」 $\rightarrow$ 「版本歷程紀錄」 $\rightarrow$ 「查看版本歷程紀錄」。
   * 在右側面板中，點選升級/部署前的時間標籤備份副本。
   * 點選左上角「還原這個版本 (Restore this version)」並確認。
3. **重新連接並啟用**：
   * 將 `DATABASE_SPREADSHEET_ID` 重新改回正確的試算表 ID。
   * 將 `ENVIRONMENT` 設為 `PRODUCTION`。
   * 至「用餐明細帳冊」及「補助來源彙總」確認資料已還原至預期狀態。

---

## 三、回滾後驗收指標 (Post-Rollback KPI)

回滾完成後，管理員必須手動執行以下項目，確保系統完全復原：
* **[ ] 使用者可成功登入**：無 HTTP 500 或 403 錯誤。
* **[ ] 測試帳號權限正常**：一般導師登入後，無法看到「系統全域設定」或「報表範本管理」。
* **[ ] 歷史關帳報表可讀取**：進入「補助報表中心」，比對先前已 closed 的月結版本，其 PDF 與 CSV 下載連結仍能正常開啟且雜湊無誤。
