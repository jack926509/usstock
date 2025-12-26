
import React, { useState, useEffect, useCallback, useRef, useMemo, Suspense, lazy } from 'react';
import { marked } from 'marked';
import { ToastProvider, useToast } from './components/Toast';
import { Modal } from './components/Modal';
import { analyzeImage, sendChat, fetchMarketIndices, IndexData } from './services/geminiService';
import { ChatMessage, TabType, AnalysisState } from './types';

const TradingViewWidget = lazy(() => import('./components/TradingViewWidget').then(module => ({ default: module.TradingViewWidget })));

const INITIAL_CHIPS = ['NVDA', 'TSLA', 'AAPL', 'BTCUSD', 'NAS100'];

// 股指行情組件 - 優化視覺效果
const MarketIndices: React.FC<{ data: IndexData[]; loading: boolean; onRefresh: () => void }> = React.memo(({ data, loading, onRefresh }) => (
  <div className="hidden lg:flex items-center px-4 gap-3">
    {(data && data.length > 0) ? (
      <div className="flex items-center gap-2 animate-fade-in">
        {data.map((idx, i) => (
          <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-200/50 bg-white/40 backdrop-blur-sm shadow-sm hover:border-slate-300 transition-all cursor-default">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-tight">{idx.name}</span>
            <div className={`flex items-center gap-1 font-mono font-bold text-[11px] ${idx.isUp ? 'text-emerald-500' : 'text-rose-500'}`}>
              <span>{idx.change > 0 ? '▲' : '▼'}</span>
              <span className="whitespace-nowrap">{Math.abs(idx.change).toFixed(1)}</span>
              <span className={`ml-1 px-1 rounded text-[9px] ${idx.isUp ? 'bg-emerald-50' : 'bg-rose-50'}`}>
                {idx.percent}
              </span>
            </div>
          </div>
        ))}
        <button 
          onClick={onRefresh} 
          disabled={loading} 
          className={`p-1.5 rounded-lg text-slate-300 hover:text-slate-600 transition-all ${loading ? 'animate-spin' : ''}`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
        </button>
      </div>
    ) : (
      <div className="flex gap-2">
        {[1, 2, 3].map(i => <div key={i} className="w-24 h-8 bg-slate-100/50 rounded-xl animate-pulse" />)}
      </div>
    )}
  </div>
));

const ChatItem: React.FC<{ msg: ChatMessage }> = React.memo(({ msg }) => {
  const content = useMemo(() => (
    msg.role === 'user' ? msg.text : <div className="markdown-body prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: marked.parse(msg.text) as string }} />
  ), [msg.text, msg.role]);

  return (
    <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} mb-5`}>
      <div className={`max-w-[90%] px-4 py-3 rounded-2xl shadow-sm text-[13px] leading-relaxed ${msg.role === 'user' ? 'bg-slate-900 text-white rounded-tr-none' : 'bg-white border border-slate-100 text-slate-800 rounded-tl-none ring-1 ring-slate-50'}`}>
        {content}
      </div>
    </div>
  );
});

const AppContent: React.FC = () => {
  const { showToast } = useToast();
  const [symbol, setSymbol] = useState<string>('NVDA');
  const [tempSymbol, setTempSymbol] = useState<string>('NVDA');
  const [activeTab, setActiveTab] = useState<TabType>('analysis');
  const [isDesktop, setIsDesktop] = useState(true);
  
  const [indices, setIndices] = useState<IndexData[]>([]);
  const [indicesLoading, setIndicesLoading] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [isKeyModalOpen, setIsKeyModalOpen] = useState(false);

  const checkKeyStatus = useCallback(async () => {
    if (window.aistudio) {
      const selected = await window.aistudio.hasSelectedApiKey();
      setHasKey(selected);
      if (!selected) setIsKeyModalOpen(true);
    } else {
      const apiKey = process.env.API_KEY;
      const exists = !!apiKey && apiKey !== '""' && apiKey !== "''";
      setHasKey(exists);
      if (!exists) setIsKeyModalOpen(true);
    }
  }, []);

  useEffect(() => { checkKeyStatus(); }, [checkKeyStatus]);

  const refreshIndices = useCallback(async () => {
    if (indicesLoading || !hasKey) return;
    setIndicesLoading(true);
    try {
      const data = await fetchMarketIndices();
      if (data && data.length > 0) setIndices(data);
    } catch (e: any) {
      if (e.message === "AUTH_REQUIRED") {
        setHasKey(false);
        setIsKeyModalOpen(true);
      }
    } finally {
      setIndicesLoading(false);
    }
  }, [indicesLoading, hasKey]);

  useEffect(() => {
    if (hasKey) {
      refreshIndices();
      const interval = setInterval(refreshIndices, 300000);
      return () => clearInterval(interval);
    }
  }, [hasKey, refreshIndices]);

  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([{ role: 'model', text: "終端已連線。請上傳 K 線圖截圖，我將為您進行深度技術分析。" }]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  
  const [analysis, setAnalysis] = useState<AnalysisState>({ 
    isAnalyzing: false, result: null, summary: null, error: null, imageBase64: null 
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const checkSize = () => setIsDesktop(window.innerWidth >= 1024);
    checkSize();
    window.addEventListener('resize', checkSize);
    return () => window.removeEventListener('resize', checkSize);
  }, []);

  const handleImageUpload = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64String = reader.result as string;
      const base64Data = base64String.split(',')[1];
      setAnalysis({ isAnalyzing: true, result: null, summary: null, error: null, imageBase64: base64String });
      setActiveTab('analysis');
      showToast('正在解析影像數據...');
      try {
        const { summary, analysis: markdownResult } = await analyzeImage(symbol, base64Data, file.type);
        const htmlResult = await marked.parse(markdownResult);
        setAnalysis(prev => ({ ...prev, isAnalyzing: false, result: htmlResult as string, summary }));
        showToast('分析報告已生成');
      } catch (err: any) {
        if (err.message === "AUTH_REQUIRED") {
          setHasKey(false);
          setIsKeyModalOpen(true);
        }
        setAnalysis(prev => ({ ...prev, isAnalyzing: false, error: err.message }));
        showToast(err.message === "AUTH_REQUIRED" ? "請重新選取金鑰" : "分析失敗", 'error');
      }
    };
    reader.readAsDataURL(file);
  }, [symbol, showToast]);

  const handleChatSubmit = useCallback(async () => {
    if (!chatInput.trim() || isChatLoading || !hasKey) return;
    const userMsg: ChatMessage = { role: 'user', text: chatInput };
    const newHistory = [...chatHistory, userMsg];
    setChatHistory(newHistory);
    setChatInput('');
    setIsChatLoading(true);
    try {
      const response = await sendChat(newHistory, symbol, analysis.summary || "");
      setChatHistory(prev => [...prev, { role: 'model', text: response }]);
    } catch (err: any) {
      if (err.message === "AUTH_REQUIRED") {
        setHasKey(false);
        setIsKeyModalOpen(true);
      }
      showToast(err.message || "請求失敗", "error");
    } finally {
      setIsChatLoading(false);
    }
  }, [chatInput, chatHistory, isChatLoading, hasKey, symbol, analysis.summary, showToast]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatHistory]);

  return (
    <div className="h-screen flex flex-col bg-[#F8FAFC] overflow-hidden font-sans text-slate-900 selection:bg-emerald-100">
      <header className="h-14 bg-white border-b border-slate-200/60 px-5 flex items-center justify-between z-50 flex-shrink-0 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-slate-950 rounded-xl flex items-center justify-center text-white font-black text-xl shadow-lg">M</div>
          <div className="hidden sm:block">
            <h1 className="text-[12px] font-black tracking-tighter uppercase">MA Pro Terminal</h1>
            <p className="text-[9px] text-slate-400 font-bold uppercase tracking-[0.2em]">AI Intelligence</p>
          </div>
        </div>

        <MarketIndices data={indices} loading={indicesLoading} onRefresh={refreshIndices} />

        <div className="flex items-center gap-2">
          <button onClick={() => setIsKeyModalOpen(true)} className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-100 hover:bg-slate-50 transition-all">
            <div className={`w-2 h-2 rounded-full ${hasKey ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse' : 'bg-rose-500'}`} />
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              {hasKey ? 'Online' : 'Offline'}
            </span>
          </button>
        </div>
      </header>

      <main className="flex-grow flex flex-col lg:flex-row overflow-hidden relative">
        <div className="flex flex-col flex-grow h-full bg-white relative">
          <div className="h-11 border-b border-slate-100 px-4 flex items-center gap-3 overflow-x-auto no-scrollbar bg-slate-50/30">
            <div className="flex items-center bg-white rounded-lg border border-slate-200 px-2 h-7.5">
              <input 
                type="text" value={tempSymbol} 
                onChange={e => setTempSymbol(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && setSymbol(tempSymbol)}
                className="w-20 px-1 py-1 text-[11px] font-black outline-none bg-transparent"
                placeholder="代碼"
              />
              <button onClick={() => setSymbol(tempSymbol)} className="text-[10px] font-black text-slate-400 hover:text-slate-900">GO</button>
            </div>
            {INITIAL_CHIPS.map(chip => (
              <button key={chip} onClick={() => { setSymbol(chip); setTempSymbol(chip); }} className={`px-3 py-1 rounded-lg border text-[11px] font-bold transition-all ${symbol === chip ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-400 hover:border-slate-300'}`}>{chip}</button>
            ))}
          </div>

          <div className="flex-grow relative bg-slate-50">
            <Suspense fallback={<div className="h-full w-full flex items-center justify-center"><div className="w-6 h-6 border-2 border-slate-200 border-t-emerald-500 rounded-full animate-spin"></div></div>}>
              <TradingViewWidget symbol={symbol} />
            </Suspense>
            <div className="absolute bottom-6 right-6">
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="px-6 py-3.5 bg-slate-950 text-white rounded-2xl font-black text-xs shadow-2xl hover:bg-emerald-600 hover:scale-105 active:scale-95 transition-all flex items-center gap-2 group"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path></svg>
                診斷當前盤面
              </button>
            </div>
            <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={e => e.target.files?.[0] && handleImageUpload(e.target.files[0])} />
          </div>
        </div>

        <div className="flex-col bg-[#FDFDFD] border-l border-slate-200/50 flex flex-shrink-0 h-full overflow-hidden" style={{ width: isDesktop ? '400px' : '100%' }}>
          <div className="p-5 flex flex-col h-full">
             <div className="flex p-1 bg-slate-100 rounded-xl mb-5">
                <button onClick={() => setActiveTab('analysis')} className={`flex-1 py-2 text-[11px] font-black uppercase rounded-lg transition-all ${activeTab === 'analysis' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-400'}`}>分析</button>
                <button onClick={() => setActiveTab('chat')} className={`flex-1 py-2 text-[11px] font-black uppercase rounded-lg transition-all ${activeTab === 'chat' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-400'}`}>諮詢</button>
             </div>
             
             <div className="flex-grow overflow-y-auto custom-scrollbar pr-1">
                {activeTab === 'analysis' ? (
                  <div className="space-y-5">
                    {analysis.isAnalyzing ? (
                      <div className="py-20 text-center space-y-4">
                        <div className="w-10 h-10 border-2 border-slate-100 border-t-slate-900 rounded-full animate-spin mx-auto"></div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Processing Market Data</p>
                      </div>
                    ) : (
                      <>
                        {analysis.summary && (
                          <div className="bg-slate-900 text-white p-4 rounded-xl text-[13px] font-bold shadow-lg border border-slate-800">
                             <div className="flex items-center gap-2 mb-2 text-[10px] text-emerald-400 uppercase tracking-widest">
                               <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>核心結論
                             </div>
                             <div dangerouslySetInnerHTML={{ __html: analysis.summary }} />
                          </div>
                        )}
                        {analysis.result && (
                          <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm text-slate-700 leading-relaxed" dangerouslySetInnerHTML={{ __html: analysis.result }} />
                        )}
                        {!analysis.result && !analysis.isAnalyzing && (
                          <div className="py-40 text-center opacity-30">
                            <svg className="w-12 h-12 mx-auto text-slate-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
                            <p className="text-[10px] font-bold uppercase tracking-widest">等待截圖上傳</p>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4 pb-20">
                    {chatHistory.map((msg, i) => <ChatItem key={i} msg={msg} />)}
                    {isChatLoading && <div className="w-10 h-10 border-2 border-slate-100 border-t-slate-400 rounded-full animate-spin"></div>}
                    <div ref={chatEndRef} />
                  </div>
                )}
             </div>

             {activeTab === 'chat' && (
               <div className="mt-4 flex gap-2 p-1.5 bg-white rounded-2xl border border-slate-200 shadow-sm focus-within:border-slate-400 transition-all">
                  <input 
                    type="text" value={chatInput} 
                    onChange={e => setChatInput(e.target.value)} 
                    onKeyDown={e => e.key === 'Enter' && handleChatSubmit()} 
                    className="flex-grow px-3 py-2 text-sm outline-none" 
                    placeholder="詢問策略或盤面細節..." 
                  />
                  <button onClick={handleChatSubmit} disabled={!chatInput.trim() || isChatLoading} className="w-10 h-10 bg-slate-950 text-white rounded-xl flex items-center justify-center hover:bg-emerald-600 active:scale-90 transition-all">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
                  </button>
               </div>
             )}
          </div>
        </div>
      </main>

      <Modal isOpen={isKeyModalOpen} onClose={() => setIsKeyModalOpen(false)} title="授權 API 服務">
        <div className="text-center space-y-5">
          <div className="w-14 h-14 bg-slate-950 rounded-2xl flex items-center justify-center mx-auto text-emerald-400 shadow-xl ring-4 ring-emerald-500/10">
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
          </div>
          <p className="text-[11px] text-slate-500 font-bold leading-relaxed px-2 uppercase tracking-wide">需選取付費版 API Key 以啟動 AI 診斷引擎與即時行情服務。</p>
          <button onClick={() => { window.aistudio?.openSelectKey(); setIsKeyModalOpen(false); setHasKey(true); setTimeout(refreshIndices, 800); }} className="w-full py-4 bg-slate-950 text-white rounded-xl font-black text-[11px] uppercase tracking-[0.2em] hover:bg-emerald-600 transition-all">
            選取並啟動授權
          </button>
          <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" className="block text-[9px] font-bold text-slate-300 hover:text-slate-600 underline uppercase tracking-widest transition-colors">Billing Info</a>
        </div>
      </Modal>

      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .markdown-body h2 { font-size: 1rem; margin-top: 1.5rem; color: #0f172a; font-weight: 800; border-left: 3px solid #10b981; padding-left: 0.5rem; }
        .markdown-body p { margin-bottom: 0.75rem; color: #475569; }
        .markdown-body strong { color: #0f172a; }
        .markdown-body ul { padding-left: 1.25rem; list-style: disc; margin-bottom: 1rem; }
      `}</style>
    </div>
  );
};

const App: React.FC = () => (
  <ToastProvider>
    <AppContent />
  </ToastProvider>
);

export default App;
