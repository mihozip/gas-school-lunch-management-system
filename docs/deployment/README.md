# 部署與維運手冊目錄 (docs/deployment/README.md)

本目錄包含本系統「學校午餐停餐、用餐統計與補助申請管理系統」於 UAT 實機測試環境及正式生產環境的部署、驗證、備份還原與回滾手冊。

---

## 📖 指南與清單索引

1. **[UAT 部署與實機驗證指南](uat-deployment-guide.md)**
   * 指引如何建立獨立的 UAT Apps Script 專案、複製 UAT 試算表與設定 Properties。
2. **[正式環境生產部署指南](production-deployment-guide.md)**
   * 指引從 UAT 簽署移轉至正式生產環境的安全操作步驟。
3. **[Script 屬性範本 (Script Properties Template)](script-properties-template.md)**
   * 列出 Properties 變數說明與範例，不得包含任何機密金鑰或真實正式 ID。
4. **[資料庫備份與還原指南](backup-restore-guide.md)**
   * 定期手動與半自動備份試算表、回復指定關帳檔案。
5. **[版本回滾與災難復原演練手冊 (Rollback Runbook)](rollback-runbook.md)**
   * Web App Deployment 回滾、Database 還原的實務步驟。
6. **[上線前自我檢查檢核表 (Go-Live Checklist)](go-live-checklist.md)**
   * 正式上線前的功能與權限安全核對清單。
7. **[上線後維護與定期稽核檢核表 (Post-Deployment Checklist)](post-deployment-checklist.md)**
   * 上線後對帳、對審、與版本稽核。
