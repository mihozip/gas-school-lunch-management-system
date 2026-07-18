# 上線前自我檢查檢核表 (docs/deployment/go-live-checklist.md)

本檢核表供系統部署人員與最高管理員於正式環境（Production）發布與對外開放前，逐項核對以防遺漏。

---

## 🔍 上線前核對項目 (Go-Live Checklist)

### 1. 安全防護與環境隔離
* **[ ] 環境隔離設定**：Script Properties 中的 `ENVIRONMENT` 屬性明確設定為 `PRODUCTION`。
* **[ ] 測試資料防護**：確認 `TEST_SPREADSHEET_ID` 與 `DATABASE_SPREADSHEET_ID` 為完全不同的 ID。
* **[ ] 網域限制存取**：`ALLOWED_DOMAIN` 設為學校正式的 Google Workspace 網域，禁止外部一般 Gmail 登入。
* **[ ] 初始化系統管理員**：`BOOTSTRAP_ADMIN_EMAIL` 已填入正式經授權的系統管理員信箱。

### 2. 資料庫初始化與 Schema 核對
* **[ ] 工作表數目確認**：執行初始化精靈後，試算表中確實建立 **29 張工作表**。
* **[ ] Header 凍結與格式**：每一張工作表的第一行（Header Row）均被設定為「凍結行」，防止捲動混淆。
* **[ ] 系統預設變數寫入**：`SystemConfig` 中包含 `DEFAULT_MEAL_PRICE`、`DAILY_CONFIRM_DEADLINE`、`ROUNDING_RULE` 與 `ROUNDING_MODE`。

### 3. 功能就緒性與 UAT 通過
* **[ ] 105 項測試 Passed**：在 UAT/TEST 試算表上執行的全功能測試結果為 $105/105$ Passed。
* **[ ] 報表範本 Approved**：已上傳並核准 (status = `approved`) 三種基本報表範本規格。
* **[ ] 職務分離設定確認**：`REQUIRE_SEPARATE_CLOSING_VALIDATOR`、`REQUIRE_SEPARATE_CLOSING_CLOSER` 已依據學校會計內部稽核需求開啟或關閉。

---

## ✍️ 部署核可簽署

* **部署執行人員**：_________________ (簽名)  日期：2026 年 ___ 月 ___ 日
* **最高系統管理員**：_________________ (簽名)  日期：2026 年 ___ 月 ___ 日
