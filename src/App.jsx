import React, { useState, useEffect, useMemo, useRef } from 'react';
import { FileText, Loader2, CheckCircle2, AlertCircle, Download, UploadCloud, BarChart3, Filter, FileSpreadsheet, List, FileCheck, Scale, ClipboardCheck, Trash2 } from 'lucide-react';

const API_KEY = ""; // 請在此填入您的 Gemini API Key
const MODEL_NAME = "gemini-2.0-flash"; 

const App = () => {
  // --- 原有狀態 ---
  const [results, setResults] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [filterCategory, setFilterCategory] = useState('全部');

  // --- 狀態：頁籤控制與發票資料 ---
  const [activeTab, setActiveTab] = useState('parser'); // 'parser'=解析, 'invoice'=發票, 'compare'=比對, 'acceptance'=驗收單
  const [invoiceData, setInvoiceData] = useState([]);
  const [invoiceTotal, setInvoiceTotal] = useState(0);

  // --- 新增狀態：驗收單編輯 ---
  const [editableOrderIds, setEditableOrderIds] = useState('');
  const [editableDetails, setEditableDetails] = useState('');

  // --- 新增 Ref：自動調整高度 ---
  const orderIdsRef = useRef(null);
  const detailsRef = useRef(null);

  // 自動調整 textarea 高度的 Effect
  useEffect(() => {
    if (activeTab === 'acceptance') {
      if (orderIdsRef.current) {
        orderIdsRef.current.style.height = 'auto'; // 先重置，才能正確取得縮小後的高度
        orderIdsRef.current.style.height = orderIdsRef.current.scrollHeight + 'px';
      }
      if (detailsRef.current) {
        detailsRef.current.style.height = 'auto';
        detailsRef.current.style.height = detailsRef.current.scrollHeight + 'px';
      }
    }
  }, [editableOrderIds, editableDetails, activeTab]);

  // 初始化 pdf.js 與 xlsx
  useEffect(() => {
    const pdfScript = document.createElement('script');
    pdfScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    pdfScript.async = true;
    document.head.appendChild(pdfScript);
    pdfScript.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    };

    const xlsxScript = document.createElement('script');
    xlsxScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    xlsxScript.async = true;
    document.head.appendChild(xlsxScript);
  }, []);

  // --- 1. 影像預處理 ---
  const pdfToImages = async (file) => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const images = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2.0 });
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      
      await page.render({ canvasContext: context, viewport }).promise;
      images.push(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
    }
    return images;
  };

  // --- 2. 精準 OCR 與 邏輯分類 ---
  const extractInfo = async (base64Image) => {
    const projectList = [
      "滿貫大亨Web館", "網頁組", "明星3缺1", "滿貫大亨", 
      "競技麻將2", "唯舞獨尊", "玩星派對", "social casino"
    ];

    const systemPrompt = `你是一位報價單解析專家。請從圖片中提取資訊並回傳 JSON。
    
    【關鍵任務】
    1. 找到報價單核心行（格式通常為：6位數字:項目名稱）。
    2. orderId: 提取該 6 位純數字。絕對禁止抓取 T 開頭的編號。
    3. projectName: 提取冒號後的文字。特別注意：
       - 若名稱跨行（如「品\\n檢測試」），請將其無縫合併為單一字串（「品檢測試」）。
       - 必須略過並移除名稱結尾的「功能測試」或「測試器材」。
    4. category: 對比 projectName 從 [${projectList.join(", ")}] 擇一，不符填"其他"。
       - 【重要】若專案名稱中包含 "VF" 或 "vf"，請一律填寫為 "social casino"。
    5. 金額欄位：提取純數字。若圖中找不到該項目，請填 "0"。
       - functionalTestAmount: 功能測試金額
       - deviceAmount: 測試器材金額
       - managementFee: 管理費金額
       - totalExclTax: 合計未稅
    
    【輸出格式】
    {
      "orderId": "string",
      "projectName": "string",
      "category": "string",
      "functionalTestAmount": "string",
      "deviceAmount": "string",
      "managementFee": "string",
      "totalExclTax": "string"
    }`;

    const payload = {
      contents: [{
        role: "user",
        parts: [
          { text: "請解析此報價單頁面金額。" }, 
          { inlineData: { mimeType: "image/jpeg", data: base64Image } }
        ]
      }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: { 
        responseMimeType: "application/json",
        temperature: 0 
      }
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${API_KEY}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) throw new Error(`API Error: ${response.status}`);
    const result = await response.json();
    return JSON.parse(result.candidates[0].content.parts[0].text);
  };

  // --- 3. 執行任務與清洗 ---
  const processFiles = async (uploadedFiles) => {
    if (uploadedFiles.length === 0) return;
    setIsProcessing(true);

    const cleanVal = (v) => {
      if (v === undefined || v === null) return '0';
      const s = v.toString().replace(/[.,元 ]/g, '').replace(/[^\d]/g, '');
      return s || '0';
    };

    const generateId = () => Math.random().toString(36).substring(2, 15);

    try {
      const allTasks = [];
      for (const file of uploadedFiles) {
        const pages = await pdfToImages(file);
        pages.forEach((img, idx) => {
          allTasks.push({ img, fileName: file.name, pageIdx: idx + 1 });
        });
      }

      setProgress({ current: 0, total: allTasks.length });
      const queue = [...allTasks];

      const runWorker = async () => {
        while (queue.length > 0) {
          const task = queue.shift();
          try {
            const data = await extractInfo(task.img);
            
            let finalProjectName = (data.projectName || "")
              .replace(/T\d{7,11}/g, "")
              .replace(/\n|\r/g, "")
              .replace(/(功能測試|測試器材)$/, "")
              .trim();

            let finalCategory = data.category;
            if (finalProjectName.toUpperCase().includes("VF")) {
              finalCategory = "social casino";
            }

            setResults(prev => [...prev, {
              id: generateId(),
              fileName: `${task.fileName} (P${task.pageIdx})`,
              status: 'success',
              data: {
                ...data,
                category: finalCategory,
                projectName: finalProjectName,
                functionalTestAmount: cleanVal(data.functionalTestAmount),
                deviceAmount: cleanVal(data.deviceAmount),
                managementFee: cleanVal(data.managementFee),
                totalExclTax: cleanVal(data.totalExclTax)
              }
            }]);
          } catch (err) {
            setResults(prev => [...prev, { id: generateId(), fileName: task.fileName, status: 'error' }]);
          } finally {
            setProgress(p => ({ ...p, current: p.current + 1 }));
          }
        }
      };

      const CONCURRENCY = 3;
      await Promise.all(Array(Math.min(CONCURRENCY, allTasks.length)).fill(null).map(runWorker));
    } finally {
      setIsProcessing(false);
    }
  };

  // --- 發票 XLSX 處理邏輯 ---
  const processInvoiceFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!window.XLSX) {
      alert("載入試算表處理模組中，請稍後再試！");
      return;
    }

    const reader = new FileReader();
    reader.onload = (evt) => {
      const bstr = evt.target.result;
      const wb = window.XLSX.read(bstr, { type: 'binary' });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const rows = window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

      let nameIdx = -1;
      let amountIdx = -1;
      let dataStartIndex = -1;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const nIdx = row.findIndex(c => typeof c === 'string' && c.includes('項目名'));
        if (nIdx !== -1) {
          nameIdx = nIdx;
          amountIdx = row.findIndex(c => typeof c === 'string' && c.includes('金額（未稅）'));
          dataStartIndex = i + 1;
          break;
        }
      }

      if (nameIdx !== -1 && dataStartIndex !== -1) {
        let total = 0;
        const parsedData = [];

        for (let i = dataStartIndex; i < rows.length; i++) {
          const row = rows[i];
          if (!row[nameIdx]) continue;

          const rawName = row[nameIdx].toString();
          let orderId = '';
          let projectName = rawName;

          const match = rawName.match(/^([A-Za-z0-9]+)[：:](.*)/);
          if (match) {
            orderId = match[1].trim();
            projectName = match[2].trim();
          }

          let rawAmount = row[amountIdx] ? row[amountIdx].toString() : '0';
          const amount = parseInt(rawAmount.replace(/[^\d]/g, ''), 10) || 0;
          total += amount;

          parsedData.push({
            id: `inv-${Math.random().toString(36).substring(2, 11)}`,
            orderId,
            projectName,
            amount
          });
        }
        setInvoiceData(parsedData);
        setInvoiceTotal(total);
      } else {
        alert("找不到對應的欄位（需要「項目名」與「金額（未稅）」），請確認檔案格式是否正確。");
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = null; 
  };


  // --- 4. 工具函數與資料處理 ---
  
  // 新增：安全複製到剪貼簿功能 (避免 iFrame Policy 阻擋)
  const copyToClipboard = (text) => {
    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      // 避免視窗捲動與顯示
      textArea.style.position = "fixed";
      textArea.style.top = "0";
      textArea.style.left = "-9999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      
      if (successful) {
        alert('複製成功！');
      } else {
        alert('複製失敗，請手動圈選文字複製。');
      }
    } catch (err) {
      console.error('複製失敗:', err);
      alert('無法存取剪貼簿，請手動複製。');
    }
  };

  const handleOrderIdChange = (id, newOrderId) => {
    setResults(prevResults => prevResults.map(item => 
      item.id === id ? { ...item, data: { ...item.data, orderId: newOrderId } } : item
    ));
  };

  const handleProjectNameChange = (id, newProjectName) => {
    setResults(prevResults => prevResults.map(item => 
      item.id === id ? { ...item, data: { ...item.data, projectName: newProjectName } } : item
    ));
  };

  const handleDeletePDFItem = (id) => {
    if(window.confirm('確定要刪除這筆報價單紀錄嗎？')) {
      setResults(prev => prev.filter(item => item.id !== id));
    }
  };

  const handleDeleteAllPDF = () => {
    if(window.confirm('確定要清空所有報價單紀錄嗎？')) {
      setResults([]);
    }
  };

  const handleDeleteInvoiceItem = (id) => {
    if(window.confirm('確定要刪除這筆發票紀錄嗎？')) {
      setInvoiceData(prev => {
        const newData = prev.filter(item => item.id !== id);
        const newTotal = newData.reduce((sum, item) => sum + item.amount, 0);
        setInvoiceTotal(newTotal);
        return newData;
      });
    }
  };

  const handleDeleteAllInvoice = () => {
    if(window.confirm('確定要清空所有發票紀錄嗎？')) {
      setInvoiceData([]);
      setInvoiceTotal(0);
    }
  };

  const formatWithCommas = (numStr) => {
    if (numStr === null || numStr === undefined) return '-';
    const num = parseInt(numStr, 10);
    return isNaN(num) ? '0' : new Intl.NumberFormat('zh-TW').format(num);
  };

  const availableCategories = useMemo(() => {
    const categories = new Set(results.map(r => r.status === 'success' ? r.data.category : '解析失敗'));
    return ['全部', ...Array.from(categories)].sort();
  }, [results]);

  const filteredResults = useMemo(() => {
    if (filterCategory === '全部') return results;
    return results.filter(r => {
      const cat = r.status === 'success' ? r.data.category : '解析失敗';
      return cat === filterCategory;
    });
  }, [results, filterCategory]);

  const stats = useMemo(() => {
    const successItems = filteredResults.filter(r => r.status === 'success');
    const totalAmount = successItems.reduce((sum, r) => sum + (parseInt(r.data.totalExclTax, 10) || 0), 0);
    return {
      totalCount: filteredResults.length,
      successCount: successItems.length,
      totalAmount: totalAmount
    };
  }, [filteredResults]);

  const groupedResults = useMemo(() => {
    return filteredResults.reduce((acc, curr) => {
      const category = curr.status === 'success' ? curr.data.category : '解析失敗';
      if (!acc[category]) acc[category] = [];
      acc[category].push(curr);
      return acc;
    }, {});
  }, [filteredResults]);

  const sortedCategories = Object.keys(groupedResults).sort((a, b) => {
    if (a === '解析失敗') return 1;
    if (b === '解析失敗') return -1;
    return a.localeCompare(b, 'zh-TW');
  });

  const exportToCSV = () => {
    const header = "\uFEFF專案分類,單號,案件名稱,功能測試,測試器材,管理費,合計未稅\n";
    
    const sortedSuccessResults = [...filteredResults]
      .filter(r => r.status === 'success')
      .sort((a, b) => {
        const catCompare = a.data.category.localeCompare(b.data.category, 'zh-TW');
        if (catCompare !== 0) return catCompare;
        return (a.data.orderId || '').localeCompare(b.data.orderId || '');
      });

    const rows = sortedSuccessResults
      .map(r => `"${r.data.category}","${r.data.orderId}","${r.data.projectName}",${r.data.functionalTestAmount},${r.data.deviceAmount},${r.data.managementFee},${r.data.totalExclTax}`)
      .join("\n");
      
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `報價匯整_${new Date().toLocaleDateString()}.csv`;
    a.click();
  };

  // --- 比對邏輯 ---
  const comparisonResults = useMemo(() => {
    const pdfValid = results.filter(r => r.status === 'success');
    
    const allIds = new Set([
      ...pdfValid.map(r => r.data.orderId).filter(id => id && id.trim() !== ''),
      ...invoiceData.map(i => i.orderId).filter(id => id && id.trim() !== '')
    ]);

    const compData = Array.from(allIds).map(id => {
      const pItem = pdfValid.find(r => r.data.orderId === id);
      const iItem = invoiceData.find(i => i.orderId === id);

      const pName = pItem ? pItem.data.projectName : '- (無此單號)';
      const iName = iItem ? iItem.projectName : '- (無此單號)';
      const pAmt = pItem ? parseInt(pItem.data.totalExclTax, 10) || 0 : null;
      const iAmt = iItem ? iItem.amount : null;

      const idMatch = !!(pItem && iItem); 
      const amtMatch = (pItem && iItem) && (pAmt === iAmt);
      const overallMatch = idMatch && amtMatch;

      return {
        orderId: id,
        pName, iName,
        pAmt, iAmt,
        idMatch, amtMatch, overallMatch
      };
    });

    return compData.sort((a, b) => a.orderId.localeCompare(b.orderId));
  }, [results, invoiceData]);

  // --- 驗收單資料整理邏輯 ---
  const acceptanceData = useMemo(() => {
    const validResults = results.filter(r => r.status === 'success');
    
    const deptMap = {
      '明星3缺1': '研五',
      '競技麻將2': '研五',
      'social casino': '研五',
      '滿貫大亨': '研二',
      '滿貫大亨Web館': '研二',
      '玩星派對': '研三',
      '唯舞獨尊': '研三'
    };
    const deptOrder = { '研五': 1, '研二': 2, '研三': 3, '其他': 4 };

    let overallTotal = 0; // 計算總金額

    const grouped = validResults.reduce((acc, curr) => {
      const cat = curr.data.category;
      const dept = deptMap[cat] || '其他';
      if (!acc[cat]) {
        acc[cat] = {
          dept,
          category: cat,
          orderIds: [],
          projectNames: [],
          totalAmount: 0,
          deptRank: deptOrder[dept] || 99
        };
      }
      if (curr.data.orderId) acc[cat].orderIds.push(curr.data.orderId);
      if (curr.data.projectName) acc[cat].projectNames.push(curr.data.projectName);
      acc[cat].totalAmount += (parseInt(curr.data.totalExclTax, 10) || 0);
      return acc;
    }, {});

    const sortedCategories = Object.values(grouped).sort((a, b) => {
      if (a.deptRank !== b.deptRank) return a.deptRank - b.deptRank;
      return a.category.localeCompare(b.category, 'zh-TW');
    });

    const allOrderIds = sortedCategories.flatMap(g => g.orderIds).filter(Boolean);

    const cleanProjectName = (name, category) => {
      // 需求3：如果是 social casino，不要替換掉原本的名稱，原汁原味呈現 VF_... 等等
      if (category === 'social casino') return name;

      let cleaned = name;
      const prefixes = [
        `${category}_`, `${category}-`, `${category} `,
        `【${category}】`, `[${category}]`,
        `滿貫Web館_`
      ];
      for (const p of prefixes) {
        if (cleaned.startsWith(p)) {
          cleaned = cleaned.substring(p.length).trim();
          break;
        }
      }
      return cleaned;
    };

    const box2Lines = sortedCategories.map(g => {
      const cleanedNames = g.projectNames.map(name => cleanProjectName(name, g.category));
      const uniqueProjects = [...new Set(cleanedNames.filter(n => n))]; 
      
      let prefix = g.category;
      // 根據需求範例，social casino 和 滿貫大亨 都不需要再強制加上分類前綴
      if (g.category === '滿貫大亨' || g.category === 'social casino') prefix = '';
      
      const displayName = prefix ? `${prefix}_${uniqueProjects.join('、')}` : uniqueProjects.join('、');
      
      // 加總到全部總金額
      overallTotal += g.totalAmount;

      // ✅ 調整處：在此字串中，於部門後方加上【專案分類】
      return `【${g.dept}】【${g.category}】${displayName}  共${formatWithCommas(g.totalAmount)}`;
    });

    return {
      orderIdsText: allOrderIds.join('、'),
      detailsText: box2Lines.join('\n'),
      overallTotal: overallTotal
    };
  }, [results]);

  // 當解析資料有變動時，自動將資料同步到可以編輯的框框裡
  useEffect(() => {
    setEditableOrderIds(acceptanceData.orderIdsText);
    setEditableDetails(acceptanceData.detailsText);
  }, [acceptanceData]);

  // --- 5. UI 渲染 ---
  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-10 font-sans">
      <div className="max-w-[1400px] mx-auto">
        
        {/* 頭部標題與匯出區 */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-black text-slate-800">精準對帳處理中心</h1>
            <p className="text-slate-500 mt-1">自動識別專案分類金額，支援發票檔案對接查驗</p>
          </div>
          
          <div className="flex flex-wrap items-center gap-3">
            {activeTab === 'parser' && results.length > 0 && (
              <>
                <button onClick={handleDeleteAllPDF} className="flex items-center gap-2 bg-rose-50 text-rose-600 px-4 py-3 rounded-2xl font-bold hover:bg-rose-100 transition-all border border-rose-100 shadow-sm shrink-0">
                  <Trash2 size={20} /> 清空全部
                </button>
                <button onClick={exportToCSV} className="flex items-center gap-2 bg-emerald-600 text-white px-6 py-3 rounded-2xl font-bold hover:bg-emerald-700 transition-all shadow-lg shrink-0">
                  <Download size={20} /> 匯出當前報表
                </button>
              </>
            )}

            {activeTab === 'invoice' && invoiceData.length > 0 && (
              <button onClick={handleDeleteAllInvoice} className="flex items-center gap-2 bg-rose-50 text-rose-600 px-4 py-3 rounded-2xl font-bold hover:bg-rose-100 transition-all border border-rose-100 shadow-sm shrink-0">
                <Trash2 size={20} /> 清空全部
              </button>
            )}
          </div>
        </div>

        {/* 頁籤控制 */}
        <div className="flex flex-wrap gap-4 mb-8">
          <button
            onClick={() => setActiveTab('parser')}
            className={`flex items-center gap-2 px-6 py-3 rounded-2xl font-bold transition-all shadow-sm ${activeTab === 'parser' ? 'bg-indigo-600 text-white shadow-indigo-200' : 'bg-white text-slate-500 hover:bg-slate-50 border border-slate-200'}`}
          >
            <FileText size={20} /> PDF 報價單解析
          </button>
          <button
            onClick={() => setActiveTab('invoice')}
            className={`flex items-center gap-2 px-6 py-3 rounded-2xl font-bold transition-all shadow-sm ${activeTab === 'invoice' ? 'bg-indigo-600 text-white shadow-indigo-200' : 'bg-white text-slate-500 hover:bg-slate-50 border border-slate-200'}`}
          >
            <FileSpreadsheet size={20} /> XLSX 發票資料
          </button>
          <button
            onClick={() => setActiveTab('compare')}
            className={`flex items-center gap-2 px-6 py-3 rounded-2xl font-bold transition-all shadow-sm ${activeTab === 'compare' ? 'bg-indigo-600 text-white shadow-indigo-200' : 'bg-white text-slate-500 hover:bg-slate-50 border border-slate-200'}`}
          >
            <FileCheck size={20} /> 資料比對中心
          </button>
          <button
            onClick={() => setActiveTab('acceptance')}
            className={`flex items-center gap-2 px-6 py-3 rounded-2xl font-bold transition-all shadow-sm ${activeTab === 'acceptance' ? 'bg-indigo-600 text-white shadow-indigo-200' : 'bg-white text-slate-500 hover:bg-slate-50 border border-slate-200'}`}
          >
            <ClipboardCheck size={20} /> 報價單驗收單
          </button>
        </div>

        {/* =======================
            分頁 1：PDF 報價單解析 
        ======================= */}
        {activeTab === 'parser' && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div 
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }} 
              onDragLeave={() => setIsDragging(false)} 
              onDrop={(e) => { e.preventDefault(); setIsDragging(false); processFiles(Array.from(e.dataTransfer.files)); }}
              className={`relative border-4 border-dashed rounded-[2.5rem] p-10 mb-8 flex flex-col items-center transition-all ${isDragging ? 'bg-indigo-50 border-indigo-400 scale-[0.99]' : 'bg-white border-slate-200'}`}
            >
              <input type="file" multiple accept=".pdf" onChange={(e) => processFiles(Array.from(e.target.files))} className="absolute inset-0 opacity-0 cursor-pointer" />
              <UploadCloud size={60} className="text-indigo-400 mb-4" />
              <h2 className="text-xl font-bold text-slate-700">點擊或拖放 PDF 檔案</h2>
            </div>

            {isProcessing && (
              <div className="mb-8 p-6 bg-indigo-600 rounded-3xl shadow-xl flex items-center justify-between text-white">
                <div className="flex items-center gap-4">
                  <Loader2 className="animate-spin" />
                  <span className="text-lg font-bold">正在處理第 {progress.current} 頁 / 共 {progress.total} 頁</span>
                </div>
                <div className="bg-white/20 px-4 py-1 rounded-full text-sm font-mono">
                  {Math.round((progress.current / (progress.total || 1)) * 100)}%
                </div>
              </div>
            )}

            {results.length > 0 && (
              <div className="mb-8 grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100 flex flex-col justify-center">
                  <label className="text-sm font-bold text-slate-400 mb-2 flex items-center gap-2">
                    <Filter size={16} /> 專案篩選
                  </label>
                  <select 
                    value={filterCategory} 
                    onChange={(e) => setFilterCategory(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 text-slate-700 rounded-xl px-4 py-3 font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all cursor-pointer"
                  >
                    {availableCategories.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
                <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100 flex flex-col justify-center">
                  <div className="text-sm font-bold text-slate-400 mb-1">當前列表總件數</div>
                  <div className="text-3xl font-black text-slate-800">
                    {stats.totalCount} <span className="text-base font-medium text-slate-500">件</span>
                  </div>
                </div>
                <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100 flex flex-col justify-center">
                  <div className="text-sm font-bold text-slate-400 mb-1">成功解析數</div>
                  <div className="text-3xl font-black text-emerald-600">
                    {stats.successCount} <span className="text-base font-medium text-slate-500">件</span>
                  </div>
                </div>
                <div className="bg-gradient-to-br from-indigo-600 to-blue-700 p-6 rounded-[2rem] shadow-md flex flex-col justify-center text-white">
                  <div className="text-sm font-bold text-indigo-100 mb-1 flex items-center gap-2">
                    <BarChart3 size={16} /> 總計未稅金額 (TWD)
                  </div>
                  <div className="text-3xl font-black">
                    $ {formatWithCommas(stats.totalAmount)}
                  </div>
                </div>
              </div>
            )}

            {results.length > 0 && (
              <div className="bg-white rounded-[2rem] shadow-xl border border-slate-100 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50 border-b border-slate-100">
                      <tr>
                        <th className="px-6 py-6 text-indigo-600 font-black text-xs uppercase w-32 whitespace-nowrap">專案分類</th>
                        <th className="px-4 py-6 text-slate-400 font-bold text-xs uppercase whitespace-nowrap w-40">單號 (點擊修改)</th>
                        <th className="px-6 py-6 text-slate-400 font-bold text-xs uppercase min-w-[250px]">案件名稱 (點擊修改)</th>
                        <th className="px-4 py-6 text-slate-500 font-bold text-xs text-right whitespace-nowrap">功能測試</th>
                        <th className="px-4 py-6 text-slate-500 font-bold text-xs text-right whitespace-nowrap">測試器材</th>
                        <th className="px-4 py-6 text-slate-500 font-bold text-xs text-right whitespace-nowrap">管理費</th>
                        <th className="px-4 py-6 text-slate-500 font-bold text-xs text-right whitespace-nowrap">合計未稅</th>
                        <th className="px-6 py-6 text-center text-slate-400 font-bold text-xs uppercase whitespace-nowrap">狀態</th>
                        <th className="px-4 py-6 text-center text-slate-400 font-bold text-xs uppercase whitespace-nowrap">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {sortedCategories.length === 0 ? (
                        <tr>
                          <td colSpan="9" className="px-6 py-12 text-center text-slate-400 font-bold">沒有符合的資料</td>
                        </tr>
                      ) : (
                        sortedCategories.map(category => (
                          <React.Fragment key={category}>
                            <tr className="bg-indigo-50/50 border-y border-indigo-100/50">
                              <td colSpan="9" className="px-6 py-3 font-bold text-indigo-800 text-sm">
                                📁 {category} <span className="text-indigo-400 font-normal ml-2">({groupedResults[category].length} 筆)</span>
                              </td>
                            </tr>
                            {groupedResults[category]
                              .sort((a, b) => {
                                if (a.status !== 'success' || b.status !== 'success') return 0;
                                return (a.data.orderId || '').localeCompare(b.data.orderId || '');
                              })
                              .map((res) => (
                              <tr key={res.id} className="hover:bg-slate-50/50 transition-all group">
                                <td className="px-6 py-4">
                                  <span className={`px-4 py-1.5 rounded-xl font-bold text-xs whitespace-nowrap ${res.status === 'success' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100'}`}>
                                    {res.status === 'success' ? res.data.category : 'N/A'}
                                  </span>
                                </td>
                                <td className="px-4 py-4">
                                  {res.status === 'success' ? (
                                    <input 
                                      type="text" 
                                      value={res.data.orderId || ''} 
                                      onChange={(e) => handleOrderIdChange(res.id, e.target.value)}
                                      className="w-24 px-2 py-1.5 font-mono font-bold text-slate-600 bg-transparent hover:bg-slate-200/50 focus:bg-white border border-transparent focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 rounded transition-all outline-none"
                                      placeholder="填寫單號"
                                    />
                                  ) : '-'}
                                </td>
                                <td className="px-6 py-4">
                                  {res.status === 'success' ? (
                                    <input 
                                      type="text" 
                                      value={res.data.projectName || ''} 
                                      onChange={(e) => handleProjectNameChange(res.id, e.target.value)}
                                      className="w-full min-w-[250px] px-2 py-1.5 font-semibold text-slate-700 bg-transparent hover:bg-slate-200/50 focus:bg-white border border-transparent focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 rounded transition-all outline-none"
                                      placeholder="填寫案件名稱"
                                    />
                                  ) : (
                                    <div className="min-w-[250px] font-semibold text-slate-700">{res.fileName}</div>
                                  )}
                                </td>
                                <td className="px-4 py-4 text-right font-mono text-slate-600 whitespace-nowrap">{res.status === 'success' ? formatWithCommas(res.data.functionalTestAmount) : '-'}</td>
                                <td className="px-4 py-4 text-right font-mono text-slate-600 whitespace-nowrap">{res.status === 'success' ? formatWithCommas(res.data.deviceAmount) : '-'}</td>
                                <td className="px-4 py-4 text-right font-mono text-slate-600 whitespace-nowrap">{res.status === 'success' ? formatWithCommas(res.data.managementFee) : '-'}</td>
                                <td className="px-4 py-4 text-right font-mono font-black text-blue-700 whitespace-nowrap">{res.status === 'success' ? formatWithCommas(res.data.totalExclTax) : '-'}</td>
                                <td className="px-6 py-4 text-center">
                                  {res.status === 'success' ? <CheckCircle2 className="text-emerald-500 inline" /> : <AlertCircle className="text-rose-500 inline" />}
                                </td>
                                <td className="px-4 py-4 text-center">
                                  <button onClick={() => handleDeletePDFItem(res.id)} className="p-2 bg-transparent hover:bg-rose-100 rounded-xl text-slate-300 hover:text-rose-500 transition-colors" title="刪除此筆">
                                    <Trash2 size={18} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </React.Fragment>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* =======================
            分頁 2：XLSX 發票資料
        ======================= */}
        {activeTab === 'invoice' && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="relative border-4 border-dashed border-slate-200 rounded-[2.5rem] p-10 mb-8 flex flex-col items-center bg-white transition-all hover:bg-emerald-50 hover:border-emerald-300 group">
              <input type="file" accept=".xlsx, .xls, .csv" onChange={processInvoiceFile} className="absolute inset-0 opacity-0 cursor-pointer z-10" />
              <UploadCloud size={60} className="text-emerald-400 mb-4 group-hover:scale-110 transition-transform" />
              <h2 className="text-xl font-bold text-slate-700">點擊或拖放 XLSX 發票檔案</h2>
              <p className="text-slate-400 mt-2 text-sm">系統會自動將單號與專案名稱分離</p>
            </div>

            {invoiceData.length > 0 && (
              <div className="bg-white rounded-[2rem] shadow-xl border border-slate-100 overflow-hidden">
                <div className="bg-emerald-50/50 border-b border-slate-100 px-6 py-4 flex justify-between items-center">
                  <h3 className="font-bold text-slate-700 flex items-center gap-2">
                    <List size={20} className="text-emerald-600"/> 已載入發票明細
                  </h3>
                  <div className="bg-white px-4 py-1.5 rounded-full border border-slate-200 text-sm font-bold text-slate-500 shadow-sm">
                    共 {invoiceData.length} 筆資料
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50 border-b border-slate-100">
                      <tr>
                        <th className="px-6 py-6 text-slate-400 font-bold text-xs uppercase w-32 whitespace-nowrap">單號</th>
                        <th className="px-6 py-6 text-slate-400 font-bold text-xs uppercase min-w-[250px]">案件名稱</th>
                        <th className="px-6 py-6 text-slate-400 font-bold text-xs uppercase text-right whitespace-nowrap">金額 (未稅)</th>
                        <th className="px-6 py-6 text-slate-400 font-bold text-xs uppercase text-center whitespace-nowrap w-24">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {invoiceData.map((item) => (
                        <tr key={item.id} className="hover:bg-slate-50/50 transition-all">
                          <td className="px-6 py-4">
                            <span className="px-3 py-1 bg-slate-100 text-slate-700 font-mono font-bold rounded-lg text-sm">
                              {item.orderId || '-'}
                            </span>
                          </td>
                          <td className="px-6 py-4 font-semibold text-slate-700">{item.projectName}</td>
                          <td className="px-6 py-4 text-right font-mono text-slate-600 whitespace-nowrap">
                            {formatWithCommas(item.amount)}
                          </td>
                          <td className="px-6 py-4 text-center">
                            <button onClick={() => handleDeleteInvoiceItem(item.id)} className="p-2 bg-transparent hover:bg-rose-100 rounded-xl text-slate-300 hover:text-rose-500 transition-colors" title="刪除此筆">
                              <Trash2 size={18} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-50/80 border-t-2 border-slate-100">
                      <tr>
                        <td colSpan="2" className="px-6 py-6 text-right font-bold text-slate-500 uppercase">合計未稅金額</td>
                        <td className="px-6 py-6 text-right font-mono font-black text-blue-700 text-2xl whitespace-nowrap">
                          $ {formatWithCommas(invoiceTotal)}
                        </td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* =======================
            分頁 3：資料比對中心
        ======================= */}
        {activeTab === 'compare' && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            {comparisonResults.length === 0 ? (
              <div className="bg-white border-2 border-dashed border-slate-200 rounded-[2.5rem] p-16 flex flex-col items-center text-slate-400">
                <FileCheck size={64} className="mb-4 text-slate-300" />
                <h3 className="text-xl font-bold mb-2">尚無比對資料</h3>
                <p>請先上傳「PDF 報價單」與「XLSX 發票資料」以進行比對</p>
              </div>
            ) : (
              <div className="bg-white rounded-[2rem] shadow-xl border border-slate-100 overflow-hidden">
                <div className="bg-indigo-50/50 border-b border-slate-100 px-6 py-4 flex justify-between items-center">
                  <h3 className="font-bold text-indigo-800 flex items-center gap-2">
                    <Scale size={20} className="text-indigo-600"/> 報價單與發票比對清單
                  </h3>
                  <div className="bg-white px-4 py-1.5 rounded-full border border-slate-200 text-sm font-bold text-slate-500 shadow-sm">
                    共比對 {comparisonResults.length} 筆單號
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 border-b border-slate-100">
                      <tr>
                        <th className="px-4 py-5 text-slate-400 font-bold uppercase whitespace-nowrap">單號</th>
                        <th className="px-4 py-5 text-slate-500 font-bold uppercase min-w-[200px]">PDF 案件名稱</th>
                        <th className="px-4 py-5 text-slate-500 font-bold uppercase min-w-[200px]">XLSX 案件名稱</th>
                        <th className="px-4 py-5 text-center text-slate-400 font-bold uppercase whitespace-nowrap">單號比對</th>
                        <th className="px-4 py-5 text-right text-slate-500 font-bold uppercase whitespace-nowrap">PDF 金額</th>
                        <th className="px-4 py-5 text-right text-slate-500 font-bold uppercase whitespace-nowrap">XLSX 金額</th>
                        <th className="px-4 py-5 text-center text-slate-400 font-bold uppercase whitespace-nowrap">金額比對</th>
                        <th className="px-4 py-5 text-center text-indigo-600 font-black uppercase whitespace-nowrap">總結</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {comparisonResults.map((item, idx) => (
                        <tr key={idx} className={`transition-all ${!item.overallMatch ? 'bg-rose-50/30 hover:bg-rose-50' : 'hover:bg-slate-50/50'}`}>
                          <td className="px-4 py-4">
                            <span className="px-2 py-1 bg-slate-100 text-slate-700 font-mono font-bold rounded text-xs">
                              {item.orderId}
                            </span>
                          </td>
                          <td className={`px-4 py-4 ${!item.idMatch ? 'text-rose-600 font-semibold' : 'text-slate-600'}`}>{item.pName}</td>
                          <td className={`px-4 py-4 ${!item.idMatch ? 'text-rose-600 font-semibold' : 'text-slate-600'}`}>{item.iName}</td>
                          <td className="px-4 py-4 text-center">
                            {item.idMatch ? <span className="text-emerald-500 font-black text-lg">O</span> : <span className="text-rose-500 font-black text-lg">X</span>}
                          </td>
                          <td className={`px-4 py-4 text-right font-mono ${!item.amtMatch ? 'text-rose-600 font-semibold' : 'text-slate-600'}`}>
                            {formatWithCommas(item.pAmt)}
                          </td>
                          <td className={`px-4 py-4 text-right font-mono ${!item.amtMatch ? 'text-rose-600 font-semibold' : 'text-slate-600'}`}>
                            {formatWithCommas(item.iAmt)}
                          </td>
                          <td className="px-4 py-4 text-center">
                            {item.amtMatch ? <span className="text-emerald-500 font-black text-lg">O</span> : <span className="text-rose-500 font-black text-lg">X</span>}
                          </td>
                          <td className="px-4 py-4 text-center">
                            {item.overallMatch ? (
                              <span className="px-3 py-1 bg-emerald-100 text-emerald-700 font-black rounded-lg">O 相符</span>
                            ) : (
                              <span className="px-3 py-1 bg-rose-100 text-rose-700 font-black rounded-lg">X 異常</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* =======================
            分頁 4：報價單驗收單
        ======================= */}
        {activeTab === 'acceptance' && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="bg-white rounded-[2rem] shadow-xl border border-slate-100 p-8 md:p-10">
              <h2 className="text-2xl font-black text-slate-800 mb-8 flex items-center gap-3">
                <ClipboardCheck className="text-indigo-600" size={32} /> 報價單驗收總表
              </h2>
              
              <div className="mb-10">
                <h3 className="text-lg font-bold text-slate-700 mb-4 flex items-center justify-between">
                  1. 專案單號總覽 (依研五、研二、研三排序)
                  <button 
                    onClick={() => copyToClipboard(editableOrderIds)} 
                    className="text-sm bg-indigo-50 hover:bg-indigo-100 text-indigo-600 font-bold px-4 py-2 rounded-xl transition-colors shadow-sm"
                  >
                    複製單號
                  </button>
                </h3>
                <textarea 
                  ref={orderIdsRef}
                  value={editableOrderIds}
                  onChange={(e) => setEditableOrderIds(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-6 font-mono text-slate-600 min-h-[120px] whitespace-pre-wrap break-all leading-relaxed shadow-inner outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all resize-none overflow-hidden"
                  placeholder="尚無單號資料"
                />
              </div>

              <div>
                <h3 className="text-lg font-bold text-slate-700 mb-4 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center">
                    2. 費用金額總結
                    <span className="ml-4 text-indigo-700 bg-indigo-100 font-black px-4 py-1.5 rounded-xl text-lg shadow-sm">
                      全部總計: $ {formatWithCommas(acceptanceData.overallTotal)}
                    </span>
                  </div>
                  <button 
                    onClick={() => copyToClipboard(editableDetails)} 
                    className="text-sm bg-indigo-50 hover:bg-indigo-100 text-indigo-600 font-bold px-4 py-2 rounded-xl transition-colors shadow-sm"
                  >
                    複製內容
                  </button>
                </h3>
                <textarea 
                  ref={detailsRef}
                  value={editableDetails}
                  onChange={(e) => setEditableDetails(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-6 font-sans text-slate-700 min-h-[150px] whitespace-pre-wrap leading-loose shadow-inner font-medium text-lg outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all resize-none overflow-hidden"
                  placeholder="尚無費用資料"
                />
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default App;
