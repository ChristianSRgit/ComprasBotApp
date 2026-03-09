/**
 * This script should be deployed as a Web App (Executes as 'Me', Anyone has access)
 */

const SPREADSHEET_ID = '1TMOUrr2V6Q90bjCelN7y1Bxy9cWnIQdyZpGA8gczvjo';
const SHEET_NAME = 'COMPRASbot';

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = ss.getSheetByName(SHEET_NAME);
    
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      // Optional: Add headers if sheet is new
      sheet.appendRow(['Fecha', 'Categoria', 'Proveedor', 'Item', 'Cantidad', 'Precio']);
    }

    // Format: DD/MM/YYYY (Argentina Timezone - GMT-3)
    const argentinaDate = Utilities.formatDate(new Date(), "GMT-3", "dd/MM/yyyy");

    sheet.appendRow([
      argentinaDate,
      data.category,
      data.supplier,
      data.item,
      data.quantity,
      data.price
    ]);

    return ContentService.createTextOutput(JSON.stringify({ status: 'success' }))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
