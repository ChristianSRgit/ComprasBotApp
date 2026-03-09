const { Telegraf, Scenes, Markup, session } = require('telegraf');
const LocalSession = require('telegraf-session-local');
const axios = require('axios');

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;

// Persistence for Serverless
const localSession = new LocalSession({
  database: '/tmp/session.json', // Only writable place in Netlify
  storage: LocalSession.storageFileAsync
});
bot.use(localSession.middleware());

// Helper to chunk arrays for the keyboard
const chunk = (arr, size) => 
  Array.from({ length: Math.ceil(arr.length / size) }, (v, i) =>
    arr.slice(i * size, i * size + size)
  );

const HARDCODED_CATEGORIES = ['Carne', 'verduleria', 'panaderia', 'lacteos', 'congelados', 'aderezos', 'packaging', 'grafica', 'marketing', 'publicidad', 'envios', 'insumos_cocina', 'limpieza', 'Luz', 'Agua', 'Gas', 'Internet', 'ServicioExterno', 'Online', 'Otros'];    
let masterDataCache = null;

async function getMasterData() {
  if (masterDataCache) return masterDataCache;
  try {
    const response = await axios.get(APPS_SCRIPT_URL);
    if (response.data && response.data.master) {
      masterDataCache = response.data.master;
      return masterDataCache;
    }
  } catch (error) {
    console.error('Error fetching master data:', error.message);
  }
  return [];
}

const purchaseWizard = new Scenes.WizardScene(
  'PURCHASE_WIZARD',
  async (ctx) => {
    ctx.wizard.state.purchase = {};
    const keyboard = chunk(HARDCODED_CATEGORIES, 2);
    await ctx.reply('📂 Selecciona una CATEGORIA:', Markup.keyboard(keyboard).oneTime().resize());
    return ctx.wizard.next();
  },
  async (ctx) => {
    const text = ctx.message?.text;
    if (!text || text.startsWith('/')) return ctx.scene.leave();
    ctx.wizard.state.purchase.category = text;
    
    const data = await getMasterData();
    const filteredSuppliers = data
      .filter(row => {
        const catValue = row[1] ? row[1].toString().toLowerCase() : '';
        return catValue.split(',').map(c => c.trim()).includes(text.toLowerCase());
      })
      .map(row => row[0]);

    const uniqueSuppliers = [...new Set(filteredSuppliers)].filter(Boolean);
    if (uniqueSuppliers.length === 0) {
      await ctx.reply(`❌ No hay proveedores para "${text}".`);
      return ctx.scene.leave();
    }
    await ctx.reply(`🏭 Selecciona el PROVEEDOR:`, Markup.keyboard(chunk(uniqueSuppliers, 2)).oneTime().resize());
    return ctx.wizard.next();
  },
  async (ctx) => {
    const text = ctx.message?.text;
    if (!text || text.startsWith('/')) return ctx.scene.leave();
    const supplier = text;
    ctx.wizard.state.purchase.supplier = supplier;

    const data = await getMasterData();
    const items = [];
    data.forEach(row => {
      if (row[0] && row[0].toString().toLowerCase() === supplier.toLowerCase()) {
        const rowItems = row[2] ? row[2].toString().split(',').map(i => i.trim()) : [];
        items.push(...rowItems);
      }
    });

    const uniqueItems = [...new Set(items)].filter(Boolean);
    if (uniqueItems.length === 0) {
      await ctx.reply(`❌ No hay items para "${supplier}".`);
      return ctx.scene.leave();
    }
    await ctx.reply(`🍔 ¿Qué ITEM de ${supplier}?`, Markup.keyboard(chunk(uniqueItems, 2)).oneTime().resize());
    return ctx.wizard.next();
  },
  async (ctx) => {
    const text = ctx.message?.text;
    if (!text || text.startsWith('/')) return ctx.scene.leave();
    ctx.wizard.state.purchase.item = text;
    await ctx.reply('🔢 ¿CANTIDAD?');
    return ctx.wizard.next();
  },
  async (ctx) => {
    const text = ctx.message?.text;
    if (!text || text.startsWith('/')) return ctx.scene.leave();
    const input = text.replace(/[^0-9.,]/g, '').replace(',', '.');
    if (isNaN(input) || input === '') return ctx.reply('⚠️ Ingresa un NÚMERO.');
    ctx.wizard.state.purchase.quantity = input;
    await ctx.reply('💰 ¿PRECIO TOTAL por unidad?');
    return ctx.wizard.next();
  },
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
bot.command('reset', async (ctx) => { await ctx.scene?.leave(); await ctx.reply('🔄 Sesión reiniciada.', Markup.removeKeyboard()); });
bot.command('new', (ctx) => ctx.scene.enter('PURCHASE_WIZARD'));
bot.command('sync', async (ctx) => {
  masterDataCache = null; // Force reload on next wizard
  await getMasterData();
  ctx.reply(`✅ Datos de MAESTRO actualizados.`, Markup.removeKeyboard());
});

// Netlify Function Handler
exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body);
    await bot.handleUpdate(body);
    return { statusCode: 200, body: '' };
  } catch (err) {
    console.error('Bot handleUpdate error:', err);
    return { statusCode: 200, body: '' }; // Always return 200 to Telegram
  }
};
