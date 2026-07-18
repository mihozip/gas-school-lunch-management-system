# 正式環境生產部署指南 (docs/deployment/production-deployment-guide.md)

本指南指引系統部署人員在 UAT 通過驗收後，如何將程式安全、乾淨地發布至正式生產環境 (Production Environment)。

---

## 一、部署前安全稽核

在進入正式部署前，必須再次對代碼及 UAT 結果進行二聯覆核：
1. **測試數據無誤**：UAT 階段 105 項測試結果必須為 100% Passed。
2. **靜態安全校驗**：確保 [phase_6_static_check.md](../verification/phase_6_static_check.md) 檢查通過。
3. **無測試或示意變數**：代碼中絕不能寫死 UAT 或 Test 試算表 ID。

---

## 二、正式資源建立與屬性配置

1. **生產環境獨立資源**：
   * 建立正式的 Google 試算表 `[PROD]-學校午餐管理資料庫`。
   * 建立正式的 Google Drive 根目錄 `PROD_SchoolLunch_OfficialRoot`。
2. **新建正式 Apps Script 專案**：
   * 在 Google Drive 正式專案目錄下新建 Apps Script 專案 `SchoolLunch-Management-System`。
   * 上傳全套 GS 與 HTML 代碼。
3. **設定 Production Script Properties**：
   * **`ENVIRONMENT`** = `PRODUCTION`（進入生產環境模式，自動停用大部分除錯 log 及測試端點存取，TestRunner 執行將會被安全阻斷）
   * **`DEPLOYMENT_MODE`** = `PRODUCTION`
   * **`DATABASE_SPREADSHEET_ID`** = `正式資料庫試算表ID`
   * **`REPORT_ROOT_FOLDER_ID`** = `正式報表根目錄ID`
   * **`TEST_SPREADSHEET_ID`** = `空或隨意測試ID (生產環境下不會調用)`
   * **`TEST_REPORT_FOLDER_ID`** = `空`
   * **`ALLOWED_DOMAIN`** = `正式學校網域`
   * **`BOOTSTRAP_ADMIN_EMAIL`** = `正式校內系統管理員信箱`
   * **`CALCULATION_SCALE`** = `2`
   * **`SETTLEMENT_SCALE`** = `0`
   * **`CURRENCY_CODE`** = `TWD`
   * **`TIMEZONE`** = `Asia/Taipei`

---

## 三、部署發布與上線設定

1. **建立 Production Web App Deployment**：
   * 執行身分：**部署的使用者 (User accessing the web app)**。
   * 存取權限：**您的網域內所有使用者 (Anyone within school domain)**。
   * 執行正式部署，記錄產出的正式 `/exec` URL。
2. **首次初始化**：
   * 由最高管理員登入正式 Web App URL。
   * 通過系統初始化精靈建立 29 張工作表結構。
3. **安全核對與設定鎖定**：
   * 設定完 `SystemConfig` 後，應於 `PropertiesService` 中確認 `ENVIRONMENT` 與 `DEPLOYMENT_MODE` 正確設定為 `PRODUCTION`，代碼將全面以正式限制執行。
