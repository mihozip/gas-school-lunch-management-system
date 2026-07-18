/**
 * MoneyService.gs
 * 財務整數運算與精度控制服務 (Phase 4.5)
 */

var MoneyService = (function() {

  var SAFE_MAX = Number.MAX_SAFE_INTEGER || 9007199254740991;
  var SAFE_MIN = Number.MIN_SAFE_INTEGER || -9007199254740991;

  function getMoneyScale() {
    var scale = Config.get('MONEY_SCALE');
    return scale !== undefined && scale !== null ? parseInt(scale, 10) : 2;
  }

  function getRateScale() {
    var scale = Config.get('RATE_SCALE');
    return scale !== undefined && scale !== null ? parseInt(scale, 10) : 10000;
  }

  function getRoundingMode() {
    return Config.get('ROUNDING_MODE') || 'HALF_UP';
  }

  function validateMinorAmount(minorAmt) {
    if (typeof minorAmt !== 'number' || isNaN(minorAmt)) {
      throw new Error('🛑 財務錯誤：金額必須為數值類型。');
    }
    if (minorAmt > SAFE_MAX || minorAmt < SAFE_MIN) {
      var err = new Error('🛑 財務錯誤：金額超出安全整數範圍。');
      err.code = 'MONEY_AMOUNT_OUT_OF_SAFE_RANGE';
      throw err;
    }
  }

  /**
   * 元轉 Minor Units (整數)
   */
  function yuanToMinor(yuan) {
    if (yuan === undefined || yuan === null || yuan === '') return 0;
    var num = typeof yuan === 'number' ? yuan : parseFloat(String(yuan).replace(/,/g, ''));
    if (isNaN(num)) return 0;
    var scale = getMoneyScale();
    var factor = Math.pow(10, scale);
    var minor = Math.round(num * factor);
    validateMinorAmount(minor);
    return minor;
  }

  /**
   * Minor Units (整數) 轉元 (浮點數)
   */
  function minorToYuan(minor) {
    if (minor === undefined || minor === null) return 0;
    var m = parseInt(minor, 10);
    validateMinorAmount(m);
    var scale = getMoneyScale();
    var factor = Math.pow(10, scale);
    return m / factor;
  }

  function parseMoney(strOrNum) {
    return yuanToMinor(strOrNum);
  }

  /**
   * 格式化 Minor Units 為字串
   */
  function formatMoney(minor) {
    var yuan = minorToYuan(minor);
    var scale = getMoneyScale();
    return yuan.toFixed(scale);
  }

  /**
   * 補助比例轉為 Basis Points (整數，如 50% -> 5000)
   */
  function rateToBasisPoints(rate) {
    if (rate === undefined || rate === null || rate === '') return 0;
    var num = parseFloat(rate);
    if (isNaN(num)) return 0;
    
    // 如果費率大於 1，判定為百分比數值 (如 50 代表 50%)，否則判定為小數 (如 0.5)
    var isPercentageFormat = num > 1.0;
    var rateScale = getRateScale();
    
    if (isPercentageFormat) {
      return Math.round((num / 100) * rateScale);
    } else {
      return Math.round(num * rateScale);
    }
  }

  /**
   * 金額 Minor 乘以比例 Basis Points，除以基數 (RATE_SCALE)，依 RoundingMode 取整
   */
  function multiplyMoneyByRate(minorAmt, rateBps) {
    validateMinorAmount(minorAmt);
    var bps = parseInt(rateBps, 10);
    if (isNaN(bps)) bps = 0;
    
    var rateScale = getRateScale();
    var product = minorAmt * bps;
    
    return divideAndRound(product, rateScale, getRoundingMode());
  }

  /**
   * 依指定模式進行整數除法與進位
   */
  function divideAndRound(numerator, denominator, mode) {
    if (denominator === 0) throw new Error('除數不得為 0');
    var q = numerator / denominator;
    var m = mode || getRoundingMode();

    if (m === 'HALF_UP') {
      // 四捨五入
      return Math.round(q);
    } else if (m === 'HALF_EVEN') {
      // 銀行家捨入
      var integerPart = Math.floor(q);
      var remainder = q - integerPart;
      if (remainder === 0.5) {
        return (integerPart % 2 === 0) ? integerPart : integerPart + 1;
      }
      return Math.round(q);
    } else if (m === 'FLOOR') {
      // 無條件捨去
      return Math.floor(q);
    } else if (m === 'CEILING') {
      // 無條件進位
      return Math.ceil(q);
    }
    return Math.round(q);
  }

  /**
   * 依指定 RoundingMode 四捨五入數值
   */
  function applyRoundingMode(value, mode) {
    var m = mode || getRoundingMode();
    if (m === 'HALF_UP') return Math.round(value);
    if (m === 'HALF_EVEN') {
      var integerPart = Math.floor(value);
      var remainder = value - integerPart;
      if (remainder === 0.5) {
        return (integerPart % 2 === 0) ? integerPart : integerPart + 1;
      }
      return Math.round(value);
    }
    if (m === 'FLOOR') return Math.floor(value);
    if (m === 'CEILING') return Math.ceil(value);
    return Math.round(value);
  }

  /**
   * 分配尾差以滿足總額恆等性
   * @param {number} totalMinor 總金額 Minor
   * @param {object[]} allocations 分攤列物件陣列 (需含有 final_amount_minor, raw_amount_before_rounding 等屬性)
   * @param {string} policy 尾差政策 (SELF_PAY, PRIMARY_FUNDER, LARGEST_REMAINDER, DESIGNATED_SOURCE)
   * @param {string} designatedSource 指定來源 (當 policy 為 DESIGNATED_SOURCE 時使用)
   */
  function allocateResidual(totalMinor, allocations, policy, designatedSource) {
    var pol = policy || Config.get('ROUNDING_RESIDUAL_POLICY') || 'SELF_PAY';
    
    // 1. 計算目前已進位後之總和
    var currentSum = sumMinorAmounts(allocations.map(function(x) { return x.final_amount_minor || 0; }));
    var residual = totalMinor - currentSum;
    
    if (residual === 0) return; // 無尾差

    if (pol === 'SELF_PAY') {
      // 尾差全部由 self_pay 承受
      var target = allocations.filter(function(x) { return x.funding_source === 'self_pay'; })[0];
      if (target) {
        target.final_amount_minor += residual;
        target.residual_adjustment_minor = (target.residual_adjustment_minor || 0) + residual;
      } else {
        // 若無自付列，回退至 primary funder 承擔
        fallbackToPrimary(allocations, residual);
      }
    } else if (pol === 'PRIMARY_FUNDER') {
      // 由 priority 最前的補助來源承擔
      fallbackToPrimary(allocations, residual);
    } else if (pol === 'DESIGNATED_SOURCE') {
      // 由指定來源承擔
      var src = designatedSource || Config.get('ROUNDING_RESIDUAL_SOURCE') || 'township';
      var target = allocations.filter(function(x) { return x.funding_source === src; })[0];
      if (target) {
        target.final_amount_minor += residual;
        target.residual_adjustment_minor = (target.residual_adjustment_minor || 0) + residual;
      } else {
        fallbackToPrimary(allocations, residual);
      }
    } else if (pol === 'LARGEST_REMAINDER') {
      // 最大餘數法：按 raw 餘數從大到小排序，將 1 點 minor units 逐一分配 (直到 residual 分配完畢)
      var list = allocations.map(function(x) {
        var raw = x.amount_before_rounding || 0;
        var rounded = x.rounded_amount_minor || 0;
        return {
          alloc: x,
          remainder: raw - rounded
        };
      });

      // 依餘數大小排序 (由大到小)
      list.sort(function(a, b) { return b.remainder - a.remainder; });

      var step = residual > 0 ? 1 : -1;
      var count = Math.abs(residual);
      
  function getCalculationScale() {
    var scale = Config.get('CALCULATION_SCALE');
    return scale !== undefined && scale !== null ? parseInt(scale, 10) : 2;
  }

  function getSettlementScale() {
    var scale = Config.get('SETTLEMENT_SCALE');
    return scale !== undefined && scale !== null ? parseInt(scale, 10) : 0;
  }

  function getSettlementRoundingMode() {
    return Config.get('SETTLEMENT_ROUNDING_MODE') || 'HALF_UP';
  }

  /**
   * 將計算精度 Minor Units 轉換為結算精度 Minor Units
   */
  function convertCalculationToSettlement(calcMinor) {
    validateMinorAmount(calcMinor);
    var calcScale = getCalculationScale();
    var setScale = getSettlementScale();
    var setMode = getSettlementRoundingMode();

    var calcYuan = calcMinor / Math.pow(10, calcScale);
    var setFactor = Math.pow(10, setScale);
    var rawSetVal = calcYuan * setFactor;

    var setMinor = applyRoundingMode(rawSetVal, setMode);
    validateMinorAmount(setMinor);
    return setMinor;
  }

  /**
   * 分配結算精度尾差
   */
  function calculateSettlementResidual(totalSettlementMinor, allocations, policy, designatedSource) {
    var pol = policy || Config.get('ROUNDING_RESIDUAL_POLICY') || 'SELF_PAY';
    
    var currentSum = sumMinorAmounts(allocations.map(function(x) { return x.settlement_amount_minor || 0; }));
    var residual = totalSettlementMinor - currentSum;
    
    if (residual === 0) return;

    if (pol === 'SELF_PAY') {
      var target = allocations.filter(function(x) { return x.funding_source === 'self_pay'; })[0];
      if (target) {
        target.settlement_amount_minor += residual;
        target.settlement_residual_minor = (target.settlement_residual_minor || 0) + residual;
      } else {
        fallbackSettlementToPrimary(allocations, residual);
      }
    } else if (pol === 'PRIMARY_FUNDER') {
      fallbackSettlementToPrimary(allocations, residual);
    } else if (pol === 'DESIGNATED_SOURCE') {
      var src = designatedSource || Config.get('ROUNDING_RESIDUAL_SOURCE') || 'township';
      var target = allocations.filter(function(x) { return x.funding_source === src; })[0];
      if (target) {
        target.settlement_amount_minor += residual;
        target.settlement_residual_minor = (target.settlement_residual_minor || 0) + residual;
      } else {
        fallbackSettlementToPrimary(allocations, residual);
      }
    } else if (pol === 'LARGEST_REMAINDER') {
      // 最大餘數分配
      var list = allocations.map(function(x) {
        var calcYuan = x.calculation_amount_minor / Math.pow(10, getCalculationScale());
        var setFactor = Math.pow(10, getSettlementScale());
        var rawSetVal = calcYuan * setFactor;
        var rounded = Math.floor(rawSetVal);
        return {
          alloc: x,
          remainder: rawSetVal - rounded
        };
      });

      list.sort(function(a, b) { return b.remainder - a.remainder; });

      var step = residual > 0 ? 1 : -1;
      var count = Math.abs(residual);
      
      for (var i = 0; i < count; i++) {
        var targetIndex = i % list.length;
        var targetAlloc = list[targetIndex].alloc;
        targetAlloc.settlement_amount_minor += step;
        targetAlloc.settlement_residual_minor = (targetAlloc.settlement_residual_minor || 0) + step;
      }
    } else {
      fallbackSettlementToPrimary(allocations, residual);
    }

    var finalSum = sumMinorAmounts(allocations.map(function(x) { return x.settlement_amount_minor; }));
    if (finalSum !== totalSettlementMinor) {
      var err = new Error('結算尾差調整未完全解決');
      err.code = 'ROUNDING_RESIDUAL_UNRESOLVED';
      throw err;
    }
  }

  function fallbackSettlementToPrimary(allocations, residual) {
    var priority = ['township', 'county', 'school', 'self_pay', 'other'];
    for (var i = 0; i < priority.length; i++) {
      var target = allocations.filter(function(x) { return x.funding_source === priority[i]; })[0];
      if (target) {
        target.settlement_amount_minor += residual;
        target.settlement_residual_minor = (target.settlement_residual_minor || 0) + residual;
        return;
      }
    }
    if (allocations.length > 0) {
      allocations[0].settlement_amount_minor += residual;
      allocations[0].settlement_residual_minor = (allocations[0].settlement_residual_minor || 0) + residual;
    }
  }

  function reconcileCalculationAndSettlement(allocations, grossCalcMinor, grossSetMinor) {
    var calcSum = sumMinorAmounts(allocations.map(function(x) { return x.calculation_amount_minor || 0; }));
    var setSum = sumMinorAmounts(allocations.map(function(x) { return x.settlement_amount_minor || 0; }));
    
    if (calcSum !== grossCalcMinor) return { valid: false, reason: '計算分攤總額 ($' + calcSum + ') 不等於 Gross 計算總額 ($' + grossCalcMinor + ')' };
    if (setSum !== grossSetMinor) return { valid: false, reason: '結算分攤總額 ($' + setSum + ') 不等於 Gross 結算總額 ($' + grossSetMinor + ')' };
    return { valid: true };
  }

  function formatSettlementAmount(settlementMinor) {
    var scale = getSettlementScale();
    var factor = Math.pow(10, scale);
    var yuan = settlementMinor / factor;
    return yuan.toFixed(scale);
  }

  function fallbackToPrimary(allocations, residual) {
    // 依 township -> county -> school -> self_pay 順序找第一個存在的分攤
    var priority = ['township', 'county', 'school', 'self_pay', 'other'];
    for (var i = 0; i < priority.length; i++) {
      var target = allocations.filter(function(x) { return x.funding_source === priority[i]; })[0];
      if (target) {
        target.final_amount_minor += residual;
        target.residual_adjustment_minor = (target.residual_adjustment_minor || 0) + residual;
        return;
      }
    }
    // 萬一都沒有，直接灌在第一筆
    if (allocations.length > 0) {
      allocations[0].final_amount_minor += residual;
      allocations[0].residual_adjustment_minor = (allocations[0].residual_adjustment_minor || 0) + residual;
    }
  }

  /**
   * 加總 Minor Units
   */
  function sumMinorAmounts(list) {
    var sum = 0;
    list.forEach(function(val) {
      var v = parseInt(val, 10) || 0;
      validateMinorAmount(v);
      sum += v;
    });
    validateMinorAmount(sum);
    return sum;
  }

  return {
    yuanToMinor: yuanToMinor,
    minorToYuan: minorToYuan,
    parseMoney: parseMoney,
    formatMoney: formatMoney,
    rateToBasisPoints: rateToBasisPoints,
    multiplyMoneyByRate: multiplyMoneyByRate,
    divideAndRound: divideAndRound,
    applyRoundingMode: applyRoundingMode,
    allocateResidual: allocateResidual,
    sumMinorAmounts: sumMinorAmounts,
    validateMinorAmount: validateMinorAmount,
    getCalculationScale: getCalculationScale,
    getSettlementScale: getSettlementScale,
    getSettlementRoundingMode: getSettlementRoundingMode,
    convertCalculationToSettlement: convertCalculationToSettlement,
    calculateSettlementResidual: calculateSettlementResidual,
    reconcileCalculationAndSettlement: reconcileCalculationAndSettlement,
    formatSettlementAmount: formatSettlementAmount
  };
})();
