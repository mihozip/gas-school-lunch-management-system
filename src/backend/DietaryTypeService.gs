/**
 * DietaryTypeService.gs
 * 膳食類別管理服務
 */

var DietaryTypeService = (function() {

  /**
   * 取得所有膳食類別清單
   * @return {object[]} 類別清單 [{ code, name, enabled, displayOrder }]
   */
  function getDietaryTypes() {
    var raw = Config.getSystemConfig('DIETARY_TYPES', '');
    
    // 如果是 JSON 格式
    if (raw.trim().indexOf('[') === 0) {
      try {
        var list = JSON.parse(raw);
        list.sort(function(a, b) { return (a.displayOrder || 99) - (b.displayOrder || 99); });
        return list;
      } catch (e) {
        // 解析失敗時，退回到逗號分割解析
      }
    }

    // 否則視為逗號分隔字串相容處理
    var items = raw.split(',').filter(Boolean);
    var list = items.map(function(item, index) {
      return {
        code: item.toUpperCase(),
        name: item,
        enabled: true,
        displayOrder: index + 1
      };
    });
    return list;
  }

  /**
   * 新增或變更膳食類別
   */
  function addDietaryType(code, name, displayOrder) {
    AuthService.requireAnyRole(['system_admin', 'lunch_admin']);
    var identity = AuthService.getCurrentIdentity();
    var currentDateTime = Utils.formatDateTime(new Date());

    var list = getDietaryTypes();
    var upperCode = String(code).toUpperCase().trim();

    // 檢查 code 是否重疊
    var existing = list.filter(function(x) { return x.code === upperCode; });
    if (existing.length > 0) {
      // 若已存在，則為更新
      existing[0].name = name;
      existing[0].displayOrder = displayOrder || existing[0].displayOrder;
      existing[0].enabled = true;
    } else {
      list.push({
        code: upperCode,
        name: name,
        enabled: true,
        displayOrder: displayOrder || 99
      });
    }

    list.sort(function(a, b) { return (a.displayOrder || 99) - (b.displayOrder || 99); });
    
    // 寫入 SystemConfig 工作表
    saveDietaryTypesToConfig(list, identity.email, currentDateTime);
    
    AuditService.log({
      action: 'ADD_DIETARY_TYPE',
      module: 'system_config',
      recordId: upperCode,
      afterData: { code: upperCode, name: name },
      reason: '新增膳食類別'
    });

    return list;
  }

  /**
   * 停用膳食類別 (不影響已有學生的舊資料)
   */
  function disableDietaryType(code) {
    AuthService.requireAnyRole(['system_admin', 'lunch_admin']);
    var identity = AuthService.getCurrentIdentity();
    var currentDateTime = Utils.formatDateTime(new Date());

    var list = getDietaryTypes();
    var upperCode = String(code).toUpperCase().trim();

    var target = list.filter(function(x) { return x.code === upperCode; });
    if (target.length === 0) {
      throw new Error('找不到該膳食類別: ' + code);
    }

    target[0].enabled = false;
    saveDietaryTypesToConfig(list, identity.email, currentDateTime);

    AuditService.log({
      action: 'DISABLE_DIETARY_TYPE',
      module: 'system_config',
      recordId: upperCode,
      beforeData: { code: upperCode },
      reason: '停用膳食類別'
    });

    return list;
  }

  /**
   * 內部寫入方法
   */
  function saveDietaryTypesToConfig(list, userEmail, currentDateTime) {
    var jsonStr = JSON.stringify(list);
    
    var record = SheetRepository.findById('SystemConfig', 'config_key', 'DIETARY_TYPES');
    if (record) {
      var updated = JSON.parse(JSON.stringify(record));
      updated.config_value = jsonStr;
      updated.updated_at = currentDateTime;
      updated.updated_by = userEmail;
      SheetRepository.upsertRecord('SystemConfig', 'config_key', 'DIETARY_TYPES', updated);
    } else {
      SheetRepository.appendRecord('SystemConfig', {
        config_key: 'DIETARY_TYPES',
        config_value: jsonStr,
        description: '膳食分類統計細項種類 (JSON)',
        updated_at: currentDateTime,
        updated_by: userEmail
      });
    }

    Config.clearAllCache();
  }

  return {
    getDietaryTypes: getDietaryTypes,
    addDietaryType: addDietaryType,
    disableDietaryType: disableDietaryType
  };
})();
