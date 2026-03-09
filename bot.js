const { Telegraf, Scenes, session, Markup } = require('telegraf');
const axios = require('axios');
require('dotenv').config();

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;

const chunk = (arr, size) => 
  Array.from({ length: Math.ceil(arr.length / size) }, (v, i) =>
    arr.slice(i * size, i * size + size)
  );

const HARDCODED_CATEGORIES = ['Carne', 'verduleria', 'panaderia', 'lacteos', 'congelados', 'aderezos', 'packaging', 'grafica', 'marketing', 'publicidad', 'envios', 'insumos_cocina', 'limpieza', 'Luz', 'Agua', 'Gas', 'Internet', 'ServicioExterno', 'Online', 'Otros'];    
let categories = HARDCODED_CATEGORIES;
let masterData = []; // [[Nombre, Categoria, Items], ...]

async function syncData() {
  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.includes('your_google_apps_script')) return;
  console.log('Sincronizando desde MAESTRO...');
  try {
    const response = await axios.get(APPS_SCRIPT_URL);
    if (response.data && response.data.master) {
      masterData = response.data.master;
      console.log(`✅ Sincronizado: ${masterData.length} proveedores desde MAESTRO`);
      return true;
    }
  } catch (error) {
    console.error('❌ Error sincronizando:', error.message);
    return false;
  }
}

const purchaseWizard = new Scenes.WizardScene(
  'PURCHASE_WIZARD',
  // 1. Category
  async (ctx) => {
    ctx.wizard.state.purchase = {};
    await ctx.reply('📂 Selecciona una CATEGORIA:', Markup.keyboard(chunk(categories, 2)).oneTime().resize());
    return ctx.wizard.next();
  },
  // 2. Supplier (Filtered by Category from MAESTRO Column B)
  async (ctx) => {
    const selectedCategory = ctx.message?.text;
    if (!selectedCategory || selectedCategory.startsWith('/')) return ctx.scene.leave();
    ctx.wizard.state.purchase.category = selectedCategory;
    
    const filteredSuppliers = masterData
      .filter(row => {
        const catValue = row[1] ? row[1].toString().toLowerCase() : '';
        return catValue.split(',').map(c => c.trim()).includes(selectedCategory.toLowerCase());
      })
      .map(row => row[0]);

    const uniqueSuppliers = [...new Set(filteredSuppliers)].filter(Boolean);
    if (uniqueSuppliers.length === 0) {
      await ctx.reply(`❌ No hay proveedores para "${selectedCategory}".`);
      return ctx.scene.leave();
    }
    await ctx.reply(`🏭 Selecciona el PROVEEDOR:`, Markup.keyboard(chunk(uniqueSuppliers, 2)).oneTime().resize());
    return ctx.wizard.next();
  },
  // 3. Item (Filtered by Supplier from MAESTRO Column C)
  async (ctx) => {
    const selectedSupplier = ctx.message?.text;
    if (!selectedSupplier || selectedSupplier.startsWith('/')) return ctx.scene.leave();
    ctx.wizard.state.purchase.supplier = selectedSupplier;

    // Find all items for this supplier across all rows in MAESTRO
    const items = [];
    masterData.forEach(row => {
      if (row[0] && row[0].toString().toLowerCase() === selectedSupplier.toLowerCase()) {
        const rowItems = row[2] ? row[2].toString().split(',').map(i => i.trim()) : [];
        items.push(...rowItems);
      }
    });

    const uniqueItems = [...new Set(items)].filter(Boolean);
    if (uniqueItems.length === 0) {
      await ctx.reply(`❌ No hay items para "${selectedSupplier}".`);
      return ctx.scene.leave();
    }
    await ctx.reply(`🍔 ¿Qué ITEM de ${selectedSupplier}?`, Markup.keyboard(chunk(uniqueItems, 2)).oneTime().resize());
    return ctx.wizard.next();
  },
  // 4. Quantity
  async (ctx) => {
    const text = ctx.message?.text;
    if (!text || text.startsWith('/')) return ctx.scene.leave();
    ctx.wizard.state.purchase.item = text;
    await ctx.reply('🔢 ¿CANTIDAD?');
    return ctx.wizard.next();
  },
  // 5. Price
  async (ctx) => {
    const text = ctx.message?.text;
    if (!text || text.startsWith('/')) return ctx.scene.leave();
    const input = text.replace(/[^0-9.,]/g, '').replace(',', '.');
    if (isNaN(input) || input === '') return ctx.reply('⚠️ Ingresa un NÚMERO.');
    ctx.wizard.state.purchase.quantity = input;
    await ctx.reply('💰 ¿PRECIO TOTAL por unidad?');
    return ctx.wizard.next();
  },
  // 6. Confirm
  async (ctx) => {
    const text = ctx.message?.text;
    if (!text || text.startsWith('/')) return ctx.scene.leave();
    const input = text.replace(/[^0-9.,]/g, '').replace(',', '.');
    if (isNaN(input) || input === '') return ctx.reply('⚠️ Ingresa un NÚMERO.');
    ctx.wizard.state.purchase.price = input;
    const p = ctx.wizard.state.purchase;
    
    await ctx.reply(`Confirmar compra:\n\nCat: ${p.category}\nProv: ${p.supplier}\nItem: ${p.item}\nCant: ${p.quantity}\nPrecio: $${p.price}\nSubtotal: $${(parseFloat(p.quantity) * parseFloat(p.price)).toFixed(2)}\n\n¿Confirmas?`,
      Markup.keyboard(['✅ SI', '❌ NO']).oneTime().resize()
    );
    return ctx.wizard.next();
  },
  // 7. Save
  async (ctx) => {
    const answer = ctx.message?.text;
    if (answer === '✅ SI') {
      const data = ctx.wizard.state.purchase;
      await ctx.reply('⏳ Guardando...', Markup.removeKeyboard());
      try {
        await axios.post(APPS_SCRIPT_URL, data);
        await ctx.reply(`✅ Guardado: ${data.item} - $${data.price}`);
      } catch (e) {
        await ctx.reply('❌ Error al guardar en Sheets.');
      }
    } else {
      await ctx.reply('❌ Compra cancelada.', Markup.removeKeyboard());
    }
    return ctx.scene.leave();
  }
);

const stage = new Scenes.Stage([purchaseWizard]);
bot.use(session());
bot.use(stage.middleware());

bot.command('start', (ctx) => ctx.reply('👋 Usa /new para registrar o /sync para actualizar.', Markup.removeKeyboard()));

bot.command('reset', async (ctx) => { 
  await ctx.scene?.leave(); 
  await ctx.reply('🔄 Sesión reiniciada.', Markup.removeKeyboard()); 
});

bot.command('cancel', async (ctx) => { 
  await ctx.scene?.leave(); 
  await ctx.reply('❌ Acción cancelada.', Markup.removeKeyboard()); 
});

bot.command('new', (ctx) => ctx.scene.enter('PURCHASE_WIZARD'));

bot.command('sync', async (ctx) => {
  const ok = await syncData();
  ctx.reply(ok ? `✅ Sincronizado desde MAESTRO.` : '❌ Error.', Markup.removeKeyboard());
});

const http = require('http');

// ... existing code ...

async function launch() {
  await syncData();
  await bot.launch();
  console.log('🚀 Bot iniciado (Modo MAESTRO)');

  // Simple health-check server for hosting platforms
  const port = process.env.PORT || 3000;
  http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Bot is running!');
  }).listen(port);
  console.log(`📡 Health-check server listening on port ${port}`);
}

launch().catch(err => console.error('❌ Error fatal:', err));
