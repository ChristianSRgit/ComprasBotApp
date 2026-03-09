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
let allSuppliers = [];
let allItems = [];

async function syncData() {
  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.includes('your_google_apps_script')) return;
  console.log('Sincronizando datos desde Sheets...');
  try {
    const response = await axios.get(APPS_SCRIPT_URL);
    if (response.data) {
      const cleanData = (arr) => {
        if (!arr || !Array.isArray(arr)) return [];
        return arr.filter(row => {
          const val = Array.isArray(row) ? row[0] : row;
          return val !== 'Nombre' && val !== 'Item';
        });
      };
      allSuppliers = cleanData(response.data.suppliers);
      allItems = cleanData(response.data.items);
      console.log(`✅ Sincronizado: ${allSuppliers.length} proveedores, ${allItems.length} items`);
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
    const keyboard = chunk(categories, 2);
    await ctx.reply('📂 Selecciona una CATEGORIA:', Markup.keyboard(keyboard).oneTime().resize());
    return ctx.wizard.next();
  },
  // 2. Supplier
  async (ctx) => {
    if (ctx.message.text.startsWith('/')) return ctx.scene.leave();
    const selectedCategory = ctx.message.text;
    ctx.wizard.state.purchase.category = selectedCategory;
    
    const filteredSuppliers = allSuppliers
      .filter(s => {
        const name = Array.isArray(s) ? s[0] : s;
        const cat = Array.isArray(s) ? s[1] : null;
        if (!cat) return true;
        const itemCategories = cat.toString().split(',').map(c => c.trim().toLowerCase());
        return itemCategories.includes(selectedCategory.toLowerCase());
      })
      .map(s => Array.isArray(s) ? s[0] : s);

    const uniqueSuppliers = [...new Set(filteredSuppliers)];
    if (uniqueSuppliers.length === 0) {
      await ctx.reply(`❌ No hay proveedores para "${selectedCategory}".`);
      return ctx.scene.leave();
    }
    await ctx.reply(`🏭 Selecciona el PROVEEDOR:`, Markup.keyboard(chunk(uniqueSuppliers, 2)).oneTime().resize());
    return ctx.wizard.next();
  },
  // 3. Item
  async (ctx) => {
    if (ctx.message.text.startsWith('/')) return ctx.scene.leave();
    const supplier = ctx.message.text;
    ctx.wizard.state.purchase.supplier = supplier;

    const filteredItems = allItems
      .filter(i => {
        const prov = Array.isArray(i) ? i[1] : null;
        if (!prov) return true;
        return prov.toString().toLowerCase() === supplier.toLowerCase();
      })
      .map(i => Array.isArray(i) ? i[0] : i);

    if (filteredItems.length === 0) {
      await ctx.reply(`❌ No hay items para "${supplier}".`);
      return ctx.scene.leave();
    }
    await ctx.reply(`🍔 ¿Qué ITEM de ${supplier}?`, Markup.keyboard(chunk(filteredItems, 2)).oneTime().resize());
    return ctx.wizard.next();
  },
  // 4. Quantity
  async (ctx) => {
    if (ctx.message.text.startsWith('/')) return ctx.scene.leave();
    ctx.wizard.state.purchase.item = ctx.message.text;
    await ctx.reply('🔢 ¿CANTIDAD?');
    return ctx.wizard.next();
  },
  // 5. Price
  async (ctx) => {
    if (ctx.message.text.startsWith('/')) return ctx.scene.leave();
    const input = ctx.message.text.replace(/[^0-9.,]/g, '').replace(',', '.');
    if (isNaN(input) || input === '') return ctx.reply('⚠️ Ingresa un NÚMERO.');
    ctx.wizard.state.purchase.quantity = input;
    await ctx.reply('💰 ¿PRECIO TOTAL por unidad?');
    return ctx.wizard.next();
  },
  // 6. Confirm Step 1
  async (ctx) => {
    if (ctx.message.text.startsWith('/')) return ctx.scene.leave();
    const input = ctx.message.text.replace(/[^0-9.,]/g, '').replace(',', '.');
    if (isNaN(input) || input === '') return ctx.reply('⚠️ Ingresa un NÚMERO.');
    ctx.wizard.state.purchase.price = input;
    const p = ctx.wizard.state.purchase;
    
    await ctx.reply(`Confirmar compra:\n\nCat: ${p.category}\nProv: ${p.supplier}\nItem: ${p.item}\nCant: ${p.quantity}\nPrecio: $${p.price}\nSubtotal: $${(parseFloat(p.quantity) * parseFloat(p.price)).toFixed(2)}\n\n¿Confirmas?`,
      Markup.keyboard(['✅ SI', '❌ NO']).oneTime().resize()
    );
    return ctx.wizard.next();
  },
  // 7. Save to Sheets
  async (ctx) => {
    const answer = ctx.message.text;
    if (answer === '✅ SI') {
      const data = ctx.wizard.state.purchase;
      await ctx.reply('⏳ Guardando...', Markup.removeKeyboard());
      try {
        await axios.post(APPS_SCRIPT_URL, data);
        await ctx.reply(`✅ Guardado: ${data.item} - $${data.price}`);
      } catch (e) {
        console.error('Error saving:', e.message);
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

bot.command('start', (ctx) => ctx.reply('👋 Usa /new para registrar o /sync para actualizar.'));
bot.command('reset', (ctx) => { ctx.scene.leave(); ctx.reply('🔄 Sesión reiniciada.'); });
bot.command('ping', (ctx) => ctx.reply('pong!'));
bot.command('new', (ctx) => ctx.scene.enter('PURCHASE_WIZARD'));
bot.command('sync', async (ctx) => {
  const ok = await syncData();
  ctx.reply(ok ? `✅ Sincronizado.` : '❌ Error.');
});

async function launch() {
  await syncData();
  await bot.launch();
  console.log('🚀 Bot iniciado');
}

launch().catch(err => console.error('❌ Error fatal:', err));
