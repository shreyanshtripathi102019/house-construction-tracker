const SHEET_NAMES = {
  SETTINGS: 'Settings',
  CONTRACTORS: 'Contractors',
  EXPENSES: 'Expenses'
};

const SETTINGS_KEYS = {
  TOTAL_BUDGET: 'TOTAL_BUDGET'
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

  const properties = PropertiesService.getScriptProperties();

  if (!properties.getProperty('OWNER_PASSWORD')) {
    properties.setProperty('OWNER_PASSWORD', 'ChangeThisPassword123');
  }

  return {
    success: true,
    spreadsheetId: spreadsheet.getId(),
    spreadsheetUrl: spreadsheet.getUrl(),
    ownerPassword: properties.getProperty('OWNER_PASSWORD')
  };
}

function configureTracker(ownerPassword, uploadFolderId) {
  const properties = PropertiesService.getScriptProperties();

  if (ownerPassword) {
    properties.setProperty('OWNER_PASSWORD', ownerPassword);
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
    const amount = toNumber_(expense.Amount);
    const category = String(expense.Category || 'Miscellaneous');

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

  return {
    totalBudget: toNumber_(settings[SETTINGS_KEYS.TOTAL_BUDGET]),
    summary: summary,
    recentExpenses: sortExpensesDesc_(expenses).slice(0, 5)
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
  const paidTo = String(payload.paidTo || '').trim();
  const screenshotUrl = String(payload.screenshotUrl || '').trim();

  if (!date || !category || !description || !amount || !paymentMode || !paidTo) {
    throw new Error('date, category, description, amount, paymentMode, and paidTo are required.');
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
    new Date().toISOString()
  ]);

  return { success: true };
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
      spreadsheet = SpreadsheetApp.create('House Construction Tracker');
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
  const expensesSheet = ensureSheet_(spreadsheet, SHEET_NAMES.EXPENSES, ['ID', 'Date', 'Category', 'Description', 'Amount', 'PaymentMode', 'PaidTo', 'ScreenshotUrl', 'CreatedAt']);

  settingsSheet.setFrozenRows(1);
  contractorsSheet.setFrozenRows(1);
  expensesSheet.setFrozenRows(1);

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
      CreatedAt: expense.CreatedAt || ''
    };
  });
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
