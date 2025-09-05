import { Telegraf } from "telegraf";
import fetch from "node-fetch";

const BOT_TOKEN = "8338138355:AAFB-8MA-Duv2lY_sbUJB75ZJ5dEVMw0lcU"; // thay bằng token của bạn
const bot = new Telegraf(BOT_TOKEN);

// Hàm lấy giá ONUS/VNDC từ REST API
async function getOnusVndcPrice() {
  const url = "https://spot-markets.goonus.io/trades?symbol_name=ONUS_VNDC";
  const res = await fetch(url, { headers: { accept: "application/json" } });
  const trades = await res.json();
  const lastTrade = trades?.[0];
  return lastTrade?.p || "Không có dữ liệu";
}

// Khi người dùng gõ /get
bot.command("get", async (ctx) => {
  try {
    const price = await getOnusVndcPrice();
    await ctx.reply(`💰 Giá ONUS/VNDC hiện tại: ${price}`);
  } catch (err) {
    console.error(err);
    await ctx.reply("⚠️ Lỗi khi lấy dữ liệu giá.");
  }
});

// Start bot
bot.launch();
console.log("🤖 Bot đang chạy...");
