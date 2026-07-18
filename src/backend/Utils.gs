/**
 * Utils.gs
 * 系統共用工具與格式化函式
 */

/**
 * 建立標準的 API 回傳格式
 * @param {boolean} success 是否成功
 * @param {object|array} data 回傳數據
 * @param {string} errorCode 錯誤代碼 (僅成功為 false 時有值)
 * @param {string} message 使用者友善的中文錯誤說明 (僅成功為 false 時有值)
 * @param {string} details 詳細錯誤訊息/系統 Exception (僅成功為 false 時有值)
 * @return {object} 標準 API 回傳格式
 */
function createResponse(success, data = null, errorCode = null, message = null, details = null) {
  return {
    success: success,
    data: data,
    error_code: errorCode,
    message: message,
    details: details
  };
}

/**
 * 產生 UUID (v4 相容)
 * @return {string} UUID 字串
 */
function generateUUID() {
  return Utilities.getUuid();
}

/**
 * 將日期物件格式化為 YYYY-MM-DD (時區固定為 Asia/Taipei)
 * @param {Date} date 日期物件
 * @return {string} 格式化日期字串
 */
function formatDate(date) {
  if (!date) return '';
  if (typeof date === 'string') {
    // 若本來就是 YYYY-MM-DD 格式，進行正則檢查後直接回傳
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    date = new Date(date);
  }
  try {
    return Utilities.formatDate(date, 'Asia/Taipei', 'yyyy-MM-dd');
  } catch (e) {
    return '';
  }
}

/**
 * 將日期時間物件格式化為 YYYY-MM-DD HH:mm:ss (時區固定為 Asia/Taipei)
 * @param {Date} date 日期物件
 * @return {string} 格式化日期時間字串
 */
function formatDateTime(date) {
  if (!date) return '';
  if (typeof date === 'string') date = new Date(date);
  try {
    return Utilities.formatDate(date, 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
  } catch (e) {
    return '';
  }
}

/**
 * 針對寫入 Sheets 或匯出 CSV 的字串進行安全過濾，防止公式注入 (Formula Injection)
 * 如果值為字串且以 =、+、-、@ 開頭，自動在前方加上單引號 (')
 * @param {any} val 原始欄位值
 * @return {any} 安全的值
 */
function sanitizeInput(val) {
  if (typeof val === 'string') {
    var str = val.trim();
    if (str.startsWith('=') || str.startsWith('+') || str.startsWith('-') || str.startsWith('@')) {
      return "'" + str;
    }
    return str;
  }
  return val;
}

/**
 * 安全解析 JSON 字串，解析失敗時不崩潰並回傳 null
 * @param {string} str JSON 字串
 * @return {object|null} 解析後的物件或 null
 */
function safeParseJSON(str) {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch (e) {
    return null;
  }
}

/**
 * 檢查是否為有效的 ISO 日期格式 (YYYY-MM-DD)
 * @param {string} dateStr 日期字串
 * @return {boolean} 是否有效
 */
function isValidDateFormat(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && !isNaN(Date.parse(dateStr));
}
