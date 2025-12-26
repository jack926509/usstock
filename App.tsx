
import React, { useState, useEffect, useCallback, useRef, useMemo, Suspense, lazy } from 'react';
import { marked } from 'marked';
import { ToastProvider, useToast } from './components/Toast';
import { Modal } from './components/Modal';
import { analyzeImage, sendChat, fetchMarketIndices, IndexData } from './services/geminiService';
import { ChatMessage, TabType, AnalysisState } from './types';

const TradingViewWidget = lazy(() => import('./components/TradingViewWidget').then(module => ({ default: module.TradingViewWidget })));

const INITIAL_CHIPS = ['AAPL', 'NVDA', 'TSLA', 'BTCUSD', 'ETHUSD'];

const MarketIndices: React.FC<{ data: IndexData[]; loading: boolean; onRefresh: () => void }> = React.memo(({ data, loading, onRefresh }) => (
  <div className="hidden lg:flex flex-grow justify-center items-center px-8 gap-4 overflow-hidden">
    {(data && data.length > 0) ? (
      data.map((idx, i) => (
        <div key={i} className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl border border-slate-100 bg-white shadow-sm hover:border-slate-300 transition-all cursor-default">
          <span className="text-[10px] font-black text-slate-400 whitespace-nowrap">{idx.name}</span>
          <span className={`text-[11px] font-mono font-bold ${idx.isUp ? 'text-emerald-500' : 'text-rose-500'}`}>
            {idx.percent}
          </span>
        </div>
      ))
    ) : (
      <div className="flex gap-4">
        {[1, 2, 3].map(i => <div key={i} className="w-20 h-7 bg-slate-100/60 rounded-xl animate-pulse" />)}
      </div>
    )}
    <button onClick={onRefresh} disabled={loading} className={`p-2 text-slate-300 hover:text-slate-900 transition-all ${loading ? 'animate-spin' : 'hover:rotate-180 duration-500'}`}>
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
    </button>
  </div>
));

