#!/usr/bin/env bash
# deploy.sh
# 一鍵自動建置/更新部署 Google Apps Script Web App

set -e

# 1. 驗證 Node.js 版本 >= 20
NODE_MAJOR_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_MAJOR_VER" -lt 20 ]; then
  echo "🛑 錯誤 [NODE_VERSION_TOO_OLD]：本系統要求 Node.js 版本必須大於或等於 v20！當前版本：$(node -v)"
  exit 1
fi

CREATE_IF_MISSING=false
SCRIPT_ID_PARAM=""
ENV_PARAM="uat"
FORCE_PUSH=false
OPEN_SCRIPT=false
NO_DEPLOY=false
DRY_RUN=false
REPLACE_DEPLOYMENT=false

# 解析參數
while [[ $# -gt 0 ]]; do
  case $1 in
    --create-if-missing)
      CREATE_IF_MISSING=true
      shift
      ;;
    --script-id)
      SCRIPT_ID_PARAM="$2"
      shift 2
      ;;
    --env)
      ENV_PARAM="$2"
      shift 2
      ;;
    --force)
      FORCE_PUSH=true
      shift
      ;;
    --open)
      OPEN_SCRIPT=true
      shift
      ;;
    --no-deploy)
      NO_DEPLOY=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --replace-deployment)
      REPLACE_DEPLOYMENT=true
      shift
      ;;
    *)
      if [ -z "$SCRIPT_ID_PARAM" ]; then
        SCRIPT_ID_PARAM="$1"
      else
        echo "⚠️ 未知參數: $1"
      fi
      shift
      ;;
  esac
done

# 標準化環境字串
ENV_UPPER=$(echo "${ENV_PARAM}" | tr '[:lower:]' '[:upper:]')
if [ "$ENV_UPPER" != "PRODUCTION" ]; then
  ENV_UPPER="UAT"
fi

# 2. Dry-run 零副作用阻斷分支
if [ "$DRY_RUN" = true ]; then
  echo "🔍 [DRY RUN] 待上傳原始碼檔案狀態："
  FILES_TO_PUSH=$(find src/backend -name "*.gs" && find src/frontend -name "*.html" && echo "appsscript.json")
  echo "--------------------------------------------------"
  echo "${FILES_TO_PUSH}"
  echo "--------------------------------------------------"
  echo "🔍 [DRY RUN] 模擬部署結束。本機檔案無任何變更，未建立任何 Google 資源。"
  exit 0
fi

# 3. 驗證 clasp 授權狀態
STATUS_OUT=$(npx clasp status 2>&1 || true)
if [[ "$STATUS_OUT" == *"No credentials found"* || "$STATUS_OUT" == *"unauthenticated"* ]]; then
  echo "🔑 [CLASP_LOGIN_REQUIRED] clasp 未授權登入，準備引導登入..."
  npx clasp login
  # 再次檢測登入
  STATUS_OUT=$(npx clasp status 2>&1 || true)
  if [[ "$STATUS_OUT" == *"No credentials"* || "$STATUS_OUT" == *"unauthenticated"* ]]; then
    echo "🛑 錯誤 [CLASP_LOGIN_REQUIRED]：未完成 Google 帳號授權，無法繼續部署。"
    exit 1
  fi
fi

# 4. 正式生產環境防誤觸安全鎖
if [ "$ENV_UPPER" == "PRODUCTION" ]; then
  echo "⚠️ 警告：您正發起 [正式生產環境 - PRODUCTION] 的部署作業！"
  read -p "請輸入確認字串 \"DEPLOY TO PRODUCTION\" 以利繼續： " CONFIRM_TXT
  if [ "$CONFIRM_TXT" != "DEPLOY TO PRODUCTION" ]; then
    echo "🛑 錯誤 [PRODUCTION_CONFIRMATION_FAILED]：輸入之確認文字不相符，部署終止！"
    exit 1
  fi
fi

# 5. 判定或自動建立 Script ID
SCRIPT_ID=""
if [ -n "$SCRIPT_ID_PARAM" ]; then
  # 傳入 Script ID
  SCRIPT_ID="$SCRIPT_ID_PARAM"
  echo "✓ 使用指定 Script ID: ${SCRIPT_ID}"
elif [ -f ".clasp.json" ]; then
  # 存在 .clasp.json
  SCRIPT_ID=$(node -e "try { console.log(require('./.clasp.json').scriptId); } catch(e) { console.log(''); }")
  if [ -n "$SCRIPT_ID" ]; then
    echo "✓ 偵測到既有 .clasp.json，使用 Script ID: ${SCRIPT_ID}"
  fi
fi

