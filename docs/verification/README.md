# 系統驗證與治理證據目錄 (docs/verification/)

本目錄存放各開發階段的測試證據、財務精度檢算報告以及月結關帳（Closing）證據範本。

## 📌 驗證報告與證據清單

1. **Phase 5 驗證報告**
   * [phase_5_verification_report.md](phase_5_verification_report.md)
   * 包含：T1-T55 項實機自動化測試結果、大數據運算效能測試結果、尾差分攤分配、月度對帳平衡與狀態機變更記錄。

2. **測試證據範本**
   * [test-evidence-template.md](test-evidence-template.md)
   * 規定每次執行 `TestRunner.gs` 時產出之自動化測試結果 JSON 的審計要求與欄位格式。

3. **月結核銷證據範本**
   * [closing-evidence-template.md](closing-evidence-template.md)
   * 定義正式月結歸檔封存時，對於 Google Drive 導出包 CSV 雜湊防護、Manifest 完整度及職務分離（Prepared vs Validated vs Closed）的稽核指引。

---
*午餐統計與補助申請系統 - 財務精度與安全控制小組*
