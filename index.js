import { CheerioCrawler, RequestQueue } from '@crawlee/cheerio';
import fs from 'fs';
import fetch from "node-fetch";
import TelegramBot from 'node-telegram-bot-api';
import { stock } from 'vnstock-js';
// Telegram bot token
const TELEGRAM_TOKEN = "8338138355:AAFB-8MA-Duv2lY_sbUJB75ZJ5dEVMw0lcU";
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

const DATA_FILE = 'data.txt';

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
async function fetchDataEachStock(code) {
    const priceBoard = await stock.priceBoard({ ticker: code });
    console.log("check fetch 2", priceBoard)
    return priceBoard;
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
async function getData() {
  try {
    const token = "FlJYEcyZa8OLStfreEueXwMT31d_2A2DLbxAvLM7jUx2LLUUmTawidlEpWv9g_bYc-EQumtJ1IXbLCBwaCn4tROsHpybrUSGNcAlUOJCvic1";

    const bodyString = `page=1&pageSize=30&catID=1&date=2023-09-14&__RequestVerificationToken=FlJYEcyZa8OLStfreEueXwMT31d_2A2DLbxAvLM7jUx2LLUUmTawidlEpWv9g_bYc-EQumtJ1IXbLCBwaCn4tROsHpybrUSGNcAlUOJCvic1`;
    const cookie = '__RequestVerificationToken=itgcdMQgkBrwE23iTQaHSqsHtp3oy7mZJtkaJhP_MB9yPkbWA1HrEPVYSyki9vmPjjlCz4n4TlitXwVpPMw-Sze8jP77B7Iqueof9kyzWA41;'
    const res = await fetch("https://finance.vietstock.vn/data/KQGDThongKeGiaPaging", {
      method: "POST",
      headers: {
        "Accept": "*/*",
        "Accept-Language": "en-GB,en;q=0.9,en-US;q=0.8",
        Cookie: cookie,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36 Edg/117.0.2045.31",
      },
      body: bodyString,
    });

    const text = await res.text();

    try {
      const json = JSON.parse(text);
      console.log("JSON:", json[0][0]);
      return json[0][0];
    } catch {
      console.log("❌ FAIL: Server trả HTML, token không đúng");
    }

  } catch (err) {
    console.error(err);
  }
}
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

// bot.onText(/\/gvni/, async (msg, match) => {
//     const chatId = msg.chat.id;
//     const code = 'VNINDEX';

//     bot.sendMessage(chatId, `🔍 Lấy dữ liệu cho ${code}...`);

//     try {
//         const results = await crawlStocksVNI([code]);
//         if (!results.length) {
//             bot.sendMessage(chatId, `❌ Không tìm thấy dữ liệu cho ${code}`);
//             return;
//         }

//         const s = results[0];
//         bot.sendMessage(chatId,
//             `📊 ${s.symbol} - ${s.company}\n` +
//             `💰 Giá: ${s.price}\n` +
//             `📈 Change: ${s.change}\n` +
//             (`🔹 Base: ${s.basePrice}\n🔺 Diff: ${s.diff} (${s.diffPct})`)
//         );
//     } catch (err) {
//         console.error(err);
//         bot.sendMessage(chatId, '⚠️ Lỗi khi lấy dữ liệu.');
//     }
// });
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
        let totalBuy = 0;
        let totalCurr = 0;
        let totalToday =0;
        let message1 = '📊 Kết quả lãi/lỗ từng mã:';
        message + - message1;
        for (const s of results) {
            const price = parseFloat((s.price || '0').replace(/,/g, ''));
            const base = s.basePrice || 0;
            const volume = s.volume || 0;
            const profit = volume * (price - base);
            totalBuy += volume * base;
            totalCurr += volume * price;
            totalProfit += profit;
            totalToday += volume * (price - (price - parseFloat(s.change.replace(/,/g, ''))));
            const label = profit >= 0 ? '📈Lãi' : '📉';
            message += `\n${s.symbol}   ${label}: ${formatNumber(Math.abs(profit))}`;
        }
        console.log("Total Today:", totalToday);
        // Thêm tổng lãi/lỗ
        const totalLabel = totalProfit >= 0 ? '📈Tổng Lãi' : '📉Tổng Lỗ';
        const totalLabel1 = 'Tổng mua: ';
        const totalPercent = totalCurr / totalBuy * 100 - 100;
        message += `\n------------------------`;
        message += `\n${totalLabel}: ${formatNumber(Math.abs(totalProfit))} (${totalPercent.toFixed(2)}%)\n${totalLabel1}${formatNumber(Math.abs(totalBuy))}`;
        message += `\nLãi/Lỗ hôm nay: ${formatNumber(totalToday)}`;
        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });


    } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, '⚠️ Lỗi khi lấy dữ liệu.');
    }
});
// /getall
bot.onText(/\/gvni/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, '🔍 Lấy dữ liệu vni...');

    try {
        let results = await getData();
        console.log("check varrrrrr222||", results);
        // if (!results.length) return bot.sendMessage(chatId, '⚠️ Không có dữ liệu.');
        let message = '';
        message += `\n------------------------`;
        message += `\n Giá Ban Đầu: ${results.PriorIndex}`;
        message += `\n Giá Hiện Tại: ${(results.CloseIndex)}`;
        message += `\n Change: ${(results.CloseIndex-results.PriorIndex)}`;
        message += `\n Percent: ${results.PerChange}%`;

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
bot.onText(/\/gs (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const parts = match[1].split(' ').map(p => p.trim()).filter(Boolean);
    if (parts.length < 1) {
        bot.sendMessage(chatId, '❌ Wrong syntax. Use: /add CODE URL BASEPRICE');
        return;
    }
    const code = parts[0].toUpperCase();
    const results = await fetchDataEachStock(code.toString().toUpperCase());
    console.log("check varrrrrr111||", code);
    var results1 = results[0].matchPrice;
    console.log("check varrrrrr||", results1);
    if (!results1) {
        bot.sendMessage(chatId,
            `⚠️ No data available for ${code}`);
        return;
    }
    bot.sendMessage(chatId,
        `🌈 Current price: ${results1.matchPrice}\n` +
        `🚪 Open price: ${results1.openPrice}\n` +
        `🐠 Change: ${results1.matchPrice - results1.referencePrice}\n` +
        `🐠 Change Per: ${(((results1.matchPrice - results1.referencePrice) / results1.referencePrice * 100).toFixed(2))}%\n`
    );
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
const basePriceBuy = 59500;
const buyVal = 21000000;
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
async function getUSDPrice(coin) {
    const url = "https://spot-markets.goonus.io/trades?symbol_name=" + coin + "_USDT";
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
bot.onText(/\/clear/, async (msg) => {
    const chatId = msg.chat.id;

    try {
        // Lấy tin nhắn gần đây (Telegram API không cho list toàn bộ đâu)
        for (let i = msg.message_id; i > msg.message_id - 50; i--) {
            try {
                await bot.deleteMessage(chatId, i);
            } catch (err) {
                // bỏ qua lỗi nếu không xóa được
            }
        }
    } catch (err) {
        console.error(err);
    }
});
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
            `📈 Lợi nhuận%: ${(profitPercent)}%\n` +
            `💵 Vốn ban đầu: ${(formatVND(buyVal))}\n` +
            `💹 Lợi nhuận: ${(formatVND(profitValue))}`;

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
bot.onText(/\/gu (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const code = match[1].trim().toUpperCase();

    try {
        const price = await getUSDPrice(code);

        if (!price) {
            return bot.sendMessage(chatId, "⚠️ Không có dữ liệu.");
        }

        const message =
            `💰 Giá ${code}/USDC hiện tại: ${(price)}`;

        bot.sendMessage(chatId, message);

    } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, "⚠️ Lỗi khi lấy dữ liệu giá.");
    }
});
console.log('🤖 Bot sẵn sàng. Gõ /get <Mã>, /getall, /add, /remove');
