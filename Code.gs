const SHEET_NAMES = {
  SETTINGS: 'Settings',
  CONTRACTORS: 'Contractors',
  EXPENSES: 'Expenses'
};

const SETTINGS_KEYS = {
  TOTAL_BUDGET: 'TOTAL_BUDGET'
};

const PROJECT_TITLE = 'House Construction Tracker Final';

const ENTRY_KINDS = {
  DIRECT_EXPENSE: 'DirectExpense',
  ADVANCE_GIVEN: 'AdvanceGiven',
  ADVANCE_SETTLEMENT: 'AdvanceSettlement'
};

function doGet(e) {
  return handleRequest_(e && e.parameter ? e.parameter : {});
}

function doPost(e) {
  const payload = e && e.postData && e.postData.contents
    ? JSON.parse(e.postData.contents)
    : {};
  return handleRequest_(payload);
}

function handleRequest_(payload) {
  try {
    const action = String(payload.action || '').trim();

    switch (action) {
      case 'getContractors':
        return jsonResponse_(getContractors_(payload));
      case 'getContractorPayments':
        return jsonResponse_(getContractorPayments_(payload));
      case 'getSummary':
        return jsonResponse_(getSummary_(payload));
      case 'getExpenses':
        return jsonResponse_(getExpenses_(payload));
      case 'addExpense':
        return jsonResponse_(addExpense_(payload));
      case 'updateExpense':
        return jsonResponse_(updateExpense_(payload));
      case 'deleteExpense':
        return jsonResponse_(deleteExpense_(payload));
      case 'updateBudget':
        return jsonResponse_(updateBudget_(payload));
      case 'addContractor':
        return jsonResponse_(addContractor_(payload));
      case 'uploadImage':
        return jsonResponse_(uploadImage_(payload));
      default:
        throw new Error('Unsupported action.');
    }
  } catch (error) {
    return jsonResponse_({ error: error.message || 'Unexpected server error.' });
  }
}

function bootstrapProject() {
  const spreadsheet = getSpreadsheet_();
  ensureStructure_(spreadsheet);

  return {
    success: true,
    spreadsheetId: spreadsheet.getId(),
    spreadsheetUrl: spreadsheet.getUrl(),
    ownerPasswordConfigured: isOwnerPasswordConfigured_()
  };
}

function configureTracker(ownerPassword, uploadFolderId) {
  const properties = PropertiesService.getScriptProperties();

  if (ownerPassword) {
    properties.setProperty('OWNER_PASSWORD', String(ownerPassword).trim());
  }

  if (uploadFolderId) {
    properties.setProperty('UPLOAD_FOLDER_ID', uploadFolderId);
  }

  return {
    success: true,
    spreadsheetId: getSpreadsheet_().getId(),
    uploadFolderId: properties.getProperty('UPLOAD_FOLDER_ID') || ''
  };
}

function getContractors_(payload) {
  const spreadsheet = getSpreadsheet_();
  const contractors = readSheetObjects_(spreadsheet.getSheetByName(SHEET_NAMES.CONTRACTORS));

  if (payload.secret && payload.secret !== 'PUBLIC') {
    requireOwner_(payload.secret);
  }

  return {
    contractors: contractors.map(function(contractor) {
      return {
        Name: contractor.Name || '',
        Phone: contractor.Phone || '',
        WorkType: contractor.WorkType || '',
        AgreedAmount: toNumber_(contractor.AgreedAmount)
      };
    })
  };
}

function getContractorPayments_(payload) {
  const contractorName = String(payload.contractorName || '').trim();

  if (!contractorName) {
    throw new Error('contractorName is required.');
  }

  const expenses = getAllExpenses_().filter(function(expense) {
    return String(expense.PaidTo || '').trim().toLowerCase() === contractorName.toLowerCase();
  });

  const total = expenses.reduce(function(sum, expense) {
    return sum + toNumber_(expense.Amount);
  }, 0);

  return {
    contractorName: contractorName,
    total: total,
    payments: sortExpensesDesc_(expenses)
  };
}