# 若仍無 Script ID，自動建立新的專案
if [ -z "$SCRIPT_ID" ]; then
  if [ "$CREATE_IF_MISSING" = false ]; then
    echo "🛑 錯誤 [SCRIPT_ID_NOT_FOUND]：找不到 Script ID，且未傳入 --create-if-missing 參數。"
    echo "👉 請以 --script-id <ID> 指定，或加上 --create-if-missing 允許自動建立。"
    exit 1
  fi
  echo "⚙️ 正在自動建立新的 Google Apps Script 專案..."
  DATE_STR=$(date +%Y%m%d_%H%M%S)
  TITLE="學校午餐管理系統-${ENV_UPPER}-${DATE_STR}"
  
  # 僅在臨時目錄進行 create
  rm -rf temp_clasp_create
  mkdir -p temp_clasp_create
  
  CREATE_OUT=$(npx clasp create --title "${TITLE}" --type webapp --rootDir "./temp_clasp_create" 2>&1 || true)
  
  if [[ "$CREATE_OUT" == *"User has not enabled the Apps Script API"* || "$CREATE_OUT" == *"enable"* ]]; then
    echo "🛑 錯誤 [APPS_SCRIPT_API_DISABLED]：建立專案失敗！"
    echo "👉 請點選下方連結開啟 Google Apps Script API 服務設定（切換為『啟用』）："
    echo "   https://script.google.com/home/usersettings"
    rm -rf temp_clasp_create
    exit 1
  fi

  if [ ! -f "temp_clasp_create/.clasp.json" ]; then
    echo "🛑 錯誤 [CREATE_SCRIPT_FAILED]：建立專案失敗！"
    echo "錯誤細節: ${CREATE_OUT}"
    rm -rf temp_clasp_create
    exit 1
  fi

  # 讀取自動生成的 Script ID
  SCRIPT_ID=$(node -e "console.log(require('./temp_clasp_create/.clasp.json').scriptId)")
  rm -rf temp_clasp_create
  
  if [ -z "$SCRIPT_ID" ]; then
    echo "🛑 錯誤 [CREATE_SCRIPT_FAILED]：無法取得新建專案之 Script ID。"
    exit 1
  fi
  
  echo "🎉 專案建立成功！"
  echo "👉 Apps Script 專案名稱: ${TITLE}"
  echo "👉 Script ID: ${SCRIPT_ID}"
fi

# 6. 寫入 .clasp.json 與 .claspignore
cat <<EOF > .clasp.json
{
  "scriptId": "${SCRIPT_ID}",
  "rootDir": "."
}
EOF

cat <<EOF > .claspignore
**/*
!appsscript.json
!src/backend/**/*.gs
!src/frontend/**/*.html
EOF

# 7. 執行 clasp push
echo "📤 正在上傳原始碼至 Google Apps Script (clasp push)..."
if [ "$FORCE_PUSH" = true ]; then
  PUSH_OUT=$(npx clasp push --force 2>&1)
  PUSH_EXIT=$?
else
  PUSH_OUT=$(npx clasp push 2>&1)
  PUSH_EXIT=$?
fi
if [ $PUSH_EXIT -ne 0 ] || [[ "$PUSH_OUT" == *"Error"* || "$PUSH_OUT" == *"failed"* ]]; then
  echo "🛑 錯誤 [PUSH_FAILED]：原始碼上傳失敗！"
  echo "👉 新建立的 Script ID: ${SCRIPT_ID}"
  echo "👉 Apps Script 編輯器網址: https://script.google.com/d/${SCRIPT_ID}/edit"
  echo "👉 請確認權限無誤後執行重試指令: npx clasp push --force"
  exit 1
fi

# 8. 建立線上新版本 (clasp version)
echo "🏷️ 正在建立線上新版本 (clasp version)..."
VERSION_OUT=$(npx clasp version "Auto-deployed by deploy.sh at $(date)" 2>&1)
VERSION_EXIT=$?
VERSION_NUM=$(node -e "const out = process.argv[1]; const m = out.match(/Created version\s+(\d+)/i) || out.match(/Version\s+(\d+)/i); console.log(m ? m[1] : '');" "${VERSION_OUT}")

if [ $VERSION_EXIT -ne 0 ] || [ -z "$VERSION_NUM" ]; then
  echo "🛑 錯誤 [VERSION_CREATION_FAILED]：建立線上版本編號失敗。"
  echo "VERSION_OUT 原始輸出："
  echo "${VERSION_OUT}"
  exit 1
fi

# 9. 建立或更新固定 Deployment，取得固定 Web App URL
WEB_APP_URL=""
DEPLOY_ID=""

