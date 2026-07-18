# UAT 獨立環境部署與實機驗證指南 (docs/deployment/uat-deployment-guide.md)

本文件指引如何使用「Script ID 驅動的一鍵部署」與「自動 Bootstrap Wizard」快速安裝 UAT (User Acceptance Testing) 測試環境。

---

## 一、部署前準備

在開始前，您只需要：
1. **Google 帳號**：確保您擁有學校網域 (Google Workspace) 的帳號權限。
2. **安裝 Node.js / npm**：確保本機終端機可執行 `npx` 命令。
3. **建立一個線上 Google Apps Script 專案**：
   * 前往 [Google Apps Script 官網](https://script.google.com/)。
   * 點選「新專案 (New Project)」，並為專案命名（例如：`學校午餐 UAT`）。
   * 點選專案設定 (齒輪圖示)，複製此專案的 **Script ID**。
4. **登入 clasp**：
   * 於本機專案根目錄下，開啟終端機執行下方指令進行 Google 帳號授權登入：
     ```bash
     npx @google/clasp login
     ```

---

## 二、一鍵部署指令 (clasp push & deploy)

在專案根目錄下，執行 deploy 腳本並帶入您的 Script ID：

```bash
./deploy.sh "您的_APPS_SCRIPT_ID"
```

### 腳本執行工作內容：
1. **安全檢查**：檢查 clasp 是否已登入。
2. **設定檔生成**：自動建立 `.clasp.json` 並寫入目標 Script ID。
3. **檔案過濾**：自動建立 `.claspignore`，過濾並僅上傳後端代碼與前端 HTML。
4. **代碼推送**：上傳原始碼至 Google Apps Script 雲端編輯器中。
5. **發布與部署**：自動在雲端產生新版本，並部署為「網頁應用程式 (Web App)」。
6. **輸出網址**：終端機將會顯示部署成功資訊與 UAT 的 `/exec` URL。

---

## 三、一鍵 Bootstrap 系統初始化 (無痛建置)

當您首次在瀏覽器中開啟 `/exec` 網址時，系統會自動偵測到尚未初始化，並為您顯示 **Bootstrap Wizard** 初始化精靈：

1. **OAuth 授權**：首次開啟時，Google 會要求授權讀取您的 Drive、Sheets、Docs 與 Script Properties，請點選核准。
2. **確認自動規劃資源**：系統會列出即將在您的 Google 帳戶下自動生成的資源：
   * 正式午餐管理資料庫 (Spreadsheet)
   * 測試午餐對帳沙盒 (Spreadsheet)
   * 午餐管理報表根目錄 (Drive Folder)
   * 測試報告歸檔子目錄 (Drive Folder)
3. **設定學校基本資訊**：
   * 學校名稱（預設：`水月國民小學`）
   * 當前學年度（預設：`115`）
   * 預設每餐金額（預設：`60` 元）
4. **設定管理員名稱**：
   * 填寫您的真實姓名，系統會自動指派您的登入 Email 為第一位 `system_admin` 最高管理員。
5. **啟動一鍵建置**：
   * 點選「開始一鍵初始化」。
   * **後端自動化行為**：系統將自動建立上述試算表與資料夾，寫入 Script Properties，建構 **29 張資料庫工作表與 Headers**，凍結首行，並匯入預設補助規則與 approved 報表範本。
6. **建置完成**：
   * 完成後點選「進入系統」，即可開始使用全功能 UAT 系統。
