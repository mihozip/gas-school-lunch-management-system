# 貢獻指南 (CONTRIBUTING.md)

感謝您對本系統的關注與支持！為了保持代碼品質與保障個資安全，在提交 Pull Request (PR) 前，請遵循本貢獻指南。

---

## 🛠️ 開發與貢獻流程

1. **Fork 本儲存庫**並複製到您的帳戶。
2. **建立 Feature 分支**：
   ```bash
   git checkout -b feature/your-awesome-feature
   ```
3. **詳細閱讀開發說明書**：修改前請務必參閱專案根目錄下的 [AGENTS.md](AGENTS.md) 了解系統工作表規格與架構設計。
4. **安裝依賴（無副作用）**：
   ```bash
   npm ci
   ```
5. **進行代碼修改**：
   * 後端代碼修改請寫於 `src/backend/` 下。
   * 前端代碼修改請寫於 `src/frontend/` 下。
6. **執行本地靜態檢查與 Dry-run**：
   ```bash
   # 檢查部署指令語意正確性
   bash -n deploy.sh
   
   # 進行零副作用的模擬部署
   npm run deploy:dry-run
   ```
7. **確認不含敏感檔案**：
   請確認您**沒有**將以下檔案加入 Git Staging Area：
   * `.clasp.json`
   * `.clasprc.json`
   * `.deploy/`
   * 真實的 Google 試算表 ID 或 Drive Folder ID。
8. **提交 PR 描述格式**：
   PR 的標題與內文請清晰說明所解決的問題、影響的檔案以及您的 UAT 測試驗證方式。

---

## ⚠️ 貢獻禁止事項

* 🛑 **嚴禁提交任何真實學生個資與學校運作資料**。
* 🛑 **嚴禁將 Google OAuth 金鑰或 Refresh Token 簽入 Git 記錄中**。
* 🛑 **嚴禁在沒有 Dry-run 通過的情況下直接發起 PR**。