if [ "$NO_DEPLOY" = false ]; then
  mkdir -p .deploy
  DEPLOY_FILE=".deploy/uat.json"
  if [ "$ENV_UPPER" == "PRODUCTION" ]; then
    DEPLOY_FILE=".deploy/production.json"
  fi

  if [ "$REPLACE_DEPLOYMENT" = true ]; then
    echo "⚠️ 收到 --replace-deployment 參數，將建立新的部署代替舊部署。"
  elif [ -f "${DEPLOY_FILE}" ]; then
    DEPLOY_ID=$(node -e "try { console.log(require('./${DEPLOY_FILE}').deploymentId); } catch(e) { console.log(''); }")
  fi

  if [ -n "$DEPLOY_ID" ]; then
    echo "🚀 正在更新既有部署 (ID: ${DEPLOY_ID}, 版本: ${VERSION_NUM})...."
    UPDATE_OUT=$(npx clasp redeploy "${DEPLOY_ID}" -V "${VERSION_NUM}" -d "${ENV_UPPER} Deployment Update" 2>&1 || true)
    if [[ "$UPDATE_OUT" == *"Error"* || "$UPDATE_OUT" == *"failed"* ]]; then
      echo "🛑 錯誤 [DEPLOYMENT_UPDATE_FAILED]：更新部署失敗。保留原 deployment ID: ${DEPLOY_ID}"
      echo "細節: ${UPDATE_OUT}"
      exit 1
    fi
  else
    echo "🚀 正在建立新部署 (版本: ${VERSION_NUM})..."
    DEPLOY_OUT=$(npx clasp deploy -V "${VERSION_NUM}" -d "${ENV_UPPER} First Deployment" 2>&1 || true)
    if [[ "$DEPLOY_OUT" == *"Error"* || "$DEPLOY_OUT" == *"failed"* ]]; then
      echo "🛑 錯誤 [DEPLOYMENT_CREATION_FAILED]：建立部署失敗。"
      echo "細節: ${DEPLOY_OUT}"
      exit 1
    fi
    # 抓取 Deployment ID
    DEPLOY_ID=$(node -e "const out = process.argv[1]; const m = out.match(/with deploymentId\s+([A-Za-z0-9_-]+)/i); console.log(m ? m[1] : '');" "${DEPLOY_OUT}")
  fi

  # 從 npx clasp deployments 讀取 Web App URL，並對應目前的 DEPLOY_ID
  DEPLOYMENTS_LIST=$(npx clasp deployments 2>&1 || true)
  WEB_APP_URL=$(node -e "
    const out = process.argv[1];
    const depId = process.argv[2];
    const lines = out.split('\n');
    let foundUrl = '';
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(depId)) {
        for (let j = i; j < Math.min(i + 5, lines.length); j++) {
          const m = lines[j].match(/(https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec)/i);
          if (m) {
            foundUrl = m[1];
            break;
          }
        }
      }
      if (foundUrl) break;
    }
    console.log(foundUrl);
  " "${DEPLOYMENTS_LIST}" "${DEPLOY_ID}")

  if [ -z "$WEB_APP_URL" ]; then
    WEB_APP_URL="https://script.google.com/macros/s/${DEPLOY_ID}/exec"
  fi

  # 驗證 DEPLOY_ID 非空且格式正確
  if [ -z "$DEPLOY_ID" ]; then
    echo "🛑 錯誤 [DEPLOYMENT_ID_NOT_FOUND]：部署 ID 為空，無法完成部署。"
    exit 1
  fi

  if ! [[ "$DEPLOY_ID" =~ ^[A-Za-z0-9_-]+$ ]]; then
    echo "🛑 錯誤 [DEPLOYMENT_ID_INVALID_FORMAT]：部署 ID 格式不合規：${DEPLOY_ID}"
    exit 1
  fi

  if ! [[ "$WEB_APP_URL" =~ ^https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec$ ]]; then
    echo "⚠️ 警告 [WEB_APP_URL_MISMATCH]：Web App URL 格式異常：${WEB_APP_URL}"
  fi

  # 保存部署狀態 (原子操作：先寫入臨時檔案，再 mv 覆蓋)
  DEPLOYED_AT=$(date +"%Y-%m-%d %H:%M:%S")
  cat <<EOF > "${DEPLOY_FILE}.tmp"
{
  "environment": "${ENV_UPPER}",
  "scriptId": "${SCRIPT_ID}",
  "deploymentId": "${DEPLOY_ID}",
  "webAppUrl": "${WEB_APP_URL}",
  "versionNumber": ${VERSION_NUM},
  "deployedAt": "${DEPLOYED_AT}",
  "claspVersion": "3.3.0"
}
EOF
  mv "${DEPLOY_FILE}.tmp" "${DEPLOY_FILE}"

  # 遮罩處理
  MASKED_SCRIPT_ID="${SCRIPT_ID:0:4}****${SCRIPT_ID: -4}"
  MASKED_DEPLOY_ID="${DEPLOY_ID:0:4}****${DEPLOY_ID: -4}"

  echo "=================================================="
  echo "🎉 ${ENV_UPPER} 環境部署成功完成！"
  echo "=================================================="
  echo "👉 Apps Script 專案名稱: 學校午餐管理系統-${ENV_UPPER}-${VERSION_NUM}"
  echo "👉 Script ID 遮罩值: ${MASKED_SCRIPT_ID}"
  echo "👉 Apps Script 編輯器網址: https://script.google.com/d/${SCRIPT_ID}/edit"
  echo "👉 deployment ID 遮罩值: ${MASKED_DEPLOY_ID}"
  echo "👉 Web App /exec URL: ${WEB_APP_URL}"
  echo "👉 environment: ${ENV_UPPER}"
  echo "👉 deployment version: ${VERSION_NUM}"
  echo "=================================================="
fi

# 10. 自動開啟編輯器
if [ "$OPEN_SCRIPT" = true ]; then
  npx clasp open-script
fi
