const SPREADSHEET_ID = '1CckA7GkvDRk7QAG1yNJ1KuXTmzDD4L6y-VR_tgOpHrs';

/**
 * GET handler: Returns current lists for the Bot with relations
 */
function doGet(e) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  
  const suppliers = getRowsData(ss, 'proveedores'); // [[Name, Category], ...]
  const items = getRowsData(ss, 'items');           // [[Name, Supplier], ...]
  
  const categories = ['Carne', 'verduleria', 'panaderia', 'lacteos', 'congelados', 'aderezos', 'packaging', 'grafica', 'marketing', 'publicidad', 'envios', 'insumos_cocina', 'limpieza', 'Luz', 'Agua', 'Gas', 'Internet', 'ServicioExterno', 'Online', 'Otros'];

  return success({
    categories,
    suppliers,
    items
  });
}

/**
 * POST handler: Handles recording purchases or adding new metadata
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    
    if (data.action === 'add_supplier') {
      const sheet = getOrCreateSheet(ss, 'proveedores');
      sheet.appendRow([data.name, data.category]); 
      return success({ message: 'Supplier added' });
    }
    
    if (data.action === 'add_item') {
      const sheet = getOrCreateSheet(ss, 'items');
      sheet.appendRow([data.name, data.supplier]);
      return success({ message: 'Item added' });
    }

    // Default: Record Purchase
    const sheet = getOrCreateSheet(ss, 'COMPRASbot');
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Fecha', 'Categoria', 'Proveedor', 'Item', 'Cantidad', 'Precio', 'Subtotal']);
    }

    const argentinaDate = Utilities.formatDate(new Date(), "GMT-3", "dd/MM/yyyy");
    
    // Ensure numbers for correct formatting in Sheets
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

function getRowsData(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 1) return [];
  return sheet.getRange(1, 1, lastRow, 2).getValues();
}

function getOrCreateSheet(ss, name) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

function success(payload) {
  return ContentService.createTextOutput(JSON.stringify({ status: 'success', ...payload }))
    .setMimeType(ContentService.MimeType.JSON);
}
