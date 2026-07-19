/**
 * DailyMealCalculationService.gs
 * 每日餐數與用餐資格運算核心服務 (Phase 4)
 */

var DailyMealCalculationService = (function() {

  /**
   * 計算特定日期的用餐帳冊與餐數統計
   */
  function calculateDate(dateStr) {
    return calculateDateRange(dateStr, dateStr, 'daily');
  }

  /**
   * 批次計算日期區間的用餐帳冊與餐數統計
   */
  function calculateDateRange(startDate, endDate, runType) {
    AuthService.requireAnyRole(['system_admin', 'lunch_admin']);
    var identity = AuthService.getCurrentIdentity();
    var currentDateTime = Utils.formatDateTime(new Date());
    var type = runType || 'date_range';

    // 取得 ScriptLock，防範並行運算衝突
    return LockServiceHelper.runWithLock(function() {
      // 1. 驗證日曆日期唯一性 (防範重複日期 blocking 錯誤)
      var dupSchoolDays = SchoolDaysService.findDuplicateSchoolDays();
      if (dupSchoolDays.length > 0) {
        throw new Error('🛑 日曆資料異常：偵測到日曆中有重複日期設定：' + dupSchoolDays.join(', ') + '，禁止執行統計計算！');
      }

      // 2. 產生起訖區間的來源資料 hash
      var beforeHash = calculateSourceHash(startDate, endDate);
      
      // 檢查是否已有相同區間、相同來源 Hash 且已完成的計算
      var existingRun = findCompletedRunByHash(startDate, endDate, beforeHash);
      if (existingRun) {
        return {
          success: true,
          runId: existingRun.calculation_run_id,
          version: existingRun.calculation_version,
          message: '資料來源未變更，沿用既有計算版本 ' + existingRun.calculation_version,
          issuesCount: existingRun.issue_count,
          ledgerCount: existingRun.ledger_count
        };
      }

      // 3. 決定新版號
      var nextVersion = determineNextVersion(startDate, endDate);
      var runId = 'RUN_' + new Date().getTime() + '_' + Math.floor(Math.random() * 1000);

      // 4. 建立 CalculationRun 紀錄
      var runRecord = {
        calculation_run_id: runId,
        calculation_type: type,
        scope_start_date: startDate,
        scope_end_date: endDate,
        target_month: startDate.substring(0, 7),
        calculation_version: nextVersion,
        status: 'running',
        source_hash: beforeHash,
        source_record_count: 0,
        ledger_count: 0,
        summary_count: 0,
        issue_count: 0,
        started_by: identity.email,
        started_at: currentDateTime,
        completed_at: '',
        failed_at: '',
        error_code: '',
        error_message: '',
        previous_run_id: getLatestRunId(startDate, endDate) || '',
        superseded_by_run_id: '',
        is_current: false,
        note: '運算區間：' + startDate + ' ~ ' + endDate
      };
      SheetRepository.appendRecord('CalculationRuns', runRecord);

      var issues = [];
      var ledgers = [];
      var summaries = [];

      try {
        // 運算主要邏輯
        var currentDate = new Date(startDate);
        var endLimit = new Date(endDate);
        
        while (currentDate <= endLimit) {
          var dateStr = Utils.formatDate(currentDate);
          
          // 取得該日的所有學生判定帳冊
          var dailyLedgers = buildStudentLedgers(dateStr, runId, nextVersion, issues);
          ledgers = ledgers.concat(dailyLedgers);
          
          currentDate.setDate(currentDate.getDate() + 1);
        }

        // 檢查是否有任何 blocking issue 被寫入
        var hasBlocking = issues.some(function(iss) { return iss.severity === 'blocking'; });

        // 運算結束前再次產生 hash 以防過程中資料異動
        var afterHash = calculateSourceHash(startDate, endDate);
        if (beforeHash !== afterHash) {
          var err = new Error('計算中途資料來源發生變更，請重新執行。');
          err.code = 'CALCULATION_SOURCE_CHANGED_DURING_RUN';
          throw err;
        }

        if (hasBlocking) {
          // 寫入 issues
          issues.forEach(function(iss) { SheetRepository.appendRecord('CalculationIssues', iss); });
          
          // 更新 CalculationRuns 為 failed
          runRecord.status = 'failed';
          runRecord.failed_at = currentDateTime;
          runRecord.error_code = 'BLOCKING_ISSUES_FOUND';
          runRecord.error_message = '偵測到阻斷性資料錯誤，禁止寫入正式餐數帳冊！';
          runRecord.issue_count = issues.length;
          SheetRepository.upsertRecord('CalculationRuns', 'calculation_run_id', runId, runRecord);
          
          throw new Error('運算完成但含有阻斷性錯誤 (Blocking Issues)，統計結果未寫入正式 Summary。');
        }

        // 5. 計算順利通過，開始寫入 DailyMealLedger 帳冊
        ledgers.forEach(function(l) {
          SheetRepository.appendRecord('DailyMealLedger', l);
        });

        // 6. 依據 Ledger 彙總 DailyMealSummary
        var aggregatedSummaries = aggregateSummariesFromLedgers(ledgers, runId, nextVersion);
        
        // 寫入 DailyMealSummary (將舊版設為 is_current = false)
        writeDailyMealSummaries(aggregatedSummaries, startDate, endDate);
        
        // 寫入 Warning Issues
        issues.forEach(function(iss) {
          SheetRepository.appendRecord('CalculationIssues', iss);
        });

        // 7. 更新 CalculationRuns 狀態為 completed
        runRecord.status = issues.length > 0 ? 'completed_with_warning' : 'completed';
        runRecord.completed_at = currentDateTime;
        runRecord.ledger_count = ledgers.length;
        runRecord.summary_count = aggregatedSummaries.length;
        runRecord.issue_count = issues.length;
        runRecord.is_current = true;
        
        // 標記舊版本為 superseded
        if (runRecord.previous_run_id) {
          markPreviousRunSuperseded(runRecord.previous_run_id, runId);
        }

        SheetRepository.upsertRecord('CalculationRuns', 'calculation_run_id', runId, runRecord);

        AuditService.log({
          action: 'CALCULATE_MEAL_COUNT',
          module: 'calculation',
          recordId: runId,
          reason: '順利完成餐數統計，區間：' + startDate + ' ~ ' + endDate + '，產生 Ledger ' + ledgers.length + ' 筆，版本 ' + nextVersion
        });

        return {
          success: true,
          runId: runId,
          version: nextVersion,
          message: '計算成功，版本為 ' + nextVersion,
          issuesCount: issues.length,
          ledgerCount: ledgers.length
        };

      } catch (runErr) {
        // 更新 CalculationRuns 失敗狀態
        runRecord.status = 'failed';
        runRecord.failed_at = currentDateTime;
        runRecord.error_code = runErr.code || 'CALCULATION_ERROR';
        runRecord.error_message = runErr.message;
        SheetRepository.upsertRecord('CalculationRuns', 'calculation_run_id', runId, runRecord);
        
        throw runErr;
      }

    });
  }

  /**
   * 指定日期，對全體學生判定用餐資格，建立 DailyMealLedger 帳冊草稿
   */
  function buildStudentLedgers(dateStr, runId, version, issuesList) {
    var ledgers = [];
    var schoolDay = SchoolDaysService.getSchoolDay(dateStr);
    
    // 檢查是否有 SchoolDays 設定
    if (!schoolDay) {
      // 屬於 blocking issue
      issuesList.push(createIssue(runId, dateStr, '', '', 'DUPLICATE_SCHOOL_DAY', 'blocking', '找不到指定日期的供餐日曆設定。', 'SchoolDays', ''));
      return ledgers;
    }

    var isMealDay = (schoolDay.is_meal_day === true || schoolDay.is_meal_day === 'TRUE');
    var mealPrice = parseFloat(schoolDay.meal_price) || 0;

    // 取得當日所有學生
    var students = SheetRepository.getAllRecords('Students');
    
    students.forEach(function(student) {
      if (student.enabled === false || student.enabled === 'FALSE') return; // 跳過已停用學生帳號本身

      var ledger = {
        ledger_id: 'LEDGER_' + dateStr.replace(/-/g, '') + '_' + student.student_id.substring(0, 8) + '_' + Math.floor(Math.random() * 100),
        calculation_run_id: runId,
        calculation_version: version,
        date: dateStr,
        student_id: student.student_id,
        student_number_snapshot: student.student_number || '',
        student_name_masked: maskName(student.student_name),
        class_id: '',
        class_code_snapshot: '',
        subsidy_category_id: '',
        subsidy_category_snapshot: '',
        dietary_type: student.dietary_type || '葷食',
        meal_day_flag: isMealDay,
        student_active_flag: false,
        class_history_valid_flag: false,
        subsidy_history_valid_flag: false,
        suspension_flag: false,
        suspension_id: '',
        manual_exception_flag: false,
        exception_id: '',
        exclusion_type: 'none',
        exclusion_reason: '',
        eligible_meal_count: 0,
        meal_price_snapshot: mealPrice,
        gross_meal_amount: 0,
        source_hash: '',
        calculation_status: 'draft',
        created_at: Utils.formatDateTime(new Date())
      };

      // 用餐資格檢查流程
      try {
        // 1. 是否為供餐日
        if (!isMealDay) {
          ledger.exclusion_type = 'not_meal_day';
          ledger.exclusion_reason = '非供餐日';
          ledgers.push(ledger);
          return;
        }

        // 2. 學生在籍狀態及入學/轉出日期判斷
        var activeOnDate = StudentService.isStudentActiveOnDate(student, dateStr);
        ledger.student_active_flag = activeOnDate;
        
        if (!activeOnDate) {
          if (student.meal_status === 'transferred' && dateStr >= student.end_date) {
            ledger.exclusion_type = 'transferred';
            ledger.exclusion_reason = '學生已於 ' + student.end_date + ' 轉出';
          } else if (student.meal_status === 'graduated') {
            ledger.exclusion_type = 'graduated';
            ledger.exclusion_reason = '學生已畢業';
          } else {
            ledger.exclusion_type = 'not_active';
            ledger.exclusion_reason = '日期未在入校供餐區間內';
          }
          ledgers.push(ledger);
          return;
        }

        // 3. 回溯班級歷程
        var classHist = getActiveHistoryOnDate('StudentClassHistory', student.student_id, dateStr);
        if (classHist.length === 0) {
          ledger.exclusion_type = 'class_history_missing';
          ledger.exclusion_reason = '缺少該用餐日有效的班級歷程對照';
          issuesList.push(createIssue(runId, dateStr, '', student.student_id, 'MISSING_CLASS_HISTORY', 'blocking', '學生 ' + student.student_name + ' 缺少當日有效的班級對照歷程。', 'StudentClassHistory', ''));
          ledgers.push(ledger);
          return;
        } else if (classHist.length > 1) {
          ledger.exclusion_type = 'invalid_data';
          ledger.exclusion_reason = '資料異常：有多筆有效的班級歷程區間重疊';
          issuesList.push(createIssue(runId, dateStr, '', student.student_id, 'OVERLAPPING_CLASS_HISTORY', 'blocking', '學生 ' + student.student_name + ' 班級歷史對照區間重疊。', 'StudentClassHistory', ''));
          ledgers.push(ledger);
          return;
        }
        
        var currentClassId = classHist[0].class_id;
        var currentClass = SheetRepository.findById('Classes', 'class_id', currentClassId);
        ledger.class_history_valid_flag = true;
        ledger.class_id = currentClassId;
        ledger.class_code_snapshot = currentClass ? currentClass.class_code : 'N/A';

        // 檢查該班級今日是否確認
        var isConfirmed = false;
        var confirmStatus = 'not_started';
        var classConfirm = SheetRepository.findRecords('DailyClassConfirmations', function(x) {
          return x.date === dateStr && x.class_id === currentClassId;
        })[0];
        
        if (classConfirm) {
          confirmStatus = classConfirm.confirm_status;
          if (confirmStatus === 'confirmed' || confirmStatus === 'locked') {
            isConfirmed = true;
          }
        }
        
        if (!isConfirmed) {
          ledger.calculation_status = 'incomplete';
          issuesList.push(createIssue(runId, dateStr, currentClassId, '', 'CLASS_NOT_CONFIRMED', 'warning', '班級 ' + (currentClass ? currentClass.class_name : '') + ' 今日點名尚未確認。', 'DailyClassConfirmations', ''));
        } else {
          ledger.calculation_status = 'completed';
        }

        // 4. 回溯補助歷程
        var subHist = getActiveHistoryOnDate('StudentSubsidyHistory', student.student_id, dateStr);
        if (subHist.length === 0) {
          ledger.exclusion_type = 'subsidy_history_missing';
          ledger.exclusion_reason = '缺少該用餐日有效的補助身分對照';
          issuesList.push(createIssue(runId, dateStr, currentClassId, student.student_id, 'MISSING_SUBSIDY_HISTORY', 'blocking', '學生 ' + student.student_name + ' 缺少當日補助身分歷史對照。', 'StudentSubsidyHistory', ''));
          ledgers.push(ledger);
          return;
        } else if (subHist.length > 1) {
          ledger.exclusion_type = 'invalid_data';
          ledger.exclusion_reason = '資料異常：多筆補助歷程區間重疊';
          issuesList.push(createIssue(runId, dateStr, currentClassId, student.student_id, 'OVERLAPPING_SUBSIDY_HISTORY', 'blocking', '學生 ' + student.student_name + ' 補助歷史對照區間重疊。', 'StudentSubsidyHistory', ''));
          ledgers.push(ledger);
          return;
        }

        ledger.subsidy_history_valid_flag = true;
        ledger.subsidy_category_id = subHist[0].subsidy_category_id;
        var subCat = SheetRepository.findById('SubsidyCategories', 'subsidy_category_id', subHist[0].subsidy_category_id);
        ledger.subsidy_category_snapshot = subCat ? subCat.category_name : '一般學生';

        // 5. 長期停餐判斷
        var activeSuspension = MealSuspensionService.getActiveSuspensionAtDate(student.student_id, dateStr);
        if (activeSuspension) {
          ledger.suspension_flag = true;
          ledger.suspension_id = activeSuspension.suspension_id;
        }

        // 6. 手動登記請假判斷
        var manualException = SheetRepository.findRecords('MealExceptions', function(x) {
          return x.date === dateStr && x.student_id === student.student_id && x.status === 'active';
        })[0];
        if (manualException) {
          ledger.manual_exception_flag = true;
          ledger.exception_id = manualException.exception_id;
        }

        // 7. 長期與手動扣餐合併決策
        if (ledger.suspension_flag) {
          ledger.exclusion_type = 'long_term_suspension';
          ledger.exclusion_reason = '長期停餐扣減：' + (activeSuspension.reason || '無備註');
          ledger.eligible_meal_count = 0;
        } else if (ledger.manual_exception_flag) {
          ledger.exclusion_type = 'manual_exception';
          ledger.exclusion_reason = '導師手動登記未用餐：' + getExceptionTypeName(manualException.exception_type) + ' (' + (manualException.reason || '無備註') + ')';
          ledger.eligible_meal_count = 0;
        } else {
          // 8. 通過所有排除條件，判定供餐！
          ledger.exclusion_type = 'none';
          ledger.exclusion_reason = '';
          ledger.eligible_meal_count = 1;
          ledger.gross_meal_amount = mealPrice;
        }

      } catch (err) {
        ledger.exclusion_type = 'invalid_data';
        ledger.exclusion_reason = '判定程式出錯：' + err.message;
        issuesList.push(createIssue(runId, dateStr, ledger.class_id, student.student_id, 'CALCULATION_ERROR', 'blocking', err.message, 'Students', student.student_id));
      }

      ledgers.push(ledger);
    });

    return ledgers;
  }

  function getActiveHistoryOnDate(tableName, studentId, dateStr) {
    return SheetRepository.findRecords(tableName, function(x) {
      return x.student_id === studentId && 
             x.enabled === true && 
             dateStr >= x.effective_start_date && 
             dateStr <= (x.effective_end_date || '9999-12-31');
    });
  }

  function maskName(name) {
    if (!name) return '';
    if (name.length <= 2) {
      return name.charAt(0) + '○';
    }
    return name.charAt(0) + '○' + name.substring(2);
  }

  function getExceptionTypeName(type) {
    var names = { leave: '事/病/事假', official_leave: '公假', activity: '校外活動', temporary_no_meal: '臨時不供餐' };
    return names[type] || '請假停餐';
  }

  function createIssue(runId, date, classId, studentId, code, severity, msg, srcSheet, srcRecordId) {
    return {
      issue_id: 'ISSUE_' + new Date().getTime() + '_' + Math.floor(Math.random() * 1000),
      calculation_run_id: runId,
      date: date,
      class_id: classId || '',
      student_id: studentId || '',
      issue_code: code,
      severity: severity,
      message: msg,
      source_sheet: srcSheet || '',
      source_record_id: srcRecordId || '',
      status: 'open',
      resolution_note: '',
      resolved_by: '',
      resolved_at: '',
      created_at: Utils.formatDateTime(new Date())
    };
  }

  /**
   * 穩定計算指定日期區間的來源資料 SHA-256 Hash
   */
  function calculateSourceHash(startDate, endDate) {
    var payload = {
      schoolDays: SheetRepository.findRecords('SchoolDays', function(x) {
        return x.date >= startDate && x.date <= endDate;
      }).map(function(x) {
        return { date: x.date, is_meal_day: String(x.is_meal_day), meal_price: Number(x.meal_price), day_type: x.day_type };
      }).sort(function(a,b) { return a.date.localeCompare(b.date); }),
      
      students: SheetRepository.getAllRecords('Students').map(function(x) {
        return { student_id: x.student_id, enabled: String(x.enabled), start_date: x.start_date, end_date: x.end_date, meal_status: x.meal_status };
      }).sort(function(a,b) { return a.student_id.localeCompare(b.student_id); }),
      
      classHistory: SheetRepository.getAllRecords('StudentClassHistory').map(function(x) {
        return { student_id: x.student_id, class_id: x.class_id, start: x.effective_start_date, end: x.effective_end_date, enabled: String(x.enabled) };
      }).sort(function(a,b) { return (a.student_id + a.class_id).localeCompare(b.student_id + b.class_id); }),
      
      subsidyHistory: SheetRepository.getAllRecords('StudentSubsidyHistory').map(function(x) {
        return { student_id: x.student_id, subsidy_category_id: x.subsidy_category_id, start: x.effective_start_date, end: x.effective_end_date, enabled: String(x.enabled) };
      }).sort(function(a,b) { return (a.student_id + a.subsidy_category_id).localeCompare(b.student_id + b.subsidy_category_id); }),
      
      suspensions: SheetRepository.getAllRecords('MealSuspensionPeriods').map(function(x) {
        return { student_id: x.student_id, start: x.effective_start_date, end: x.effective_end_date, status: x.approval_status, enabled: String(x.enabled) };
      }).sort(function(a,b) { return a.student_id.localeCompare(b.student_id); }),
      
      exceptions: SheetRepository.findRecords('MealExceptions', function(x) {
        return x.date >= startDate && x.date <= endDate;
      }).map(function(x) {
        return { date: x.date, student_id: x.student_id, status: x.status, type: x.exception_type };
      }).sort(function(a,b) { return (a.date + a.student_id).localeCompare(b.date + b.student_id); }),
      
      confirmations: SheetRepository.findRecords('DailyClassConfirmations', function(x) {
        return x.date >= startDate && x.date <= endDate;
      }).map(function(x) {
        return { date: x.date, class_id: x.class_id, status: x.confirm_status };
      }).sort(function(a,b) { return (a.date + a.class_id).localeCompare(b.date + b.class_id); }),
      
      config: SheetRepository.getAllRecords('SystemConfig').map(function(x) {
        return { key: x.config_key, value: x.config_value };
      }).sort(function(a,b) { return a.key.localeCompare(b.key); })
    };

    var jsonStr = JSON.stringify(payload);
    var rawHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, jsonStr, Utilities.Charset.UTF_8);
    var hexStr = '';
    for (var i = 0; i < rawHash.length; i++) {
      var byteVal = rawHash[i];
      if (byteVal < 0) byteVal += 256;
      var byteString = byteVal.toString(16);
      if (byteString.length == 1) byteString = '0' + byteString;
      hexStr += byteString;
    }
    return hexStr;
  }

  function findCompletedRunByHash(startDate, endDate, hash) {
    return SheetRepository.findRecords('CalculationRuns', function(x) {
      return x.scope_start_date === startDate && 
             x.scope_end_date === endDate && 
             x.status.indexOf('completed') === 0 && 
             x.source_hash === hash;
    })[0];
  }

  function determineNextVersion(startDate, endDate) {
    var list = SheetRepository.findRecords('CalculationRuns', function(x) {
      return x.scope_start_date === startDate && x.scope_end_date === endDate && x.status.indexOf('completed') === 0;
    });
    if (list.length === 0) return 1;
    var max = 0;
    list.forEach(function(x) {
      var ver = parseInt(x.calculation_version, 10) || 0;
      if (ver > max) max = ver;
    });
    return max + 1;
  }

  function getLatestRunId(startDate, endDate) {
    var list = SheetRepository.findRecords('CalculationRuns', function(x) {
      return x.scope_start_date === startDate && x.scope_end_date === endDate && x.is_current === true;
    });
    return list.length > 0 ? list[0].calculation_run_id : null;
  }

  function markPreviousRunSuperseded(previousRunId, newRunId) {
    var record = SheetRepository.findById('CalculationRuns', 'calculation_run_id', previousRunId);
    if (record) {
      record.is_current = false;
      record.superseded_by_run_id = newRunId;
      record.status = 'superseded';
      SheetRepository.upsertRecord('CalculationRuns', 'calculation_run_id', previousRunId, record);
    }
  }

  /**
   * 依據 Ledger 彙總日餐數，此階段補助金額均為 0 且標示 funding_calculation_status = NOT_CALCULATED
   */
  function aggregateSummariesFromLedgers(ledgers, runId, version) {
    var groups = {};
    
    ledgers.forEach(function(l) {
      if (!l.class_id || !l.subsidy_category_id) return; // 略過無效對照

      var key = l.date + '_' + l.class_id + '_' + l.subsidy_category_id + '_' + l.dietary_type;
      if (!groups[key]) {
        groups[key] = {
          date: l.date,
          class_id: l.class_id,
          subsidy_category_id: l.subsidy_category_id,
          dietary_type: l.dietary_type,
          roster_count: 0,
          inactive_count: 0,
          suspension_count: 0,
          exception_count: 0,
          actual_meal_count: 0,
          meal_price: l.meal_price_snapshot,
          gross_meal_amount: 0,
          calculation_status: l.calculation_status
        };
      }

      var g = groups[key];
      // 統計在籍學生 (roster_count) 規則：
      // roster_count = 當日班級歷程中有效且仍在籍的學生數
      if (l.exclusion_type !== 'not_active' && l.exclusion_type !== 'transferred' && l.exclusion_type !== 'graduated') {
        g.roster_count++;
      } else {
        g.inactive_count++;
      }

      if (l.exclusion_type === 'long_term_suspension') {
        g.suspension_count++;
      } else if (l.exclusion_type === 'manual_exception') {
        g.exception_count++;
      }

      if (l.eligible_meal_count === 1) {
        g.actual_meal_count++;
        g.gross_meal_amount += l.meal_price_snapshot;
      }

      // 如果有任何一筆 ledger 是 incomplete，此 summary 就 incomplete
      if (l.calculation_status === 'incomplete') {
        g.calculation_status = 'incomplete';
      }
    });

    var result = [];
    for (var k in groups) {
      var g = groups[k];
      
      result.push({
        summary_id: 'SUM_' + g.date.replace(/-/g, '') + '_' + Utils.md5(k).substring(0, 8),
        calculation_run_id: runId,
        calculation_version: version,
        date: g.date,
        class_id: g.class_id,
        subsidy_category_id: g.subsidy_category_id,
        dietary_type: g.dietary_type,
        roster_count: g.roster_count,
        inactive_count: g.inactive_count,
        suspension_count: g.suspension_count,
        exception_count: g.exception_count,
        actual_meal_count: g.actual_meal_count,
        meal_price: g.meal_price,
        gross_meal_amount: g.gross_meal_amount,
        confirmation_status: g.calculation_status === 'incomplete' ? 'incomplete' : 'confirmed',
        source_hash: '',
        calculation_status: g.calculation_status,
        calculated_at: Utils.formatDateTime(new Date()),
        calculated_by: AuthService.getCurrentIdentity().email,
        is_current: true,
        township_amount: 0,
        county_amount: 0,
        school_amount: 0,
        self_pay_amount: 0,
        funding_calculation_status: 'NOT_CALCULATED'
      });
    }

    return result;
  }

  /**
   * 寫入 DailyMealSummary，並將舊版設為 is_current = false
   */
  function writeDailyMealSummaries(newSummaries, startDate, endDate) {
    // 1. 將舊的 current 標記為 false
    var oldRecords = SheetRepository.findRecords('DailyMealSummary', function(x) {
      return x.date >= startDate && x.date <= endDate && x.is_current === true;
    });

    oldRecords.forEach(function(r) {
      r.is_current = false;
      SheetRepository.upsertRecord('DailyMealSummary', 'summary_id', r.summary_id, r);
    });

    // 2. 寫入新筆
    newSummaries.forEach(function(s) {
      SheetRepository.appendRecord('DailyMealSummary', s);
    });
  }

  function getCalculationRun(runId) {
    return SheetRepository.findById('CalculationRuns', 'calculation_run_id', runId);
  }

  function listCalculationIssues(filters) {
    return SheetRepository.findRecords('CalculationIssues', function(x) {
      return (!filters.calculation_run_id || x.calculation_run_id === filters.calculation_run_id) &&
             (!filters.status || x.status === filters.status) &&
             (!filters.severity || x.severity === filters.severity);
    });
  }

  /**
   * 解決並核記 Issue
   */
  function resolveCalculationIssue(issueId, resolutionNote) {
    AuthService.requireRole('system_admin');
    var identity = AuthService.getCurrentIdentity();
    var currentDateTime = Utils.formatDateTime(new Date());

    return LockServiceHelper.runWithLock(function() {
      var record = SheetRepository.findById('CalculationIssues', 'issue_id', issueId);
      if (!record) throw new Error('找不到該 Issue：' + issueId);

      var before = JSON.parse(JSON.stringify(record));
      record.status = 'resolved';
      record.resolution_note = resolutionNote || '已由管理員手動修復來源資料';
      record.resolved_by = identity.email;
      record.resolved_at = currentDateTime;

      SheetRepository.upsertRecord('CalculationIssues', 'issue_id', issueId, record);

      AuditService.log({
        action: 'RESOLVE_CALCULATION_ISSUE',
        module: 'calculation',
        recordId: issueId,
        beforeData: before,
        afterData: record,
        reason: '核結運算異常 Issue：' + record.issue_code + ' - ' + record.resolution_note
      });

      return record;
    });
  }

  /**
   * 解決問題後重新計算
   */
  function recalculateAfterResolution(issueId, resolutionNote) {
    var issue = resolveCalculationIssue(issueId, resolutionNote);
    // 觸發重新運算
    return calculateDate(issue.date);
  }

  return {
    calculateDate: calculateDate,
    calculateDateRange: calculateDateRange,
    buildStudentLedgers: buildStudentLedgers,
    calculateSourceHash: calculateSourceHash,
    getCalculationRun: getCalculationRun,
    listCalculationIssues: listCalculationIssues,
    resolveCalculationIssue: resolveCalculationIssue,
    recalculateAfterResolution: recalculateAfterResolution
  };
})();
