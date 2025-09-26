import fs from 'fs';
import Apify from 'apify';
import TelegramBot from 'node-telegram-bot-api';
import { CheerioCrawler, RequestQueue } from '@crawlee/cheerio';


// Telegram bot token
const TELEGRAM_TOKEN = "8458741469:AAHjfY7bzbodNMxoMmtuPtfkONfoySquXkE";
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

const DATA_FILE = 'data1.txt';

// --- Load stock list ---
function loadStocks() {
    if (!fs.existsSync(DATA_FILE)) return [];
    const lines = fs.readFileSync(DATA_FILE, 'utf-8').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const stocks = [];
    for (let i = 0; i < lines.length; i += 4) {
        stocks.push({
            code: lines[i],
            url: lines[i + 1],
            basePrice: parseFloat(lines[i + 2].replace(/,/g, '')) || null,
            volume: parseFloat(lines[i + 3].replace(/,/g, '')) || null,
        });
    }
    return stocks;
}

// --- Save stock list ---
function saveStocks(stocks) {
    const lines = [];
    for (const s of stocks) {
        lines.push(s.code, s.url, String(s.basePrice || ''), String(s.volume || ''));
    }
    fs.writeFileSync(DATA_FILE, lines.join('\n'), 'utf-8');
}

// --- Crawl stocks ---
async function crawlStocks(targetCodes = null) {
    const stocks = loadStocks();
    const results = [];

    // Open a local request queue
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
            data.volume = stock.volume || null;
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


async function crawlStocksVNI() {
    const results = [];

    // Open a local request queue
    const requestQueue = await RequestQueue.open('local-stock-queue');

    await requestQueue.addRequest({
        url: 'https://finance.vietstock.vn/',
    });

    const crawler = new CheerioCrawler({
        requestQueue,
        handlePageFunction: async ({ $ }) => {
            const data = {};
            const vnIndexText = $('#vn-index b.pull-right').first().text().trim() || 'N/A';
            data.vnIndexRaw = vnIndexText;
            data.vnIndex = vnIndexText !== 'N/A' ? parseFloat(vnIndexText.replace(/,/g, '')) : null;

            console.log('VNINDEX:', vnIndexText);
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
        if (!results.length) {
            bot.sendMessage(chatId, `❌ Không tìm thấy dữ liệu cho ${code}`);
            return;
        }

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

bot.onText(/\/gvni/, async (msg, match) => {
    const chatId = msg.chat.id;
    const code = 'VNINDEX';

    bot.sendMessage(chatId, `🔍 Lấy dữ liệu cho ${code}...`);

    try {
        const results = await crawlStocksVNI([code]);
        if (!results.length) {
            bot.sendMessage(chatId, `❌ Không tìm thấy dữ liệu cho ${code}`);
            return;
        }

        const s = results[0];
        bot.sendMessage(chatId,
            `📊 ${s.symbol} - ${s.company}\n` +
            `💰 Giá: ${s.price}\n` +
            `📈 Change: ${s.change}\n` +
            (`🔹 Base: ${s.basePrice}\n🔺 Diff: ${s.diff} (${s.diffPct})`)
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

        // Sort by change descending
        results.sort((a, b) => {
            console.log('ChangeVal:', a.diff, b.diff);
            const aVal = parseFloat((a.diffPct || '0').replace('%', '').replace('+', '')) || 0;
            const bVal = parseFloat((b.diffPct || '0').replace('%', '').replace('+', '')) || 0;
            return bVal - aVal;
        });

        const colWidths = { symbol: 8, price: 10, change: 18, base: 8, diff: 15 };
        let message = '```\n';
        message +=
            'Symbol'.padEnd(colWidths.symbol) +
            'Price'.padEnd(colWidths.price) +
            'Change'.padEnd(colWidths.change) +
            'Base'.padEnd(colWidths.base) +
            'Diff'.padEnd(colWidths.diff) + '\n';

        message += '-'.repeat(Object.values(colWidths).reduce((a, b) => a + b, 0)) + '\n';

        for (const s of results) {
            const symbol = (s.symbol || '').padEnd(colWidths.symbol).slice(0, colWidths.symbol);
            const price = (s.price || '').padEnd(colWidths.price).slice(0, colWidths.price);
            const changeVal = s.change || '0%';
            const changeEmoji = changeVal.includes('+') ? '📈' : changeVal.includes('-') ? '📉' : '';
            const change = (changeVal + changeEmoji).padEnd(colWidths.change).slice(0, colWidths.change);
            const base = s.basePrice ? String(s.basePrice).padEnd(colWidths.base).slice(0, colWidths.base) : '-'.padEnd(colWidths.base);
            const diff = s.diff ? `${s.diff} (${s.diffPct})`.padEnd(colWidths.diff).slice(0, colWidths.diff) : '-'.padEnd(colWidths.diff);

            message += `${symbol}${price}${change}${base}${diff}\n`;
        }

        message += '```';
        let totalProfit = 0;
        let message1 = '📊 Kết quả lãi/lỗ từng mã:';
        message + - message1;
        for (const s of results) {
            const price = parseFloat((s.price || '0').replace(/,/g, ''));
            const base = s.basePrice || 0;
            const volume = s.volume || 0;
            const profit = volume * (price - base);
            totalProfit += profit;

            const label = profit >= 0 ? '🟢Lãi' : '🔴Lỗ';
            message += `\n${s.symbol}   ${label}: ${formatNumber(Math.abs(profit))}`;
        }

        // Thêm tổng lãi/lỗ
        const totalLabel = totalProfit >= 0 ? '🟢Tổng Lãi' : '🔴Tổng Lỗ';
        message += `\n------------------------`;
        message += `\n${totalLabel}: ${formatNumber(Math.abs(totalProfit))}`;

        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });


    } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, '⚠️ Lỗi khi lấy dữ liệu.');
    }
});
function formatNumber(num) {
    if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(2) + 'B';
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + 'M';
    if (num >= 1_000) return (num / 1_000).toFixed(2) + 'K';
    return num.toFixed(2);
}
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
// --- Giá vốn ---
const basePriceBuy = 82200;
const buyVal = 10000000;
async function getOnusVndcPrice() {
    const url = "https://spot-markets.goonus.io/trades?symbol_name=TON_VNDC";
    const res = await fetch(url, { headers: { accept: "application/json" } });
    const trades = await res.json();
    const lastTrade = trades?.[0];
    return lastTrade?.p || null;
}
async function getVndcPrice(coin) {
    const url = "https://spot-markets.goonus.io/trades?symbol_name=" + coin + "_VNDC";
    const res = await fetch(url, { headers: { accept: "application/json" } });
    const trades = await res.json();
    const lastTrade = trades?.[0];
    return lastTrade?.p || null;
}
// --- Hàm format tiền VND ---
function formatVND(amount) {
    return new Intl.NumberFormat("vi-VN", {
        style: "currency",
        currency: "VND",
        maximumFractionDigits: 0
    }).format(amount);
}

// --- Lệnh /get ---
bot.onText(/\/gcoin/, async (msg) => {
    const chatId = msg.chat.id;

    try {
        const price = await getOnusVndcPrice();

        if (!price) {
            return bot.sendMessage(chatId, "⚠️ Không có dữ liệu.");
        }

        const profitPercent = ((price - basePriceBuy) / basePriceBuy * 100).toFixed(2);
        const profitValue = Math.round((price - basePriceBuy) / basePriceBuy * buyVal);

        const message =
            `💰 Giá TON/VNDC hiện tại: ${formatVND(price)}\n` +
            `💰 Giá TON/VNDC ban đầu: ${formatVND(basePriceBuy)}\n` +
            `📈 Lợi nhuận%: ${profitPercent}%\n` +
            `💵 Vốn ban đầu: ${formatVND(buyVal)}\n` +
            `💹 Lợi nhuận: ${formatVND(profitValue)}`;

        bot.sendMessage(chatId, message);

    } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, "⚠️ Lỗi khi lấy dữ liệu giá.");
    }
});
bot.onText(/\/gv (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const code = match[1].trim().toUpperCase();

    try {
        const price = await getVndcPrice(code);

        if (!price) {
            return bot.sendMessage(chatId, "⚠️ Không có dữ liệu.");
        }

        const message =
            `💰 Giá ${code}/VNDC hiện tại: ${formatVND(price)}`;

        bot.sendMessage(chatId, message);

    } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, "⚠️ Lỗi khi lấy dữ liệu giá.");
    }
});
console.log('🤖 Bot sẵn sàng. Gõ /get <Mã>, /getall, /add, /remove');