function getSummary_(payload) {
  requireOwner_(payload.secret);

  const expenses = getAllExpenses_();
  const settings = readSettingsMap_();
  const summary = expenses.reduce(function(accumulator, expense) {
    const entryKind = expense.EntryKind || ENTRY_KINDS.DIRECT_EXPENSE;
    const amount = toNumber_(expense.Amount);
    const category = String(expense.Category || 'Miscellaneous');

    if (entryKind === ENTRY_KINDS.ADVANCE_GIVEN) {
      return accumulator;
    }

    accumulator.total += amount;
    accumulator[category] = (accumulator[category] || 0) + amount;
    return accumulator;
  }, {
    total: 0,
    Contractor: 0,
    Material: 0,
    Equipment: 0,
    Miscellaneous: 0
  });

  const laluAdvanceBalance = expenses.reduce(function(balance, expense) {
    const entryKind = expense.EntryKind || ENTRY_KINDS.DIRECT_EXPENSE;
    const amount = toNumber_(expense.Amount);
    const advanceParty = getAdvanceParty_(expense).toLowerCase();

    if (advanceParty !== 'lalu') {
      return balance;
    }

    if (entryKind === ENTRY_KINDS.ADVANCE_GIVEN) {
      return balance + amount;
    }

    if (entryKind === ENTRY_KINDS.ADVANCE_SETTLEMENT) {
      return balance - amount;
    }

    return balance;
  }, 0);

  return {
    totalBudget: toNumber_(settings[SETTINGS_KEYS.TOTAL_BUDGET]),
    summary: summary,
    recentExpenses: sortExpensesDesc_(expenses).slice(0, 5),
    laluAdvanceBalance: laluAdvanceBalance
  };
}

function getExpenses_(payload) {
  requireOwner_(payload.secret);

  return {
    expenses: sortExpensesDesc_(getAllExpenses_())
  };
}

function addExpense_(payload) {
  requireOwner_(payload.secret);

  const date = String(payload.date || '').trim();
  const category = String(payload.category || '').trim();
  const description = String(payload.description || '').trim();
  const amount = toNumber_(payload.amount);
  const paymentMode = String(payload.paymentMode || '').trim();
  const paidToValue = String(payload.paidTo || '').trim();
  const screenshotUrl = String(payload.screenshotUrl || '').trim();
  const entryKind = String(payload.entryKind || ENTRY_KINDS.DIRECT_EXPENSE).trim();
  const advanceParty = String(payload.advanceParty || '').trim();
  const paidBy = resolvePaidBy_(String(payload.paidBy || '').trim(), entryKind, advanceParty);
  const paidTo = entryKind === ENTRY_KINDS.ADVANCE_GIVEN && advanceParty
    ? advanceParty
    : paidToValue;

  if (!date || !category || !description || !amount || !paymentMode || !paidTo || !paidBy) {
    throw new Error('date, category, description, amount, paymentMode, paidTo, and paidBy are required.');
  }

  if (Object.keys(ENTRY_KINDS).map(function(key) { return ENTRY_KINDS[key]; }).indexOf(entryKind) === -1) {
    throw new Error('Invalid entry type.');
  }

  const sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.EXPENSES);

  sheet.appendRow([
    Utilities.getUuid(),
    date,
    category,
    description,
    amount,
    paymentMode,
    paidTo,
    screenshotUrl,
    new Date().toISOString(),
    paidBy,
    entryKind,
    advanceParty
  ]);

  return { success: true };
}

function updateExpense_(payload) {
  requireOwner_(payload.secret);

  const expenseId = String(payload.expenseId || '').trim();
  const date = String(payload.date || '').trim();
  const category = String(payload.category || '').trim();
  const description = String(payload.description || '').trim();
  const amount = toNumber_(payload.amount);
  const paymentMode = String(payload.paymentMode || '').trim();
  const paidToValue = String(payload.paidTo || '').trim();
  const screenshotUrl = String(payload.screenshotUrl || '').trim();
  const entryKind = String(payload.entryKind || ENTRY_KINDS.DIRECT_EXPENSE).trim();
  const advanceParty = String(payload.advanceParty || '').trim();
  const paidBy = resolvePaidBy_(String(payload.paidBy || '').trim(), entryKind, advanceParty);
  const paidTo = entryKind === ENTRY_KINDS.ADVANCE_GIVEN && advanceParty
    ? advanceParty
    : paidToValue;
  const sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.EXPENSES);
  const rowToUpdate = findExpenseRowById_(sheet, expenseId);

  if (!expenseId) {
    throw new Error('expenseId is required.');
  }

  if (!date || !category || !description || !amount || !paymentMode || !paidTo || !paidBy) {
    throw new Error('date, category, description, amount, paymentMode, paidTo, and paidBy are required.');
  }

  if (Object.keys(ENTRY_KINDS).map(function(key) { return ENTRY_KINDS[key]; }).indexOf(entryKind) === -1) {
    throw new Error('Invalid entry type.');
  }

  if (rowToUpdate === -1) {
    throw new Error('Expense not found.');
  }

  const existingRow = sheet.getRange(rowToUpdate, 1, 1, 12).getValues()[0];
  const createdAt = existingRow[8] || new Date().toISOString();

  sheet.getRange(rowToUpdate, 1, 1, 12).setValues([[
    expenseId,
    date,
    category,
    description,
    amount,
    paymentMode,
    paidTo,
    screenshotUrl,
    createdAt,
    paidBy,
    entryKind,
    advanceParty
  ]]);

  return { success: true };
}

