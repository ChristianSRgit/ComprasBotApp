const { Telegraf, Scenes, Markup, session } = require('telegraf');
const axios = require('axios');

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;

// Use standard memory session for serverless (resets on cold starts)
bot.use(session());

const chunk = (arr, size) => 
  Array.from({ length: Math.ceil(arr.length / size) }, (v, i) =>
    arr.slice(i * size, i * size + size)
  );

const HARDCODED_CATEGORIES = ['Carne', 'verduleria', 'panaderia', 'lacteos', 'congelados', 'aderezos', 'packaging', 'grafica', 'marketing', 'publicidad', 'envios', 'insumos_cocina', 'limpieza', 'Luz', 'Agua', 'Gas', 'Internet', 'ServicioExterno', 'Online', 'Otros'];    

let masterDataCache = null;

async function getMasterData() {
  if (masterDataCache) return masterDataCache;
  console.log('Fetching master data from Apps Script...');
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
    if (!text || text.startsWith('/')) { await ctx.scene.leave(); return; }
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
    if (!text || text.startsWith('/')) { await ctx.scene.leave(); return; }
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
    if (!text || text.startsWith('/')) { await ctx.scene.leave(); return; }
    ctx.wizard.state.purchase.item = text;
    await ctx.reply('🔢 ¿CANTIDAD?');
    return ctx.wizard.next();
  },
  async (ctx) => {
    const text = ctx.message?.text;
    if (!text || text.startsWith('/')) { await ctx.scene.leave(); return; }
    const input = text.replace(/[^0-9.,]/g, '').replace(',', '.');
    if (isNaN(input) || input === '') return ctx.reply('⚠️ Ingresa un NÚMERO.');
    ctx.wizard.state.purchase.quantity = input;
    await ctx.reply('💰 ¿PRECIO TOTAL por unidad?');
    return ctx.wizard.next();
  },
  async (ctx) => {
    const text = ctx.message?.text;
    if (!text || text.startsWith('/')) { await ctx.scene.leave(); return; }
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
bot.use(stage.middleware());

bot.command('start', (ctx) => ctx.reply('👋 Usa /new para registrar o /sync para actualizar.', Markup.removeKeyboard()));
bot.command('reset', async (ctx) => { await ctx.scene?.leave(); await ctx.reply('🔄 Sesión reiniciada.', Markup.removeKeyboard()); });
bot.command('new', (ctx) => ctx.scene.enter('PURCHASE_WIZARD'));
bot.command('sync', async (ctx) => {
  masterDataCache = null;
  await getMasterData();
  ctx.reply(`✅ Sincronizado.`, Markup.removeKeyboard());
});
bot.command('debug', async (ctx) => {
  await ctx.reply(`Debug: Token=${process.env.TELEGRAM_TOKEN ? 'OK' : 'MISSING'}, URL=${process.env.APPS_SCRIPT_URL ? 'OK' : 'MISSING'}`);
});

exports.handler = async (event) => {
  try {
    console.log('Incoming update:', event.httpMethod);
    if (event.httpMethod !== 'POST') return { statusCode: 200, body: 'Bot is alive' };
    const body = JSON.parse(event.body);
    await bot.handleUpdate(body);
    return { statusCode: 200, body: 'OK' };
  } catch (err) {
    console.error('Error in handler:', err);
    return { statusCode: 200, body: 'Error' };
  }
};
