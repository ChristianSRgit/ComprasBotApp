require('dotenv').config();
const axios = require('axios');

console.log('--- DIAGNÓSTICO ---');
console.log('TELEGRAM_TOKEN:', process.env.TELEGRAM_TOKEN ? '✅ Cargado (longitud: ' + process.env.TELEGRAM_TOKEN.length + ')' : '❌ NO ENCONTRADO');
console.log('APPS_SCRIPT_URL:', process.env.APPS_SCRIPT_URL ? '✅ Cargada' : '❌ NO ENCONTRADA');

async function test() {
  if (process.env.APPS_SCRIPT_URL) {
    try {
      console.log('Probando conexión a Apps Script...');
      const res = await axios.get(process.env.APPS_SCRIPT_URL);
      console.log('Respuesta Apps Script:', JSON.stringify(res.data).substring(0, 100) + '...');
    } catch (e) {
      console.error('Error Apps Script:', e.message);
    }
  }
}

test();
