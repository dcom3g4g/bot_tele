import fs from 'fs';
import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
import { CheerioCrawler, RequestQueue } from '@crawlee/cheerio';

// --- Environment variables ---
const TELEGRAM_TOKEN = "8338138355:AAFB-8MA-Duv2lY_sbUJB75ZJ5dEVMw0lcU"; // replace with your token
const BASE_URL = "https://bottele-production-601b.up.railway.app"; // e.g., Railway public URL: https://your-app.up.railway.app
const DATA_FILE = 'data.txt';

if (!TELEGRAM_TOKEN || !BASE_URL) {
    console.error("Please set TELEGRAM_TOKEN and BASE_URL in your environment variables.");
    process.exit(1);
}

// --- Initialize Telegram bot without polling ---
const bot = new TelegramBot(TELEGRAM_TOKEN);
const webhookUrl = `${BASE_URL}/bot${TELEGRAM_TOKEN}`;
await bot.setWebHook(webhookUrl);

// --- Express server ---
const app = express();
app.use(express.json());
app.post(`/bot${TELEGRAM_TOKEN}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// --- Load stock list ---
function loadStocks() {
    if (!fs.existsSync(DATA_FILE)) return [];
    const lines = fs.readFileSync(DATA_FILE, 'utf-8')
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(Boolean);
    const stocks = [];
    for (let i = 0; i < lines.length; i += 3) {
        stocks.push({
            code: lines[i],
            url: lines[i + 1],
            basePrice: parseFloat(lines[i + 2].replace(/,/g, '')) || null,
        });
    }
    return stocks;
}

// --- Save stock list ---
function saveStocks(stocks) {
    const lines = [];
    for (const s of stocks) lines.push(s.code, s.url, String(s.basePrice || ''));
    fs.writeFileSync(DATA_FILE, lines.join('\n'), 'utf-8');
}

// --- Crawl stocks ---
async function crawlStocks(targetCodes = null) {
    const stocks = loadStocks();
    const results = [];
    const requestQueue = await RequestQueue.open('local-stock-queue');

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
            data.change = $('#stockchange').text().trim() || '0';

            if (stock.basePrice) {
                const current = parseFloat(data.price.replace(/,/g, '')) || null;
                if (current) {
                    const diff = current - stock.basePrice;
                    const diffPct = ((diff / stock.basePrice) * 100).toFixed(2);
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

// --- Telegram commands ---

// /get <code>
bot.onText(/\/get (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const code = match[1].trim().toUpperCase();
    bot.sendMessage(chatId, `🔍 Lấy dữ liệu cho ${code}...`);
    try {
        const results = await crawlStocks([code]);
        if (!results.length) return bot.sendMessage(chatId, `❌ Không tìm thấy dữ liệu cho ${code}`);
        const s = results[0];
        bot.sendMessage(chatId,
            `📊 ${s.symbol} - ${s.company}\n` +
            `💰 Giá: ${s.price}\n` +
            `📈 Change: ${s.change}\n` +
            (s.basePrice ? `🔹 Base: ${s.basePrice}\n🔺 Diff: ${s.diff} (${s.diffPct})` : '')
        );
    } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, '⚠️ Lỗi khi lấy dữ liệu.');
    }
});

// /getall
bot.onText(/\/getall/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, '🔍 Lấy dữ liệu tất cả mã...');
    try {
        let results = await crawlStocks();
        if (!results.length) return bot.sendMessage(chatId, '⚠️ Không có dữ liệu.');

        results.sort((a, b) => {
            const aVal = parseFloat((a.change || '0').replace('%', '').replace('+', '')) || 0;
            const bVal = parseFloat((b.change || '0').replace('%', '').replace('+', '')) || 0;
            return bVal - aVal;
        });

        const colWidths = { symbol: 7, price: 10, change: 8, base: 10, diff: 15 };
        let message = '```\n';
        message += 'Symbol'.padEnd(colWidths.symbol) +
            'Price'.padStart(colWidths.price) +
            'Change'.padEnd(colWidths.change) +
            'Base'.padStart(colWidths.base) +
            'Diff(Diff%)'.padStart(colWidths.diff) + '\n';
        message += '-'.repeat(Object.values(colWidths).reduce((a, b) => a + b, 0)) + '\n';

        for (const s of results) {
            const symbol = s.symbol.padEnd(colWidths.symbol);
            const price = s.price.padStart(colWidths.price);
            const changeVal = s.change || '0%';
            const changeEmoji = changeVal.includes('+') ? '📈' : changeVal.includes('-') ? '📉' : '';
            const change = (changeVal + changeEmoji).padEnd(colWidths.change);
            const base = s.basePrice ? String(s.basePrice).padStart(colWidths.base) : '-'.padStart(colWidths.base);
            const diff = s.diff ? `${s.diff} (${s.diffPct})`.padStart(colWidths.diff) : '-'.padStart(colWidths.diff);
            message += `${symbol}${price}${change}${base}${diff}\n`;
        }

        message += '```';
        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });

    } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, '⚠️ Lỗi khi lấy dữ liệu.');
    }
});

// /add <code> <url> <basePrice>
bot.onText(/\/add (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const parts = match[1].split(' ').map(p => p.trim()).filter(Boolean);
    if (parts.length < 3) return bot.sendMessage(chatId, '❌ Sai cú pháp. Dùng: /add CODE URL BASEPRICE');

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
    if (newStocks.length === stocks.length) return bot.sendMessage(chatId, `❌ Không tìm thấy stock ${code}`);

    saveStocks(newStocks);
    bot.sendMessage(chatId, `🗑 Đã xoá stock ${code}`);
});

// --- Start Express server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🤖 Bot running with webhook at ${webhookUrl}`));
