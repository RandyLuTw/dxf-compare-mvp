# DXF 文件比對程式 (Frontend MVP)

純前端 DXF 比對工具，可直接部署到 GitHub Pages。支援單檔比對與資料夾批次比對，不需後端、資料庫或登入。

## 功能摘要

- 單檔比對
  - 載入 `A.dxf` / `B.dxf`
  - 顯示模式：左右並排 / 疊圖 / 差異模式
  - 操作：Zoom in/out、Pan、Fit to screen、座標顯示
  - 圖層顯示/隱藏
  - 文件層比對（header、單位、layers、blocks、entities、extents）
  - 圖形層比對（LINE、LWPOLYLINE、POLYLINE、CIRCLE、ARC、TEXT、MTEXT、INSERT）
  - 差異分類：Added / Removed / Modified / Unchanged
  - 點擊差異項目自動定位
  - 匯出：JSON / HTML / 統計 JSON

- 資料夾批次比對
  - `webkitdirectory` 選擇 Folder A / Folder B
  - 遞迴掃描子資料夾中的 `.dxf`
  - 以「檔名（不含路徑）」配對
  - 狀態：Same / Modified / Added / Removed / Error
  - 顯示進度條與 `Stop` 中斷
  - 可篩選（只看差異）與排序（依差異數量）
  - 點選列可載入到單檔比對畫面（查看詳情）
  - 匯出：批次 JSON / CSV / HTML

## 專案結構

```text
.
├─ index.html
├─ styles/
│  └─ style.css
├─ src/
│  ├─ main.js
│  ├─ app.js
│  ├─ dxfLoader.js
│  ├─ dxfNormalizer.js
│  ├─ dxfComparer.js
│  ├─ dxfRenderer.js
│  ├─ diffPanel.js
│  └─ utils.js
└─ README.md
```

## 啟動方式

這是靜態網站，請用任一靜態伺服器啟動：

```bash
# Node 18+
npx http-server . -p 4173 -c-1
```

開啟瀏覽器進入 `http://127.0.0.1:4173`。

## 操作方式（單檔比對）

1. 點 `載入 A.dxf` 與 `載入 B.dxf`。
2. 設定容差（座標/長度/角度）。
3. 視需要勾選：
   - `忽略線型差異`
   - `忽略顏色差異`
4. 按 `比對`。
5. 切到 `疊圖模式` 或 `差異模式` 檢視。
6. 若兩圖存在整體位移：
   - 按 `套用自動校正`（系統會帶入 `dx/dy`）
   - 或手動調整 `疊圖校正 dx / dy`
7. 點右側差異清單任一項，可自動定位圖面。
8. 需要輸出時按：`匯出 JSON / 匯出 HTML / 匯出統計`。

## 操作方式（資料夾比對）

1. 切到 `資料夾比對` 頁籤。
2. 選擇 `Folder A` 與 `Folder B`。
3. 按 `開始批次比對`。
4. 在結果表可：
   - 排序（依差異量）
   - 篩選（只看有差異）
   - 點 `查看詳情` 進入單檔疊圖頁面
5. `查看詳情` 會自動：
   - 切到單檔頁面
   - 重新比對（套用目前容差與忽略設定）
   - 套用平移校正並顯示疊圖結果
6. 可匯出批次報表：`JSON / CSV / HTML`。

## 平移校正說明

- 比對前會先計算兩圖的全圖基準點（最小 `X/Y`），再做結構化比對。
- 文件摘要會顯示：`平移偏移(B-A, 以最小XY對齊)`。
- 疊圖顯示可再套用 `dx/dy`（自動或手動），避免同一圖形因位移而看起來分離。

## 資料安全說明

- 本工具為純前端：檔案只在瀏覽器端讀取與計算。
- 不會上傳到後端伺服器、不使用資料庫。
- 只有你手動按匯出，才會在本機下載報表。

## GitHub Pages 部署

1. 推送專案到 GitHub。
2. 在 `Settings -> Pages`：
   - Source 選 `Deploy from a branch`
   - Branch 選 `main`，資料夾 `/ (root)`
3. 等待部署完成後，使用 Pages URL 開啟。

## 比對設計說明

- **不是逐行文字 diff**：先解析為結構化資料再比對。
- **Normalization**：
  - 座標四捨五入至容差精度
  - 浮點容差判斷
  - 文字清理（trim + 空白正規化）
  - 空值顏色/線型標準化為 `BYLAYER`
- **容差參數（預設）**：
  - 座標：`0.001`
  - 長度/半徑：`0.001`
  - 角度：`0.01`
- **實體配對策略**：
  - 主要依 `type + layer + 幾何中心 + 特徵` 配對
  - TEXT/MTEXT 納入文字內容
  - INSERT 納入 block name 與插入點
  - 不依賴 handle
- **Block 比對**：
  - 文件層含 block 定義數量差異
  - 圖形層對 INSERT 比對名稱、插入點、旋轉、縮放

## 已知限制（MVP）

- ARC 的完整角段包覆判斷為簡化處理。
- 未支援所有 DXF entity 類型（可擴充 `dxfNormalizer.js` 與 `dxfComparer.js`）。
- 資料夾比對目前採「同檔名」配對（`a.dxf` 不會自動配到 `a_.dxf`）。
- 大量檔案時，批次處理仍取決於瀏覽器記憶體與 DXF 複雜度。

## 未來擴充建議

- 增加更多 entity 支援（ELLIPSE、SPLINE、DIMENSION 等）
- 增加檔名模糊配對規則（如 `1789` 對 `1789_`）
- 加入 DWG/PDF 比對流程
- 多檔案批次差異視覺化輸出
- 匯出差異標記圖層圖像（PNG/SVG）
