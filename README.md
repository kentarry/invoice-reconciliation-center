# 精準對帳處理中心

自動識別專案分類金額，支援發票檔案對接查驗的 Web 應用程式。

## 功能特色

- **PDF 報價單解析**：上傳 PDF 報價單，透過 Gemini AI 自動辨識專案分類、單號、金額等資訊
- **XLSX 發票資料匯入**：上傳 Excel 發票檔案，自動解析項目名稱與金額
- **資料比對中心**：自動比對報價單與發票的單號及金額，標示差異
- **報價單驗收單**：自動整理驗收總表，依部門分類彙整，支援複製與編輯

## 技術架構

- **前端框架**：React 18 + Vite
- **UI 樣式**：Tailwind CSS
- **圖示庫**：Lucide React
- **PDF 解析**：pdf.js (CDN)
- **Excel 解析**：SheetJS / xlsx (CDN)
- **AI OCR**：Google Gemini 2.0 Flash API

## 快速開始

### 1. 安裝依賴

```bash
npm install
```

### 2. 設定 API Key

開啟 `src/App.jsx`，在頂部找到：

```javascript
const API_KEY = ""; // 請在此填入您的 Gemini API Key
```

填入您的 [Google Gemini API Key](https://aistudio.google.com/app/apikey)。

> ⚠️ **安全提醒**：請勿將含有 API Key 的程式碼上傳至公開的 GitHub 儲存庫。建議使用環境變數管理敏感資訊。

### 3. 啟動開發伺服器

```bash
npm run dev
```

### 4. 建置正式版

```bash
npm run build
```

建置產出位於 `dist/` 資料夾。

## 使用流程

1. **解析報價單**：在「PDF 報價單解析」分頁上傳 PDF 檔案
2. **匯入發票**：在「XLSX 發票資料」分頁上傳 Excel 發票檔
3. **比對資料**：切換至「資料比對中心」查看比對結果
4. **產出驗收單**：在「報價單驗收單」分頁查看並複製彙整內容

## 授權

MIT License
