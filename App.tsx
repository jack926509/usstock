
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
    {data.length > 0 ? (
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
        {[1, 2, 3].map(i => <div key={i} className="w-20 h-7 bg-slate-100 rounded-xl animate-pulse" />)}
      </div>
    )}
    <button onClick={onRefresh} disabled={loading} className={`p-2 text-slate-300 hover:text-slate-900 transition-all ${loading ? 'animate-spin' : ''}`}>
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
    </button>
  </div>
));

const ChatItem: React.FC<{ msg: ChatMessage }> = React.memo(({ msg }) => {
  const content = useMemo(() => (
    msg.role === 'user' ? msg.text : <div dangerouslySetInnerHTML={{ __html: marked.parse(msg.text) as string }} />
  ), [msg.text, msg.role]);

  return (
    <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} mb-5 animate-slide-up`}>
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
  const [isKeyModalOpen, setIsKeyModalOpen] = useState(false);
  const [hasKey, setHasKey] = useState(true);
  
  const [indices, setIndices] = useState<IndexData[]>([]);
  const [indicesLoading, setIndicesLoading] = useState(false);

  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio) {
        const selected = await window.aistudio.hasSelectedApiKey();
        setHasKey(selected);
        if (!selected) setIsKeyModalOpen(true);
      }
    };
    checkKey();
  }, []);

  const handleActivateKey = async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
      setIsKeyModalOpen(false);
      window.location.reload();
    }
  };

  useEffect(() => {
    const checkSize = () => setIsDesktop(window.innerWidth >= 1024);
    checkSize();
    window.addEventListener('resize', checkSize);
    return () => window.removeEventListener('resize', checkSize);
  }, []);

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
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, activeTab]);

  const handleImageUpload = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64String = reader.result as string;
      const base64Data = base64String.split(',')[1];
      
      // 設置載入狀態並切換視圖
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
        setAnalysis(prev => ({ ...prev, isAnalyzing: false, error: err.message }));
        showToast(err.message || '分析失敗', 'error');
      }
    };
    reader.readAsDataURL(file);
  }, [symbol, showToast]);

  // 核心：全域貼上監聽器
  useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) {
            handleImageUpload(file);
            return;
          }
        }
      }
    };

    document.addEventListener('paste', handleGlobalPaste);
    return () => document.removeEventListener('paste', handleGlobalPaste);
  }, [handleImageUpload]);

  const handleChatSubmit = async () => {
    if (!chatInput.trim() || isChatLoading) return;
    const userMsg: ChatMessage = { role: 'user', text: chatInput };
    setChatHistory(prev => [...prev, userMsg]);
    setChatInput('');
    setIsChatLoading(true);
    try {
      const responseText = await sendChat([...chatHistory, userMsg], symbol, analysis.result || "");
      setChatHistory(prev => [...prev, { role: 'model', text: responseText }]);
    } catch (err: any) {
      showToast('回應延遲', 'error');
    } finally { setIsChatLoading(false); }
  };

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
        <MarketIndices data={indices} loading={indicesLoading} onRefresh={() => {}} />
        <div className="flex items-center gap-2 px-2 py-1">
          <div className={`w-2 h-2 rounded-full ${hasKey ? 'bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]'}`} />
          <span className="hidden md:inline text-[10px] font-black uppercase tracking-widest text-slate-400">
            {hasKey ? 'System Ready' : 'Key Missing'}
          </span>
        </div>
      </header>

      <main className="flex-grow flex flex-col lg:flex-row overflow-hidden relative">
        <div className={`flex flex-col relative ${!isDesktop && mobileTab !== 'chart' ? 'hidden' : 'flex'} flex-grow h-full bg-white`}>
          <div className="h-11 border-b border-slate-100 px-4 flex items-center gap-3 bg-slate-50/30 overflow-x-auto no-scrollbar">
            <div className="flex items-center bg-white rounded-lg border border-slate-200 px-2 h-7.5">
              <input 
                type="text" value={tempSymbol} 
                onChange={e => setTempSymbol(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && setSymbol(tempSymbol)}
                className="w-20 px-1 py-1 text-[11px] font-black outline-none"
                placeholder="標的"
              />
              <button onClick={() => setSymbol(tempSymbol)} className="text-[10px] font-black text-slate-400 hover:text-slate-900">GO</button>
            </div>
            <div className="flex gap-2">
              {quickChips.map(chip => (
                <button key={chip} onClick={() => { setSymbol(chip); setTempSymbol(chip); }} className={`px-3 py-1 rounded-lg border text-[11px] font-bold transition-all ${symbol === chip ? 'bg-slate-950 text-white border-slate-950 shadow-md' : 'bg-white text-slate-400 hover:border-slate-300'}`}>{chip}</button>
              ))}
            </div>
          </div>
          <div className="flex-grow relative bg-slate-50">
            <Suspense fallback={<div className="h-full w-full flex items-center justify-center flex-col gap-3">
              <div className="w-8 h-8 border-4 border-slate-100 border-t-emerald-500 rounded-full animate-spin"></div>
              <span className="text-[10px] font-black text-slate-400 uppercase">Loading Feed...</span>
            </div>}>
              <TradingViewWidget symbol={symbol} />
            </Suspense>
            
            <div className="absolute bottom-8 right-8 flex flex-col items-end gap-3 z-40">
              <div className="px-4 py-2 bg-white/80 backdrop-blur-md rounded-xl border border-slate-200 shadow-xl text-[10px] font-bold text-slate-500 animate-bounce hidden md:block">
                💡 截圖後在此按下 <span className="text-slate-900">Ctrl + V</span> 直接分析
              </div>
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="px-6 py-4 bg-slate-950 text-white rounded-2xl font-black text-xs shadow-2xl hover:bg-emerald-600 active:scale-95 transition-all flex items-center gap-2 group"
              >
                <svg className="w-4 h-4 group-hover:rotate-12 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path></svg>
                深度分析當前盤面
              </button>
            </div>
            <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={e => e.target.files?.[0] && handleImageUpload(e.target.files[0])} />
          </div>
        </div>

        <div className={`flex flex-col bg-[#F9FBFC] transition-all duration-300 border-l border-slate-200/50 ${!isDesktop && mobileTab !== 'ai' ? 'hidden' : 'flex'}`} style={{ width: isDesktop ? '38%' : '100%' }}>
          <div className="p-6 flex flex-col h-full overflow-hidden">
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
                        <span className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-400 animate-pulse">Scanning Chart Data...</span>
                      </div>
                    ) : (
                      <>
                        {analysis.summary && (
                          <div className="bg-slate-900 text-white p-5 rounded-2xl text-sm font-bold shadow-xl border border-slate-800 animate-fade-in">
                            <div className="flex items-center gap-2 mb-2">
                              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                              <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">Core Verdict</span>
                            </div>
                            <div dangerouslySetInnerHTML={{ __html: analysis.summary }} />
                          </div>
                        )}
                        {analysis.result && (
                          <div className="prose prose-sm bg-white p-6 rounded-2xl border border-slate-100 shadow-sm animate-fade-in terminal-report" dangerouslySetInnerHTML={{ __html: analysis.result }} />
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
                  <div className="space-y-4 pb-20">
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
               <div className="absolute bottom-6 left-6 right-6 lg:relative lg:bottom-0 lg:left-0 lg:right-0 mt-4 flex gap-2 p-2 bg-white rounded-2xl border border-slate-200 focus-within:border-slate-900 focus-within:shadow-lg transition-all">
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
                    className="w-10 h-10 bg-slate-950 text-white rounded-xl flex items-center justify-center hover:bg-emerald-600 disabled:opacity-20 active:scale-90 transition-all shadow-md"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
                  </button>
               </div>
             )}
          </div>
        </div>

        {!isDesktop && (
          <div className="h-18 bg-white border-t border-slate-200 flex items-center justify-around z-[60] pb-[env(safe-area-inset-bottom)] shadow-[0_-10px_30px_rgba(0,0,0,0.05)] px-6">
            <button onClick={() => setMobileTab('chart')} className={`flex flex-col items-center gap-1 transition-all ${mobileTab === 'chart' ? 'text-slate-950 scale-110' : 'text-slate-300'}`}>
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z"></path></svg>
              <span className="text-[10px] font-black uppercase tracking-widest">Chart</span>
            </button>
            <button onClick={() => setMobileTab('ai')} className={`flex flex-col items-center gap-1 transition-all ${mobileTab === 'ai' ? 'text-slate-950 scale-110' : 'text-slate-300'}`}>
              <div className="relative">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                {analysis.result && <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-rose-500 rounded-full animate-pulse ring-2 ring-white"></div>}
              </div>
              <span className="text-[10px] font-black uppercase tracking-widest">Analysis</span>
            </button>
          </div>
        )}
      </main>

      <Modal isOpen={isKeyModalOpen} onClose={() => {}} title="授權 AI 核心">
        <div className="text-center space-y-6">
          <div className="w-16 h-16 bg-slate-950 rounded-2xl flex items-center justify-center mx-auto text-emerald-400 shadow-xl animate-pulse">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
          </div>
          <p className="text-[12px] text-slate-500 font-bold leading-relaxed px-4">偵測到服務尚未連結。請點擊按鈕選取您的 API Key 以啟動專業版分析功能。</p>
          <button onClick={handleActivateKey} className="w-full py-4 bg-slate-950 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl hover:bg-emerald-600 transition-all active:scale-95">立即激活</button>
          <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" className="block text-[9px] font-black text-slate-300 hover:text-emerald-500 uppercase tracking-widest">查看計費說明</a>
        </div>
      </Modal>

      <style>{`
        @keyframes slide-up { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .animate-slide-up { animation: slide-up 0.3s ease-out forwards; }
        .terminal-report h2 { font-size: 1rem; color: #0f172a; margin-top: 1.5rem; border-left: 4px solid #10b981; padding-left: 0.75rem; font-weight: 900; text-transform: uppercase; }
        .terminal-report p { margin-bottom: 0.75rem; line-height: 1.7; color: #475569; }
        .terminal-report strong { color: #0f172a; font-weight: 800; background: #f8fafc; padding: 0 4px; border-radius: 4px; }
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