function deleteExpense_(payload) {
  requireOwner_(payload.secret);

  const expenseId = String(payload.expenseId || '').trim();

  if (!expenseId) {
    throw new Error('expenseId is required.');
  }

  const sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.EXPENSES);
  const rowToDelete = findExpenseRowById_(sheet, expenseId);

  if (rowToDelete === -1) {
    throw new Error('Expense not found.');
  }

  sheet.deleteRow(rowToDelete);

  return { success: true };
}

function findExpenseRowById_(sheet, expenseId) {
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    return -1;
  }

  const idValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues();

  for (let index = 0; index < idValues.length; index += 1) {
    if (String(idValues[index][0] || '').trim() === expenseId) {
      return index + 2;
    }
  }

  return -1;
}

function updateBudget_(payload) {
  requireOwner_(payload.secret);
  upsertSetting_(SETTINGS_KEYS.TOTAL_BUDGET, toNumber_(payload.amount));
  return { success: true };
}

function addContractor_(payload) {
  requireOwner_(payload.secret);

  const name = String(payload.name || '').trim();

  if (!name) {
    throw new Error('Contractor name is required.');
  }

  const phone = String(payload.phone || '').trim();
  const workType = String(payload.workType || '').trim();
  const agreedAmount = toNumber_(payload.agreedAmount);
  const sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.CONTRACTORS);
  const values = sheet.getDataRange().getValues();
  let rowToUpdate = -1;

  for (let index = 1; index < values.length; index += 1) {
    if (String(values[index][0] || '').trim().toLowerCase() === name.toLowerCase()) {
      rowToUpdate = index + 1;
      break;
    }
  }

  const rowValues = [name, phone, workType, agreedAmount];

  if (rowToUpdate > 0) {
    sheet.getRange(rowToUpdate, 1, 1, rowValues.length).setValues([rowValues]);
  } else {
    sheet.appendRow(rowValues);
  }

  return { success: true };
}

function uploadImage_(payload) {
  requireOwner_(payload.secret);

  if (!payload.imageData) {
    return { url: '' };
  }

  const mimeType = payload.mimeType || 'image/jpeg';
  const fileName = payload.fileName || ('bill-' + Date.now());
  const bytes = Utilities.base64Decode(payload.imageData);
  const blob = Utilities.newBlob(bytes, mimeType, fileName);
  const folderId = PropertiesService.getScriptProperties().getProperty('UPLOAD_FOLDER_ID');
  const file = folderId
    ? DriveApp.getFolderById(folderId).createFile(blob)
    : DriveApp.createFile(blob);

  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return {
    success: true,
    url: file.getUrl(),
    fileId: file.getId()
  };
}

function getSpreadsheet_() {
  const properties = PropertiesService.getScriptProperties();
  let spreadsheetId = properties.getProperty('SPREADSHEET_ID');
  let spreadsheet;

  if (spreadsheetId) {
    spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  } else {
    spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

    if (!spreadsheet) {
      spreadsheet = SpreadsheetApp.create(PROJECT_TITLE);
    }

    spreadsheetId = spreadsheet.getId();
    properties.setProperty('SPREADSHEET_ID', spreadsheetId);
  }

  ensureStructure_(spreadsheet);
  return spreadsheet;
}

function ensureStructure_(spreadsheet) {
  const settingsSheet = ensureSheet_(spreadsheet, SHEET_NAMES.SETTINGS, ['Key', 'Value']);
  const contractorsSheet = ensureSheet_(spreadsheet, SHEET_NAMES.CONTRACTORS, ['Name', 'Phone', 'WorkType', 'AgreedAmount']);
  const expensesSheet = ensureSheet_(spreadsheet, SHEET_NAMES.EXPENSES, ['ID', 'Date', 'Category', 'Description', 'Amount', 'PaymentMode', 'PaidTo', 'ScreenshotUrl', 'CreatedAt', 'PaidBy', 'EntryKind', 'AdvanceParty']);

  settingsSheet.setFrozenRows(1);
  contractorsSheet.setFrozenRows(1);
  expensesSheet.setFrozenRows(1);
  applyExpenseSheetValidations_(expensesSheet);

  const settings = readSettingsMapFromSheet_(settingsSheet);

  if (settings[SETTINGS_KEYS.TOTAL_BUDGET] === undefined) {
    upsertSetting_(SETTINGS_KEYS.TOTAL_BUDGET, 0, spreadsheet);
  }
}

