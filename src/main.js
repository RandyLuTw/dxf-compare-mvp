import { createApp } from "./app.js";

if (location.protocol === "file:") {
  alert("請勿直接雙擊 index.html。請先啟動本機伺服器 (例如: npx serve .) 再開啟網站。\n\n直接用 file:// 會導致模組載入失敗，選檔看起來像沒有反應。");
}

createApp();
document.body.setAttribute("data-app-ready", "1");
