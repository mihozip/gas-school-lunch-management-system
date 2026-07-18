# Script 屬性配置範本 (docs/deployment/script-properties-template.md)

本文件列出指令碼屬性 (Script Properties) 的完整 Key 清單、說明與示意格式。本範本不包含任何真實的試算表 ID、網域或金鑰。

---

## 📋 指令碼屬性對照表

| 屬性名稱 (Key) | 示意範例 (Placeholder) | 預設值/格式 | 說明 |
| :--- | :--- | :--- | :--- |
| `ENVIRONMENT` | `DEVELOPMENT` \| `TEST` \| `UAT` \| `PRODUCTION` | `DEVELOPMENT` | 指定系統執行環境級別。在 `PRODUCTION` 下將停用測試端點。 |
| `DEPLOYMENT_MODE` | `UAT` \| `PRODUCTION` | `UAT` | 部署模式。 |
| `DATABASE_SPREADSHEET_ID`| `1AbC****XyZ_prod_db_id` | 32-64 字元 Google Sheets ID | 正式午餐管理資料庫試算表的 ID。 |
| `REPORT_ROOT_FOLDER_ID` | `1AbC****XyZ_root_folder_id`| 32-64 字元 Google Drive Folder ID | 用於存放關帳 CSV、Manifest 及 PDF 報表的根目錄 ID。 |
| `TEST_SPREADSHEET_ID` | `1AbC****XyZ_test_db_id` | 32-64 字元 Google Sheets ID | 測試沙盒專用的試算表 ID，必須與 `DATABASE_SPREADSHEET_ID` 不同。 |
| `TEST_REPORT_FOLDER_ID` | `1AbC****XyZ_test_report_folder`| 32-64 字元 Google Drive Folder ID | 用於存放自動化測試產出報告 JSON 的檔案夾 ID。 |
| `ALLOWED_DOMAIN` | `school.example` | `school.example` | 限制存取系統的 Google Workspace 學校網域。 |
| `BOOTSTRAP_ADMIN_EMAIL` | `lunch_secretary@school.example` | - | 系統首次初始化前，允許進入的系統管理員 Email。 |
| `CALCULATION_SCALE` | `2` | `2` | 計算精度保留之小數位數。 |
| `SETTLEMENT_SCALE` | `0` | `0` | 結算精度保留之小數位數 (TWD 元整數)。 |
| `CURRENCY_CODE` | `TWD` | `TWD` | 結算幣別代碼。 |
| `TIMEZONE` | `Asia/Taipei` | `Asia/Taipei` | 系統預設時區。 |

---

## 🔒 安全注意事項

1. **請勿將含有真實生產/UAT 試算表 ID 與管理者 Email 的 Script Properties 簽入程式庫 (Git)**。
2. 開發人員可複製此文件，於各專案的 Google Apps Script 設定頁面中手動逐欄輸入配置。