const ChatItem: React.FC<{ msg: ChatMessage }> = React.memo(({ msg }) => {
  const content = useMemo(() => (
    msg.role === 'user' ? msg.text : <div className="markdown-body" dangerouslySetInnerHTML={{ __html: marked.parse(msg.text) as string }} />
  ), [msg.text, msg.role]);

  return (
    <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-slide-up mb-5`}>
      <div className={`max-w-[88%] px-4 py-3 rounded-2xl text-[13.5px] font-medium shadow-sm leading-relaxed ${msg.role === 'user' ? 'bg-slate-900 text-white rounded-tr-none' : 'bg-white border border-slate-100 text-slate-800 rounded-tl-none ring-1 ring-slate-50'}`}>
        {content}
      </div>
    </div>
  );
});

const AppContent: React.FC = () => {
  const { showToast } = useToast();
  
  const [symbol, setSymbol] = useState<string>('AAPL');
  const [tempSymbol, setTempSymbol] = useState<string>('AAPL');
  const [quickChips, setQuickChips] = useState<string[]>(INITIAL_CHIPS);
  const [activeTab, setActiveTab] = useState<TabType>('analysis');
  const [isDesktop, setIsDesktop] = useState(true);
  const [mobileTab, setMobileTab] = useState<'chart' | 'ai'>('chart');

  const [indices, setIndices] = useState<IndexData[]>([]);
  const [indicesLoading, setIndicesLoading] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [isKeyModalOpen, setIsKeyModalOpen] = useState(false);

  const checkKeyStatus = useCallback(async () => {
    if (window.aistudio) {
      const selected = await window.aistudio.hasSelectedApiKey();
      setHasKey(selected);
      if (!selected) setIsKeyModalOpen(true);
      return selected;
    } else {
      const exists = !!process.env.API_KEY && process.env.API_KEY !== '""';
      setHasKey(exists);
      if (!exists) setIsKeyModalOpen(true);
      return exists;
    }
  }, []);

  useEffect(() => {
    checkKeyStatus();
  }, [checkKeyStatus]);

  const refreshIndices = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    if (hasKey) {
      refreshIndices();
      const interval = setInterval(refreshIndices, 300000); 
      return () => clearInterval(interval);
    }
  }, [hasKey, refreshIndices]);

  const handleActivateKey = async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
      setIsKeyModalOpen(false);
      setHasKey(true);
      showToast("授權中，請稍候...");
      // 根據規範，觸發後假設成功並刷新數據
      setTimeout(refreshIndices, 1000);
    } else {
      showToast("系統環境不支援 API Key 選擇視窗，請確認環境變數已設定。", "error");
    }
  };

  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([{ role: 'model', text: "系統就緒。請上傳盤面截圖或輸入標的進行諮詢。" }]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  
  const [analysis, setAnalysis] = useState<AnalysisState>({ 
    isAnalyzing: false, 
    result: null, 
    summary: null, 
    error: null, 
    imageBase64: null 
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
      if (window.innerWidth < 1024) setMobileTab('ai');
      
      showToast('偵測到快照，啟動深度分析...');
      
      try {
        const { summary, analysis: markdownResult } = await analyzeImage(symbol, base64Data, file.type);
        const htmlResult = await marked.parse(markdownResult);
        setAnalysis(prev => ({ 
          ...prev, 
          isAnalyzing: false, 
          result: htmlResult as string,
          summary: summary
        }));
        showToast('分析完成');
      } catch (err: any) {
        if (err.message === "AUTH_REQUIRED") {
          setHasKey(false);
          setIsKeyModalOpen(true);
        }
        setAnalysis(prev => ({ ...prev, isAnalyzing: false, error: err.message }));
        showToast(err.message === "AUTH_REQUIRED" ? "請重新選取有效金鑰" : (err.message || '分析失敗'), 'error');
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
      showToast(err.message || "發送失敗", "error");
    } finally {
      setIsChatLoading(false);
    }
  }, [chatInput, chatHistory, isChatLoading, hasKey, symbol, analysis.summary, showToast]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) {
            handleImageUpload(file);
            e.preventDefault();
            return;
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste, true);
    return () => window.removeEventListener('paste', handlePaste, true);
  }, [handleImageUpload]);

  return (
    <div className="h-screen flex flex-col bg-slate-50 overflow-hidden font-sans text-slate-900 selection:bg-emerald-100 antialiased">
      <header className="h-14 bg-white border-b border-slate-200/60 px-5 flex items-center justify-between z-50 flex-shrink-0 safe-top backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 bg-slate-950 rounded-[10px] flex items-center justify-center text-white font-black text-xl shadow-lg shadow-slate-200">M</div>
          <div className="leading-tight">
            <h1 className="text-[12px] font-black tracking-tighter uppercase">MA Pro Terminal</h1>
            <p className="text-[9px] text-slate-400 font-bold uppercase tracking-[0.2em]">Quant Intelligence</p>
          </div>
        </div>

        <MarketIndices data={indices} loading={indicesLoading} onRefresh={refreshIndices} />

        <div className="flex items-center gap-3">
          <button onClick={() => setIsKeyModalOpen(true)} className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-100 hover:bg-slate-50 transition-all">
            <div className={`w-2 h-2 rounded-full ${hasKey ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse' : 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]'}`} />
            <span className="hidden md:inline text-[10px] font-black uppercase tracking-widest text-slate-400">
              {hasKey ? 'System Ready' : 'Key Required'}
            </span>
          </button>
        </div>
      </header>

      <main className="flex-grow flex flex-col lg:flex-row overflow-hidden relative">
        <div className={`flex flex-col relative transition-all duration-300 ${!isDesktop && mobileTab !== 'chart' ? 'hidden' : 'flex'} flex-grow h-full bg-white`}>
          <div className="h-11 border-b border-slate-100 px-4 flex items-center gap-3 overflow-x-auto no-scrollbar flex-shrink-0 bg-slate-50/30">
            <div className="flex items-center bg-white rounded-lg border border-slate-200 px-2 h-7.5">
              <input 
                type="text" value={tempSymbol} 
                onChange={e => setTempSymbol(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && setSymbol(tempSymbol)}
                className="w-20 px-1 py-1 text-[11px] font-black outline-none bg-transparent"
                placeholder="標的"
              />
              <button onClick={() => setSymbol(tempSymbol)} className="text-[10px] font-black text-slate-400 hover:text-slate-900 px-1">GO</button>
            </div>
            <div className="flex gap-2">
              {quickChips.map(chip => (
                <button key={chip} onClick={() => { setSymbol(chip); setTempSymbol(chip); }} className={`px-3 py-1 rounded-lg border text-[11px] font-bold transition-all active:scale-95 ${symbol === chip ? 'bg-slate-950 text-white border-slate-950 shadow-md' : 'bg-white text-slate-400 hover:border-slate-300'}`}>{chip}</button>
              ))}
            </div>
          </div>

          <div className="flex-grow relative overflow-hidden bg-slate-50">
            <Suspense fallback={<div className="h-full w-full flex flex-col items-center justify-center gap-4"><div className="w-8 h-8 border-4 border-slate-100 border-t-emerald-500 rounded-full animate-spin"></div><span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Linking Feed...</span></div>}>
              <TradingViewWidget symbol={symbol} />
            </Suspense>

            <div className="absolute bottom-8 right-8 flex flex-col items-end gap-3 z-40">
              <div className="px-4 py-2 bg-white/90 backdrop-blur-md rounded-xl border border-slate-200 shadow-xl text-[10px] font-black text-slate-500 animate-bounce hidden md:flex items-center gap-2">
                <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-ping"></span>
                <span>💡 截圖後在此按下 <span className="text-slate-900 underline decoration-emerald-400 decoration-2">Ctrl + V</span> 直接診斷</span>
              </div>
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="px-6 py-4 bg-slate-950 text-white rounded-2xl font-black text-xs shadow-2xl hover:bg-emerald-600 hover:scale-105 active:scale-95 transition-all flex items-center gap-3 group"
              >
                <svg className="w-4 h-4 group-hover:rotate-12 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path></svg>
                深度分析當前盤面
              </button>
            </div>
            <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={e => e.target.files?.[0] && handleImageUpload(e.target.files[0])} />
          </div>
        </div>

        <div className={`flex-col bg-[#F9FBFC] transition-all duration-300 border-l border-slate-200/50 ${!isDesktop && mobileTab !== 'ai' ? 'hidden' : 'flex'} flex-grow lg:flex-none h-full overflow-hidden`} style={{ width: isDesktop ? '38%' : '100%' }}>
          <div className="p-6 flex flex-col h-full">
             <div className="flex p-1.5 bg-slate-100 rounded-[14px] mb-6 shadow-inner">
                <button onClick={() => setActiveTab('analysis')} className={`flex-1 py-2.5 text-[11px] font-black uppercase rounded-[10px] transition-all ${activeTab === 'analysis' ? 'bg-white shadow-md text-slate-950' : 'text-slate-400'}`}>分析報告</button>
                <button onClick={() => setActiveTab('chat')} className={`flex-1 py-2.5 text-[11px] font-black uppercase rounded-[10px] transition-all ${activeTab === 'chat' ? 'bg-white shadow-md text-slate-950' : 'text-slate-400'}`}>策略諮詢</button>
             </div>
             
             <div className="flex-grow overflow-y-auto custom-scrollbar pr-1">
                {activeTab === 'analysis' ? (
                  <div className="space-y-6">
                    {analysis.isAnalyzing ? (
                      <div className="py-24 text-center">
                        <div className="w-12 h-12 border-4 border-slate-100 border-t-slate-900 rounded-full animate-spin mx-auto mb-6"></div>
                        <span className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-400 animate-pulse">Scanning Visual Data...</span>
                      </div>
                    ) : (
                      <>
                        {analysis.summary && (
                          <div className="bg-slate-900 text-white p-5 rounded-2xl text-[13.5px] font-bold shadow-xl border border-slate-800 animate-fade-in">
                            <div className="flex items-center gap-2 mb-2">
                              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                              <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">AI Verdict</span>
                            </div>
                            <div dangerouslySetInnerHTML={{ __html: analysis.summary }} />
                          </div>
                        )}
                        {analysis.result && (
                          <div className="prose prose-sm bg-white p-6 rounded-2xl border border-slate-100 shadow-[0_4px_15px_-3px_rgba(0,0,0,0.04)] animate-fade-in terminal-report" dangerouslySetInnerHTML={{ __html: analysis.result }} />
                        )}
                        {!analysis.result && !analysis.isAnalyzing && (
                          <div className="py-40 flex flex-col items-center opacity-20 grayscale transition-all hover:opacity-40">
                            <svg className="w-16 h-16 text-slate-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                            <p className="text-center text-slate-400 font-black uppercase text-[10px] tracking-[0.5em]">Terminal Idle</p>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4 pb-24">
                    {chatHistory.map((msg, i) => <ChatItem key={i} msg={msg} />)}
                    {isChatLoading && (
                      <div className="flex gap-1.5 items-center px-4 py-3 bg-white border border-slate-100 rounded-2xl w-fit shadow-sm">
                        <div className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                        <div className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                        <div className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce"></div>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>
                )}
             </div>

             {activeTab === 'chat' && (
               <div className="mt-4 flex gap-2 p-2 bg-white rounded-2xl border border-slate-200 focus-within:border-slate-900 focus-within:shadow-lg transition-all">
                  <input 
                    type="text" value={chatInput} 
                    onChange={e => setChatInput(e.target.value)} 
                    onKeyDown={e => e.key === 'Enter' && handleChatSubmit()} 
                    className="flex-grow px-4 py-2 text-sm outline-none bg-transparent" 
                    placeholder="輸入交易策略相關問題..." 
                  />
                  <button 
                    onClick={handleChatSubmit} 
                    disabled={!chatInput.trim() || isChatLoading}
                    className="w-11 h-11 bg-slate-950 text-white rounded-xl flex items-center justify-center hover:bg-emerald-600 disabled:opacity-20 active:scale-90 transition-all shadow-md"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
                  </button>
               </div>
             )}
          </div>
        </div>
      </main>

      <Modal isOpen={isKeyModalOpen} onClose={() => setIsKeyModalOpen(false)} title="授權 AI 核心">
        <div className="text-center space-y-6 py-2">
          <div className="w-16 h-16 bg-slate-950 rounded-2xl flex items-center justify-center mx-auto text-emerald-400 shadow-xl animate-pulse ring-4 ring-emerald-500/10">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
          </div>
          <div className="space-y-2">
             <h4 className="text-[15px] font-black text-slate-900 uppercase">啟動專業版引擎</h4>
             <p className="text-[11.5px] text-slate-500 font-bold leading-relaxed px-2">偵測到服務尚未連結或金鑰已過期。請點擊下方按鈕選取您的 API Key 以啟動分析功能。</p>
          </div>
          <button 
            onClick={handleActivateKey} 
            className="w-full py-4.5 bg-slate-950 text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl hover:bg-emerald-600 transition-all active:scale-95"
          >
            立即激活授權
          </button>
          <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" className="block text-[9px] font-black text-slate-300 hover:text-emerald-500 uppercase tracking-widest transition-colors">查看計費與安全說明</a>
        </div>
      </Modal>

      <style>{`
        @keyframes slide-up { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .animate-slide-up { animation: slide-up 0.3s ease-out forwards; }
        .terminal-report h2 { font-size: 1rem; color: #0f172a; margin-top: 1.5rem; border-left: 4px solid #10b981; padding-left: 0.75rem; font-weight: 900; text-transform: uppercase; letter-spacing: 0.05em; }
        .terminal-report p { margin-bottom: 0.75rem; line-height: 1.75; color: #475569; }
        .terminal-report strong { color: #0f172a; font-weight: 800; background: #f8fafc; padding: 0 4px; border-radius: 4px; }
        .markdown-body ul { list-style: disc; padding-left: 1.5rem; margin-bottom: 1rem; }
        .markdown-body li { margin-bottom: 0.4rem; color: #475569; }
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
