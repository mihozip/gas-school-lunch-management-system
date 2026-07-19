/**
 * Utils.gs
 * 系統共用工具與格式化函式
 */

var Utils = (function() {
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

  /**
   * 補零函式
   * @param {number} num 數字
   * @param {number} size 長度 (預設為 2)
   * @return {string} 補零後的字串
   */
  function padZero(num, size) {
    var s = String(num);
    var len = size || 2;
    while (s.length < len) {
      s = '0' + s;
    }
    return s;
  }

  /**
   * 計算字串的 MD5 雜湊值並回傳 32 字元 16 進位字串
   * @param {string} str 輸入字串
   * @return {string} MD5 雜湊值字串
   */
  function md5(str) {
    if (str === null || str === undefined) return '';
    var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(str), Utilities.Charset.UTF_8);
    var hexStr = '';
    for (var i = 0; i < digest.length; i++) {
      var byteValue = digest[i];
      if (byteValue < 0) byteValue += 256;
      var byteString = byteValue.toString(16);
      if (byteString.length === 1) byteString = '0' + byteString;
      hexStr += byteString;
    }
    return hexStr;
  }

  return {
    createResponse: createResponse,
    generateUUID: generateUUID,
    formatDate: formatDate,
    formatDateTime: formatDateTime,
    sanitizeInput: sanitizeInput,
    safeParseJSON: safeParseJSON,
    isValidDateFormat: isValidDateFormat,
    padZero: padZero,
    md5: md5
  };
})();
