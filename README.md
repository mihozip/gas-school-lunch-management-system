# 學校午餐停餐、用餐統計與補助申請管理系統

本系統是一套專為學校行政設計的**午餐管理、停餐登記、用餐統計與補助申請**全方位解決方案。系統採用「預設全班用餐、僅登記例外」之核心設計原則，降低導師每日登記行政負擔，並自動化彙整餐數、計算公所與縣府補助金額，最終產出符合審計規範的核章報表與歸檔檔案。

---

## 一鍵安裝

### 系統需求與使用限制
- **Node.js 版本**：v20 以上。
- **Google Apps Script API**：必須啟用服務（請至 [Google Apps Script 使用者設定](https://script.google.com/home/usersettings) 將 API 切換為「啟用」狀態）。
- **帳號限制**：正式營運環境（PRODUCTION）強烈建議使用 **Google Workspace (原 G Suite) 學校網域帳號**；個人 Gmail 帳戶僅供測試與 UAT 驗證使用。
- **OAuth 授權**：第一次啟動及部署時需要授予 Google 雲端資源、雲端硬碟、試算表及 Script 權限。

### 安裝與一鍵部署步驟
1. **下載原始碼並安裝依賴**（注意：`npm ci` 純粹下載本地 package 依賴，**完全不會**觸發部署、登入或資源建立等遠端副作用）：
   ```bash
   git clone <repository-url>
   cd GAS_school_lunch_management_system
   npm ci
   ```
2. **啟動自動化建置**（此命令將開始授權登入、建立線上 Apps Script 專案並推播代碼）：
   ```bash
   npm run setup
   ```

### 首次初始化建置流程
1. **Google 帳號授權登入**：終端機執行 `npm run setup` 時，會自動開啟瀏覽器引導您完成 Google 帳號 clasp 登入授權。
2. **自動建立專案**：授權成功後，Clasp 自動在您的 Google 帳戶下建立名為 `學校午餐管理系統-UAT-{Timestamp}` 的 Web App 專案。
3. **自動部署發布**：系統將本地原始碼 push 上傳，並自動部署 Web App（部署 ID 將保存於本地 `.deploy/uat.json` 以確保未來更新時網址固定）。
4. **開啟引導精靈**：點選終端機輸出之 Web App `/exec` 網址並同意權限，系統會自動開啟「狀態機初始化精靈」。
5. **選擇環境確認**：選擇 **UAT**（或 **PRODUCTION**）環境，設定學校基本設定與管理員姓名，點選「**開始一鍵初始化**」。系統將自動在您的雲端硬碟建立資料表與儲存資料夾，並配置 29 張工作表及 approved 預設範本。

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
- **後端**：Google Apps Script (GAS) Web App
- **資料庫**：Google Sheets (試算表)
- **檔案儲存**：Google Drive (用於儲存產出的 PDF 與試算表報表)
- **報表引擎**：HTML Template 轉 PDF/試算表
- **時區**：固定為 `Asia/Taipei` (台北時區)
- **語系**：繁體中文 (Traditional Chinese)

---

## 專案目錄與 GAS 檔案架構

由於 Google Apps Script 專案在部署時會將所有 `.gs` 與 `.html` 檔案扁平化（Flat Structure），本專案在本地開發時採用清晰的模組化結構，並在推送到 GAS 時維持扁平命名。

### 本地專案結構

```text
GAS_school_lunch_management_system/
├── appsscript.json             # GAS 專案設定檔
├── README.md                   # 專案說明文件
├── AGENTS.md                   # 開發規範與系統詳細設計說明書 (AI Pair Programming 必讀)
│
├── src/
│   ├── backend/                # 後端 Google Apps Script 程式碼 (.gs)
│   │   ├── Code.gs             # Web App 路由入口 (doGet, doPost, API 轉發)
│   │   ├── Config.gs           # 系統常數與 PropertiesService 讀取
│   │   ├── AuthService.gs      # 登入者權限與角色驗證
│   │   ├── SetupService.gs     # 工作表初始化與檢查精靈
│   │   ├── StudentService.gs   # 學生名冊管理與 CSV 匯入
│   │   ├── ClassService.gs     # 班級設定與管理
│   │   ├── MealExceptionService.gs # 每日未用餐登記/停餐管理
│   │   ├── ConfirmationService.gs  # 班級每日確認與重開
│   │   ├── CalculationService.gs   # 核心計算服務 (餐數、金額、補助計算)
│   │   ├── MonthlyClosingService.gs# 月結、鎖定與解除鎖定
│   │   ├── SubsidyRuleService.gs   # 補助身分類別與規則設定
│   │   ├── ReportService.gs    # 報表產生與 Google Drive 歸檔
│   │   ├── AuditService.gs     # 系統操作與異動日誌 (Audit Log)
│   │   ├── SheetRepository.gs  # 試算表資料存取共用層 (CRUD 封裝)
│   │   ├── ValidationService.gs# 後端資料欄位與邏輯驗證
│   │   ├── LockService.gs      # LockService 封裝 (避免同時寫入衝突)
│   │   └── Utils.gs            # 日期、金額格式、UUID 等工具函式
│   │
│   └── frontend/               # 前端網頁介面 (.html)
│       ├── Index.html          # 前端主入口與 SPA 框架
│       ├── Components.html     # 共用 UI 組件 (Navbar, Loading, Dialogs, Toast)
│       ├── Styles.html         # 全域精緻 CSS 樣式與動畫
│       ├── Scripts.html        # 全域 JS 邏輯與 API 呼叫 (google.script.run)
│       │
│       # SPA 子頁面/檢視 (Views)
│       ├── Dashboard.html      # 系統儀表板 (首頁統計與圖表)
│       ├── DailyMealEntry.html # 導師每日登記未用餐介面
│       ├── ClassConfirmation.html # 班級確認狀態監控 (午餐管理員用)
│       ├── StudentManagement.html # 學生名冊與 CSV 匯入管理
│       ├── CalendarManagement.html# 上課日與供餐日曆設定
│       ├── SubsidyRules.html   # 補助身分與補助規則設定
│       ├── MonthlyClosing.html # 月結作業與試算明細
│       ├── Reports.html        # 報表中心 (報表下載與列印)
│       ├── AuditLogs.html      # 異動紀錄查詢
│       ├── SetupWizard.html    # 系統初始化精靈介面
│       ├── SystemStatus.html   # 系統狀態與阻斷性錯誤檢查
│       ├── AuthDiagnostic.html # 登入及權限診斷診斷頁面
│       └── LoginError.html     # 權限不足或未授權錯誤提示頁面
```

---

## 部署與使用說明

本系統將在後續 Phase 完成後提供詳細部署說明。主要部署步驟包含：
1. 建立一個新的 Google 試算表。
2. 開啟擴充功能中的「Apps Script」。
3. 將本專案的所有後端與前端檔案複製至該 Apps Script 專案中。
4. 使用 PropertiesService 設定試算表 ID 與 Google Drive 資料夾 ID。
5. 將專案部署為「網頁應用程式 (Web App)」：
   - 執行身分：存取網頁的使用者 (User accessing the web app)
   - 誰有權限存取：任何人 (Anyone)
6. 首次開啟網頁應用程式時，系統會自動偵測並引導進入「系統初始化精靈」。

---

## 開發階段規劃

- **Phase 0：規格與專案骨架** (完成)
- **Phase 1：初始化與權限** (完成)
- **Phase 2：班級與學生名冊** (完成)
- **Phase 3：每日停餐登記** (完成)
- **Phase 4：每日餐數統計** (完成)
- **Phase 5：補助規則與月結** (完成)
- **Phase 6：報表與歸檔** (本階段：開發中)

---

## 🧪 系統驗證與治理證據
各階段的測試證據、財務精度檢算報告以及月結關帳審計細則已納入版本控制：
* [系統驗證目錄與證據範本](docs/verification/README.md)
* [Phase 5 財務精度與月結治理驗證報告](docs/verification/phase_5_verification_report.md)
* [系統部署與維運手冊目錄](docs/deployment/README.md)
