
# MA Strategy AI Pro - 智能交易終端

這是一個結合 TradingView 即時圖表與 Google Gemini AI 的專業美股分析工具。

## 📁 專案目錄結構
- `/components`: 存放 UI 組件（如彈窗、通知、圖表控制）。
- `/services`: 存放與 Gemini AI 溝通的邏輯。
- `App.tsx`: 應用程式的核心邏輯與介面。
- `index.html`: 網頁進入點。

## 🚀 最終部署步驟 (Vercel)

恭喜你完成了 GitHub 上傳！現在是最後一步，讓你的網站正式上線：

1. **登入 Vercel**:
   - 前往 [Vercel 官網](https://vercel.com/)。
   - 點擊 **"Continue with GitHub"** 登入。

2. **導入專案**:
   - 登入後，點擊頁面上的 **"Add New..."** -> **"Project"**。
   - 在列表裡找到你剛才上傳的 GitHub 專案，點擊右邊的 **"Import"**。

3. **設定環境變數 (最重要！)**:
   - 在部署設定頁面，找到一個叫 **"Environment Variables"** 的摺疊選單。
   - **Key (鍵)**: 輸入 `API_KEY`
   - **Value (值)**: 貼上你的 Google Gemini API Key。
   - 點擊旁邊的 **"Add"** 按鈕。

4. **開始部署**:
   - 點擊最下方的 **"Deploy"**。
   - 大約等待 1 分鐘，看到滿天煙火特效就代表成功了！

5. **訪問網站**:
   - Vercel 會給你一個專屬網址（例如 `your-project.vercel.app`）。
   - 用手機打開這個網址，你就能看到右上角的 **"App"** 按鈕，點擊它即可安裝到手機主畫面。

## 📱 行動端安裝
在手機瀏覽器打開部署後的網址，點擊「加入主螢幕」即可作為 App 使用。
