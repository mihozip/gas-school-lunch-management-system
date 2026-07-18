# 版本變更紀錄 (CHANGELOG.md)

本文件紀錄「學校午餐停餐、用餐統計與補助申請管理系統」的所有版本更新歷程。

---

## [v5.0.0-uat.1] - 2026-07-18
### Added
- 新增 `StudentSubsidyHistory` 第 14 張工作表歷程對照，支援月中補助身分變更。
- 新增 `deploy.sh` 腳本，支援「Script ID 驅動的一鍵自動專案建立與發布 Web App」。
- 新增 `BootstrapService.gs` 狀態機，支援斷線可恢復、冪等性的 UAT/PRODUCTION 資源初始化精靈。
- 新增 `SystemStatus.html` 自動排程 Trigger 一鍵啟用/停用安全機制。
- 新增專案本地依賴鎖定（@google/clasp 3.3.0）與 package.json 指令封裝。
- 新增 MIT License、SECURITY.md 與 CONTRIBUTING.md 開源規範檔案。
- 新增 GitHub Actions CI 靜態自動化稽核工作流。

### Fixed
- 修正 `SchoolDays` 日期重複宣告之資料庫一致性問題。
- 修正金額四捨五入與尾差分攤分配的財務精度計算問題。
- 移除 npm install 自動部署副作用。
