const SPREADSHEET_ID = '1CckA7GkvDRk7QAG1yNJ1KuXTmzDD4L6y-VR_tgOpHrs';

/**
 * GET handler: Returns data from the MAESTRO tab
 */
function doGet(e) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName('MAESTRO');
    
    let masterData = [];
    if (sheet && sheet.getLastRow() > 1) {
      masterData = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
    }

    const categories = ['Carne', 'verduleria', 'panaderia', 'lacteos', 'congelados', 'aderezos', 'packaging', 'grafica', 'marketing', 'publicidad', 'envios', 'insumos_cocina', 'limpieza', 'Luz', 'Agua', 'Gas', 'Internet', 'ServicioExterno', 'Online', 'Otros'];

    return success({
      categories,
      master: masterData // [[Nombre, Categoria, Items], ...]
    });
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * POST handler: Handles recording purchases
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    
    // Default: Record Purchase in COMPRASbot
    const sheet = getOrCreateSheet(ss, 'COMPRASbot');
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Fecha', 'Categoria', 'Proveedor', 'Item', 'Cantidad', 'Precio', 'Subtotal']);
    }

    const argentinaDate = Utilities.formatDate(new Date(), "GMT-3", "dd/MM/yyyy");
    
    const qty = parseFloat(data.quantity) || 0;
    const price = parseFloat(data.price) || 0;
    const subtotal = qty * price;

    sheet.appendRow([
      argentinaDate,
      data.category,
      data.supplier,
      data.item,
      qty,
      price,
      subtotal
    ]);

    return success({ message: 'Purchase recorded' });
      
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// --- Helpers ---

function getOrCreateSheet(ss, name) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

function success(payload) {
  return ContentService.createTextOutput(JSON.stringify({ status: 'success', ...payload }))
    .setMimeType(ContentService.MimeType.JSON);
}