function ensureSheet_(spreadsheet, name, headers) {
  let sheet = spreadsheet.getSheetByName(name);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
  }

  const currentHeaders = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const hasHeaders = headers.every(function(header, index) {
    return currentHeaders[index] === header;
  });

  if (!hasHeaders) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  return sheet;
}

function applyExpenseSheetValidations_(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const maxRows = Math.max(sheet.getMaxRows() - 1, 1);
  const rulesByHeader = {
    Category: ['Material', 'Contractor', 'Equipment', 'Miscellaneous', 'Advance'],
    PaymentMode: ['UPI', 'Cash', 'Bank Transfer', 'Cheque'],
    PaidBy: ['Shreyansh', 'Rajesh', 'Lalu'],
    EntryKind: [ENTRY_KINDS.DIRECT_EXPENSE, ENTRY_KINDS.ADVANCE_GIVEN, ENTRY_KINDS.ADVANCE_SETTLEMENT],
    AdvanceParty: ['Lalu']
  };

  Object.keys(rulesByHeader).forEach(function(header) {
    const columnIndex = headers.indexOf(header);

    if (columnIndex === -1) {
      return;
    }

    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(rulesByHeader[header], true)
      .setAllowInvalid(true)
      .build();

    sheet.getRange(2, columnIndex + 1, maxRows, 1).setDataValidation(rule);
  });
}

function readSettingsMap_(spreadsheet) {
  const sheet = (spreadsheet || getSpreadsheet_()).getSheetByName(SHEET_NAMES.SETTINGS);
  return readSettingsMapFromSheet_(sheet);
}

function readSettingsMapFromSheet_(sheet) {
  const rows = readSheetObjects_(sheet);
  const map = {};

  rows.forEach(function(row) {
    map[row.Key] = row.Value;
  });

  return map;
}

function upsertSetting_(key, value, spreadsheet) {
  const sheet = (spreadsheet || getSpreadsheet_()).getSheetByName(SHEET_NAMES.SETTINGS);
  const values = sheet.getDataRange().getValues();

  for (let index = 1; index < values.length; index += 1) {
    if (values[index][0] === key) {
      sheet.getRange(index + 1, 2).setValue(value);
      return;
    }
  }

  sheet.appendRow([key, value]);
}

function readSheetObjects_(sheet) {
  const values = sheet.getDataRange().getValues();

  if (values.length <= 1) {
    return [];
  }

  const headers = values[0];

  return values.slice(1).filter(function(row) {
    return row.some(function(cell) {
      return cell !== '' && cell !== null;
    });
  }).map(function(row) {
    const object = {};

    headers.forEach(function(header, index) {
      object[header] = row[index];
    });

    return object;
  });
}

function getAllExpenses_() {
  return readSheetObjects_(getSpreadsheet_().getSheetByName(SHEET_NAMES.EXPENSES)).map(function(expense) {
    return {
      ID: expense.ID || '',
      Date: normalizeDate_(expense.Date),
      Category: expense.Category || '',
      Description: expense.Description || '',
      Amount: toNumber_(expense.Amount),
      PaymentMode: expense.PaymentMode || '',
      PaidTo: expense.PaidTo || '',
      ScreenshotUrl: expense.ScreenshotUrl || '',
      CreatedAt: expense.CreatedAt || '',
      PaidBy: expense.PaidBy || '',
      EntryKind: expense.EntryKind || ENTRY_KINDS.DIRECT_EXPENSE,
      AdvanceParty: expense.AdvanceParty || ''
    };
  });
}

function getAdvanceParty_(expense) {
  return String(expense.AdvanceParty || expense.PaidTo || '').trim();
}

function resolvePaidBy_(paidBy, entryKind, advanceParty) {
  if (entryKind === ENTRY_KINDS.ADVANCE_SETTLEMENT) {
    return String(advanceParty || 'Lalu').trim();
  }

  return String(paidBy || '').trim();
}

function isOwnerPasswordConfigured_() {
  return !!PropertiesService.getScriptProperties().getProperty('OWNER_PASSWORD');
}

function sortExpensesDesc_(expenses) {
  return expenses.slice().sort(function(left, right) {
    return new Date(right.Date + 'T00:00:00').getTime() - new Date(left.Date + 'T00:00:00').getTime();
  });
}

function requireOwner_(secret) {
  const password = PropertiesService.getScriptProperties().getProperty('OWNER_PASSWORD');

  if (!password) {
    throw new Error('OWNER_PASSWORD is not configured in Script Properties.');
  }

  if (!secret || secret !== password) {
    throw new Error('Incorrect owner password.');
  }
}

function normalizeDate_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value)) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  return String(value || '');
}

function toNumber_(value) {
  const number = Number(value || 0);
  return isNaN(number) ? 0 : number;
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
