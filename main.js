import fetch from "node-fetch";

async function getVNIndex() {
  const url = "https://finance.vietstock.vn/Data/GeneralMarket_GetMarketIndexVNData";

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Referer": "https://finance.vietstock.vn/",
      "X-Requested-With": "XMLHttpRequest", // nhiều site .NET cần cái này
    },
  });

  const text = await res.text();
  console.log("Raw response:", text.slice(0, 200)); // in thử 200 ký tự đầu

  try {
    const json = JSON.parse(text);
    console.log("📊 VNINDEX JSON:", json);
    return json;
  } catch (err) {
    console.error("❌ Không parse được JSON:", err.message);
  }
}

getVNIndex();