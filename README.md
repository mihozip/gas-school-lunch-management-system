# 學校午餐停餐、用餐統計與補助申請管理系統

本系統是一套專為學校行政設計的**午餐管理、停餐登記、用餐統計與補助申請**全方位解決方案。系統採用「預設全班用餐、僅登記例外」之核心設計原則，降低導師每日登記行政負擔，並自動化彙整餐數、計算公所與縣府補助金額，最終產出符合審計規範的核章報表與歸檔檔案。

---

## 系統部署與安裝

### 系統需求與使用限制
- **Node.js 版本**：v20 以上。
- **Google Apps Script API**：必須啟用服務（請至 [Google Apps Script 使用者設定](https://script.google.com/home/usersettings) 將 API 切換為「啟用」狀態）。
- **網域存取限制**：正式營運與 UAT 部署均基於 Google Workspace 學校網域帳號。依 `appsscript.json` 設定，網頁應用程式執行身分為「部署者 (USER_DEPLOYING)」，且存取權限僅限於學校網域帳號內成員 (DOMAIN)。
- **帳號限制**：正式使用需 Google Workspace。個人 Gmail 帳戶尚未驗證 DOMAIN Web App 部署，目前不提供完整支援，僅供本地開發模擬使用。

### 安裝與部署步驟
1. **下載原始碼並安裝依賴**：
   ```bash
   git clone https://github.com/mihozip/gas-school-lunch-management-system.git
   cd gas-school-lunch-management-system
   npm ci
   ```
2. **啟動自動化建置**（請確保已完成 clasp 登入）：
   ```bash
   npm run setup
   ```

### 首次初始化建置流程
1. **自動建立專案**：Clasp 自動在您的 Google 帳戶下建立名為 `學校午餐管理系統-UAT-{Timestamp}` 的 Web App 專案。
2. **自動部署發布**：系統將本地原始碼 push 上傳，並自動部署 Web App（部署 ID 將保存於本地 `.deploy/uat.json` 以確保未來更新時網址固定）。
3. **開啟引導精靈**：點選終端機輸出之 Web App `/exec` 網址並同意權限，系統會自動開啟「狀態機初始化精靈」。
4. **選擇環境確認**：選擇 **UAT**（或 **PRODUCTION**）環境，設定學校基本設定與管理員姓名，點選「**開始一鍵初始化**」。
   - **預設環境**：UAT。
   - **預設範本狀態**：draft (approved_by, approved_at 保持空白)。
   - **測試資源限制**：若選擇 **PRODUCTION**，系統將不會建立任何 TEST 試算表或測試 Drive 資料夾。

---

## 系統核心特色

1. **例外登記設計**：導師僅需於每日截止前登記「未用餐」學生（如請假、停餐、轉出、公假等），預設全班皆為正常用餐。
2. **多重角色權限管理**：
   - 系統最高管理員 (`system_admin`)
   - 午餐管理人員 (`lunch_admin`)
   - 班級導師 (`class_teacher`)
   - 會計或總務人員 (`accountant`)
   - 唯讀人員 (`viewer`)
3. **自動化補助計算**：動態讀取補助身分類別與補助規則（如一般學生公所 50% + 縣府 50%、特殊身分縣府 100%），支援月中轉入/轉出、補助身分變更與餐費調整。
4. **月結鎖定與版本控制**：月結完成後鎖定當月所有資料，解除月結需經最高管理員填寫原因，所有異動均有 Audit Log 追蹤，且重新計算會產生新版本（`calculation_version`）。
5. **報表一鍵產出與 Drive 歸檔**：支援產出 A4 適合列印的 PDF/試算表，自動依「學年度/月份」歸檔至 Google Drive 指定資料夾。
6. **全響應式介面**：手機、平板、電腦皆能流暢操作。

---

## 技術架構

- **前端**：HTML5, JavaScript, Vanilla CSS (精緻現代化設計，包含微動畫與響應式佈局)
- **後端**：Google Apps Script (GAS) Web App (executeAs: USER_DEPLOYING, access: DOMAIN)
- **資料庫**：Google Sheets (試算表)
- **檔案儲存**：Google Drive (用於儲存產出的 PDF 與試算表報表)
- **報表引擎**：支援 HTML, GOOGLE_DOCS 與 GOOGLE_SHEETS 三種 Renderer PDF 輸出
- **時區**：固定為 `Asia/Taipei` (台北時區)
- **語系**：繁體中文 (Traditional Chinese)

---

## 專案開發階段

* **Project Status**：Alpha / Pre-UAT
* **開發進度**：
  - **Phase 0：規格與專案骨架**：完成
  - **Phase 1：初始化與權限**：完成
  - **Phase 2：班級與學生名冊**：完成
  - **Phase 3：每日停餐登記**：完成
  - **Phase 4：每日餐數統計**：完成
  - **Phase 5：補助規則與月結**：整合修正中
  - **Phase 6：報表與歸檔**：報表原型開發中
  - **Phase 6.5：Pre-UAT 修正中**：修正中
  - **UAT**：尚未完成
  - **Production**：尚未驗證

---

## 🧪 系統驗證與自動化測試
本專案提供自動化測試套件 `TestRunner.gs`。
為了安全起見，所有測試僅允許在 `TEST` 模式下進行。執行測試前必須確保已在指令碼屬性中設定：
* `TEST_SPREADSHEET_ID`：獨立且名稱包含 "TEST" 標籤的測試試算表。
* `TEST_REPORT_FOLDER_ID`：獨立的測試資料夾 ID。
* `TEST_TEMPLATE_DOC_ID` & `TEST_TEMPLATE_SHEET_ID` (非必填，若未填寫則部分 Docs/Sheets 報表測試將自動 skipped，不會假裝 passed)。
