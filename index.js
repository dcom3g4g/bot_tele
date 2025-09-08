import Apify from 'apify';
import fs from 'fs';
import TelegramBot from 'node-telegram-bot-api';

const { CheerioCrawler } = Apify;
const log = Apify.utils.log;

const TELEGRAM_TOKEN = "8338138355:AAFB-8MA-Duv2lY_sbUJB75ZJ5dEVMw0lcU";
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

const DATA_FILE = 'data.txt';

// --- đọc danh sách stock từ file ---
function loadStocks() {
  if (!fs.existsSync(DATA_FILE)) return [];
  const fileContent = fs.readFileSync(DATA_FILE, 'utf-8');
  const lines = fileContent.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const stocks = [];
  for (let i = 0; i < lines.length; i += 3) {
    const code = lines[i];
    const url = lines[i + 1];
    const basePrice = parseFloat(lines[i + 2].replace(/,/g, '')) || null;
    stocks.push({ code, url, basePrice });
  }
  return stocks;
}

// --- ghi danh sách stock xuống file ---
function saveStocks(stocks) {
  const lines = [];
  for (const s of stocks) {
    lines.push(s.code);
    lines.push(s.url);
    lines.push(String(s.basePrice || ''));
  }
  fs.writeFileSync(DATA_FILE, lines.join('\n'), 'utf-8');
}

// --- crawl dữ liệu ---
async function crawlStocks(targetCodes = null) {
  const stocks = loadStocks();
  const results = [];

  const requestQueue = await Apify.openRequestQueue();
  for (const stock of stocks) {
    if (!targetCodes || targetCodes.includes(stock.code.toUpperCase())) {
      await requestQueue.addRequest({
        url: stock.url,
        uniqueKey: `${stock.code}-${Date.now()}`,
        userData: { stock },
      });
    }
  }

  const crawler = new CheerioCrawler({
    requestQueue,
    handlePageFunction: async ({ request, $ }) => {
      const { stock } = request.userData;
      const data = {};

      data.symbol = $('span.stock-code').text().trim() || stock.code || 'N/A';
      data.company = $('h1.title').text().trim() || 'N/A';
      data.price = $('.stock-info .price').first().text().trim() || 'N/A';
      data.change = $('#stockchange').text().trim() === '' ? 0 : $('#stockchange').text().trim();

      if (stock.basePrice) {
        const current = parseFloat(data.price.replace(/,/g, '')) || null;
        if (current) {
          const diff = current - stock.basePrice;
          const diffPct = ((diff / stock.basePrice) * 100).toFixed(2) || 0;
          data.basePrice = stock.basePrice;
          data.diff = diff;
          data.diffPct = diffPct + '%';
        }
      }

      results.push(data);
    },
  });

  await crawler.run();
  return results;
}

// --- Telegram Commands ---
// /get <code>
bot.onText(/\/get (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const code = match[1].trim().toUpperCase();

  bot.sendMessage(chatId, `🔍 Đang lấy dữ liệu cho ${code} ...`);

  try {
    const results = await crawlStocks([code]);
    if (results.length === 0) {
      bot.sendMessage(chatId, `❌ Không tìm thấy dữ liệu cho mã: ${code}`);
      return;
    }

    const s = results[0];
    {
      bot.sendMessage(chatId,
        `📊 ${s.symbol} - ${s.company}\n` +
        `💰 Giá: ${s.price}\n` +
        `📈 Change: ${s.change}\n` +
        (s.basePrice ?
          `🔹 Base: ${s.basePrice}\n🔺 Diff: ${s.diff} (${s.diffPct})`
          : '')
      );
    }

  } catch (err) {
    log.error(err);
    bot.sendMessage(chatId, '⚠️ Có lỗi khi lấy dữ liệu.');
  }
});

// /get all
bot.onText(/\/getall/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '🔍 Đang lấy dữ liệu tất cả mã...');

  try {
    let results = await crawlStocks();
    if (results.length === 0) {
      bot.sendMessage(chatId, '⚠️ Không có dữ liệu.');
      return;
    }

    // --- sort theo Change giảm dần ---
    results.sort((a, b) => {
      const aVal = parseFloat((a.change || '0').replace('%', '').replace('+', '')) || 0;
      const bVal = parseFloat((b.change || '0').replace('%', '').replace('+', '')) || 0;
      return bVal - aVal; // giảm dần
    });

    // Đặt độ rộng cột
    const colWidths = {
      symbol: 7,
      price: 10,
      change: 8,
      base: 10,
      diff: 15
    };

    // Header
    let message = '```\n';
    message +=
      'Symbol'.padEnd(colWidths.symbol, ' ') +
      'Price'.padStart(colWidths.price, ' ') +
      'Change'.padEnd(colWidths.change, ' ') +
      'Base'.padStart(colWidths.base, ' ') +
      'Diff(Diff%)'.padStart(colWidths.diff, ' ') +
      '\n';
    message += '-'.repeat(colWidths.symbol + colWidths.price + colWidths.change + colWidths.base + colWidths.diff) + '\n';

    // Duyệt từng stock
    for (const s of results) {
      const symbol = s.symbol.padEnd(colWidths.symbol, ' ');
      const price = s.price.padStart(colWidths.price, ' ');

      // Change + emoji
      let changeVal = s.change || '0%';
      let changeEmoji = '';
      if (changeVal.includes('+')) changeEmoji = '📈';
      else if (changeVal.includes('-')) changeEmoji = '📉';
      const change = (changeVal + changeEmoji).padEnd(colWidths.change, ' ');

      const base = s.basePrice ? String(s.basePrice).padStart(colWidths.base, ' ') : '-'.padStart(colWidths.base, ' ');
      const diff = s.diff ? `${s.diff} (${s.diffPct})`.padStart(colWidths.diff, ' ') : '-'.padStart(colWidths.diff, ' ');

      message += `${symbol}${price}${change}${base}${diff}\n`;
    }

    message += '```';

    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });

  } catch (err) {
    log.error(err);
    bot.sendMessage(chatId, '⚠️ Có lỗi khi lấy dữ liệu.');
  }
});



// /add <code> <url> <basePrice>
bot.onText(/\/add (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const parts = match[1].split(' ').map(p => p.trim()).filter(Boolean);

  if (parts.length < 3) {
    bot.sendMessage(chatId, '❌ Sai cú pháp. Dùng: /add CODE URL BASEPRICE');
    return;
  }

  const code = parts[0].toUpperCase();
  const url = parts[1];
  const basePrice = parseFloat(parts[2].replace(/,/g, ''));

  let stocks = loadStocks();
  const index = stocks.findIndex(s => s.code.toUpperCase() === code);

  if (index >= 0) {
    stocks[index] = { code, url, basePrice };
    bot.sendMessage(chatId, `✅ Đã cập nhật stock ${code}`);
  } else {
    stocks.push({ code, url, basePrice });
    bot.sendMessage(chatId, `✅ Đã thêm stock ${code}`);
  }

  saveStocks(stocks);
});

// /remove <code>
bot.onText(/\/remove (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const code = match[1].trim().toUpperCase();

  let stocks = loadStocks();
  const newStocks = stocks.filter(s => s.code.toUpperCase() !== code);

  if (newStocks.length === stocks.length) {
    bot.sendMessage(chatId, `❌ Không tìm thấy stock ${code}`);
    return;
  }

  saveStocks(newStocks);
  bot.sendMessage(chatId, `🗑 Đã xoá stock ${code}`);
});

console.log('🤖 Bot sẵn sàng. Gõ /get <Mã>, /get all, /add, /remove');
