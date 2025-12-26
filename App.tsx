
import React, { useState, useEffect, useCallback, useRef, useMemo, Suspense, lazy } from 'react';
import { marked } from 'marked';
import { ToastProvider, useToast } from './components/Toast';
import { Modal } from './components/Modal';
import { analyzeImage, sendChat, fetchMarketIndices, IndexData } from './services/geminiService';
import { ChatMessage, TabType, AnalysisState } from './types';

const TradingViewWidget = lazy(() => import('./components/TradingViewWidget').then(module => ({ default: module.TradingViewWidget })));

const INITIAL_CHIPS = ['AAPL', 'NVDA', 'TSLA', 'BTCUSD', 'ETHUSD'];

const MarketIndices: React.FC<{ data: IndexData[]; loading: boolean; onRefresh: () => void }> = React.memo(({ data, loading, onRefresh }) => (
  <div className="hidden sm:flex flex-grow justify-center items-center px-4 gap-3 overflow-hidden">
    {data.length > 0 ? (
      data.map((idx, i) => (
        <div key={i} className="flex items-center gap-2 px-2.5 py-1 rounded-lg border bg-white shadow-sm hover:border-slate-300 transition-all cursor-default">
          <span className="text-[10px] font-black text-slate-400 whitespace-nowrap">{idx.name}</span>
          <span className={`text-[10px] font-mono font-black ${idx.isUp ? 'text-emerald-600' : 'text-rose-600'}`}>
            {idx.percent}
          </span>
        </div>
      ))
    ) : (
      <div className="flex gap-3">
        {[1, 2, 3].map(i => <div key={i} className="w-16 h-6 bg-slate-100/50 rounded-lg animate-pulse" />)}
      </div>
    )}
    <button onClick={onRefresh} disabled={loading} className={`p-1.5 text-slate-400 hover:text-slate-900 transition-colors ${loading ? 'animate-spin' : ''}`}>
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
    </button>
  </div>
));

const ChatItem: React.FC<{ msg: ChatMessage }> = React.memo(({ msg }) => {
  const content = useMemo(() => (
    msg.role === 'user' ? msg.text : <div dangerouslySetInnerHTML={{ __html: marked.parse(msg.text) as string }} />
  ), [msg.text, msg.role]);

  return (
    <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-slide-up mb-4`}>
      <div className={`max-w-[92%] px-4 py-2.5 rounded-2xl text-[13px] font-bold shadow-sm ${msg.role === 'user' ? 'bg-slate-950 text-white rounded-tr-none' : 'bg-white border border-slate-100 text-slate-800 rounded-tl-none prose prose-sm'}`}>
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
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isInstallModalOpen, setIsInstallModalOpen] = useState(false);
  const [newChipValue, setNewChipValue] = useState('');
  const [activeTab, setActiveTab] = useState<TabType>('analysis');
  const [isPasteOverlayOpen, setIsPasteOverlayOpen] = useState(false);
  
  const [sidebarWidth, setSidebarWidth] = useState<number>(35);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isDesktop, setIsDesktop] = useState(true);
  const [mobileTab, setMobileTab] = useState<'chart' | 'ai'>('chart');

  const [indices, setIndices] = useState<IndexData[]>([]);
  const [indicesLoading, setIndicesLoading] = useState(false);

  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setIsIOS(isIOSDevice);

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    });
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
        showToast("安裝成功！");
      }
    } else {
      setIsInstallModalOpen(true);
    }
  };

  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([{ role: 'model', text: "終端已就緒。請上傳 K 線圖或輸入問題。" }]);
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
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const checkSize = () => {
      const desktop = window.innerWidth >= 1024;
      setIsDesktop(desktop);
      if (!desktop) {
        setSidebarWidth(100);
      } else {
        setSidebarWidth(35);
      }
    };
    checkSize();
    window.addEventListener('resize', checkSize);
    return () => window.removeEventListener('resize', checkSize);
  }, []);

  const refreshIndices = useCallback(async () => {
    setIndicesLoading(true);
    try {
      const data = await fetchMarketIndices();
      if (data && data.length > 0) setIndices(data);
    } catch (e) { console.error(e); }
    finally { setIndicesLoading(false); }
  }, []);

  useEffect(() => {
    refreshIndices();
    const interval = setInterval(refreshIndices, 300000); 
    return () => clearInterval(interval);
  }, [refreshIndices]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, activeTab, mobileTab]);

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) handleImageUpload(file);
          return;
        }
      }
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [symbol]);

  const handleSymbolSubmit = () => {
    const val = tempSymbol.trim();
    if (val && val !== symbol) {
      setSymbol(val);
      setAnalysis({ isAnalyzing: false, result: null, summary: null, error: null, imageBase64: null });
      showToast(`標的變更: ${val}`);
    }
  };

  const handleImageUpload = (file: File) => {
    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64String = reader.result as string;
      const base64Data = base64String.split(',')[1];
      setAnalysis({ isAnalyzing: true, result: null, summary: null, error: null, imageBase64: base64String });
      setActiveTab('analysis');
      if (!isDesktop) setMobileTab('ai');
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
  };

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
      showToast(err.message || '回覆失敗', 'error');
    } finally { setIsChatLoading(false); }
  };

  const addChip = () => {
    const val = newChipValue.trim().toUpperCase();
    if (val && !quickChips.includes(val)) {
      setQuickChips([...quickChips, val]);
      setNewChipValue('');
      setIsAddModalOpen(false);
    }
  };

  const removeChip = (chip: string) => setQuickChips(quickChips.filter(c => c !== chip));

  const clearAnalysis = useCallback(() => {
    setAnalysis({ isAnalyzing: false, result: null, summary: null, error: null, imageBase64: null });
    showToast('已重置分析');
  }, [showToast]);

  return (
    <div className="h-screen flex flex-col bg-slate-50 overflow-hidden font-sans text-slate-900 selection:bg-emerald-100">
      
      {/* Header */}
      <header className="h-14 bg-white border-b border-slate-200 px-4 flex items-center justify-between z-50 flex-shrink-0 safe-top">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-slate-950 rounded-lg flex items-center justify-center text-white font-black text-lg shadow-sm">M</div>
          <div className="block">
            <h1 className="text-[11px] font-black tracking-tighter leading-none">MA PRO</h1>
            <p className="text-[8px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">Intelligence</p>
          </div>
        </div>

        <MarketIndices data={indices} loading={indicesLoading} onRefresh={refreshIndices} />

        <div className="flex items-center gap-3 ml-auto sm:ml-0">
          <button 
            onClick={handleInstallClick}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 rounded-full hover:bg-slate-200 transition-colors group"
            title="安裝至手機或電腦"
          >
            <svg className="w-3.5 h-3.5 text-slate-900 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
            </svg>
            <span className="hidden xs:block text-[9px] font-black uppercase tracking-wider text-slate-900">App</span>
          </button>

          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="hidden sm:inline text-[9px] font-black uppercase tracking-widest text-slate-400">
              System Ready
            </span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main ref={containerRef} className="flex-grow flex flex-col lg:flex-row overflow-hidden relative">
        
        {/* Chart View */}
        <div className={`flex flex-col relative transition-all duration-300 ${!isDesktop && mobileTab !== 'chart' ? 'hidden' : 'flex'} flex-grow h-full bg-white`}>
          <div className="h-10 border-b border-slate-100 px-3 flex items-center gap-2 overflow-x-auto no-scrollbar flex-shrink-0">
            <div className="flex items-center bg-slate-100 rounded-md border border-slate-200 focus-within:border-slate-400 transition-all h-7 flex-shrink-0">
              <input 
                type="text" value={tempSymbol}
                onChange={(e) => setTempSymbol(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && handleSymbolSubmit()}
                className="w-14 sm:w-16 px-2 text-[10px] font-black outline-none bg-transparent" placeholder="代碼"
              />
              <button onClick={handleSymbolSubmit} className="px-2 text-[9px] font-black border-l border-slate-200 hover:text-emerald-600">GO</button>
            </div>
            <div className="w-px h-3 bg-slate-200 mx-0.5 flex-shrink-0" />
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar py-1">
              {quickChips.map(chip => (
                <div key={chip} onClick={() => { setSymbol(chip); setTempSymbol(chip); }} className={`flex items-center gap-1 px-2.5 py-0.5 rounded border text-[10px] font-black cursor-pointer whitespace-nowrap transition-all active:scale-95 ${symbol === chip ? 'bg-slate-950 text-white border-slate-950 shadow-sm' : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300'}`}>
                  {chip}
                  <span onClick={(e) => { e.stopPropagation(); removeChip(chip); }} className="ml-0.5 text-[12px] opacity-40 hover:opacity-100">×</span>
                </div>
              ))}
            </div>
            <button onClick={() => setIsAddModalOpen(true)} className="w-6 h-6 rounded border border-dashed border-slate-300 text-slate-400 hover:text-slate-950 hover:border-slate-950 flex items-center justify-center flex-shrink-0 transition-colors">+</button>
          </div>

          <div className="flex-grow relative overflow-hidden bg-[#F8FAFC]">
            <Suspense fallback={<div className="h-full w-full flex flex-col items-center justify-center gap-3"><div className="w-6 h-6 border-2 border-slate-200 border-t-emerald-500 rounded-full animate-spin"></div><span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">載入即時行情...</span></div>}>
              <TradingViewWidget symbol={symbol} />
            </Suspense>

            <button 
              onClick={() => setIsPasteOverlayOpen(true)}
              className="absolute bottom-6 right-6 lg:right-12 px-4 py-3 sm:px-5 sm:py-3 bg-emerald-600 text-white rounded-2xl font-black text-[11px] sm:text-xs shadow-xl shadow-emerald-600/30 hover:bg-emerald-700 hover:scale-105 active:scale-90 transition-all flex items-center gap-2 z-[40]"
            >
              <div className="w-4 h-4 bg-white/20 rounded flex items-center justify-center">
                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
              </div>
              <span className="hidden xs:inline">深度分析盤面</span>
              <span className="xs:hidden">分析</span>
            </button>
          </div>
        </div>

        {/* Desktop Sidebar Splitter */}
        {isDesktop && !isSidebarCollapsed && (
          <div className="w-1 bg-slate-100 hover:bg-emerald-400 cursor-col-resize z-30 transition-colors" onMouseDown={() => setIsDragging(true)} />
        )}

        {/* Intelligence Sidebar */}
        <div 
          className={`flex-col bg-[#F9FBFC] relative h-full transition-all duration-300 ${isSidebarCollapsed && isDesktop ? 'w-0' : ''} ${!isDesktop && mobileTab !== 'ai' ? 'hidden' : 'flex'}`}
          style={{ width: isDesktop && !isSidebarCollapsed ? `${sidebarWidth}%` : (isDesktop ? '0' : '100%') }}
        >
          {isDesktop && (
             <button 
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)} 
              className={`absolute -left-3 top-20 w-6 h-12 bg-white border border-slate-200 rounded-full flex items-center justify-center shadow-sm z-[60] hover:text-emerald-600 transition-all ${isSidebarCollapsed ? 'translate-x-3' : ''}`}
             >
                <span className="text-xs font-bold">{isSidebarCollapsed ? '‹' : '›'}</span>
             </button>
          )}

          {!isSidebarCollapsed && (
            <div className="flex flex-col h-full overflow-hidden">
              <div className="px-5 pt-4 pb-2 bg-white/80 backdrop-blur-md border-b border-slate-100 flex-shrink-0">
                <div className="flex p-1 bg-slate-200/50 rounded-xl mb-1">
                    <button onClick={() => setActiveTab('analysis')} className={`flex-1 py-2 text-[10px] font-black uppercase rounded-lg transition-all ${activeTab === 'analysis' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-400'}`}>分析報告</button>
                    <button onClick={() => setActiveTab('chat')} className={`flex-1 py-2 text-[10px] font-black uppercase rounded-lg transition-all ${activeTab === 'chat' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-400'}`}>策略諮詢</button>
                </div>
              </div>

              <div className="flex-grow overflow-hidden relative">
                <div className={`absolute inset-0 flex flex-col p-4 sm:p-5 overflow-y-auto custom-scrollbar transition-all duration-300 ${activeTab === 'analysis' ? 'opacity-100 translate-y-0' : 'opacity-0 pointer-events-none translate-y-4'}`}>
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className="h-20 sm:h-24 rounded-2xl border-2 border-dashed border-slate-200 bg-white hover:border-emerald-500 hover:bg-emerald-50/10 transition-all flex flex-col items-center justify-center cursor-pointer mb-5 shadow-sm active:scale-98"
                  >
                    <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={(e) => e.target.files?.[0] && handleImageUpload(e.target.files[0])} />
                    <svg className="w-5 h-5 text-slate-300 mb-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest text-center px-4">上傳或拖放盤面截圖</span>
                  </div>

                  {analysis.isAnalyzing ? (
                    <div className="flex flex-col items-center py-16 animate-pulse">
                      <div className="w-10 h-10 border-4 border-slate-100 border-t-emerald-600 rounded-full animate-spin mb-4" />
                      <span className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em]">正在深度解碼盤面訊息...</span>
                    </div>
                  ) : analysis.error ? (
                    <div className="p-4 bg-rose-50 border border-rose-100 text-rose-600 text-[11px] font-bold rounded-2xl animate-shake">{analysis.error}</div>
                  ) : (
                    <div className="pb-16 space-y-4">
                      {analysis.summary && (
                        <div className="bg-emerald-50/80 border border-emerald-100 rounded-2xl p-4 shadow-sm animate-fade-in ring-1 ring-emerald-600/5">
                          <div className="flex items-center gap-2 mb-2">
                            <div className="w-5 h-5 bg-emerald-600 rounded-lg flex items-center justify-center text-white shadow-sm">
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                            </div>
                            <span className="text-[10px] font-black text-emerald-800 uppercase tracking-widest">核心交易總結</span>
                          </div>
                          <p className="text-[13px] font-bold text-slate-800 leading-relaxed" dangerouslySetInnerHTML={{ __html: analysis.summary }} />
                        </div>
                      )}
                      
                      {analysis.result ? (
                        <div className="prose prose-sm animate-fade-in bg-white p-4 rounded-2xl border border-slate-100" dangerouslySetInnerHTML={{ __html: analysis.result }} />
                      ) : (
                        <div className="flex flex-col items-center justify-center py-20 opacity-30 grayscale">
                          <svg className="w-12 h-12 text-slate-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
                          <p className="text-center text-slate-400 font-bold uppercase text-[10px] tracking-[0.3em]">Intelligence Engine Waiting</p>
                        </div>
                      )}
                      
                      {(analysis.result || analysis.summary) && (
                        <button onClick={clearAnalysis} className="w-full py-3 text-[10px] font-black text-slate-300 hover:text-rose-500 uppercase tracking-widest transition-colors text-center border-t border-slate-100 mt-8">重置目前分析內容</button>
                      )}
                    </div>
                  )}
                </div>

                <div className={`absolute inset-0 flex flex-col transition-all duration-300 ${activeTab === 'chat' ? 'opacity-100 translate-y-0' : 'opacity-0 pointer-events-none translate-y-4'}`}>
                  <div className="flex-grow p-4 sm:p-5 space-y-2 overflow-y-auto custom-scrollbar">
                    {chatHistory.map((msg, i) => <ChatItem key={i} msg={msg} />)}
                    {isChatLoading && (
                      <div className="flex gap-1.5 px-3 py-2 bg-white border border-slate-100 rounded-2xl w-fit animate-pulse">
                        <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce"></div>
                        <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce [animation-delay:0.2s]"></div>
                        <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce [animation-delay:0.4s]"></div>
                      </div>
                    )}
                    <div ref={chatEndRef} className="h-4" />
                  </div>
                  <div className="p-4 bg-white border-t border-slate-100 pb-[calc(1rem+env(safe-area-inset-bottom))]">
                    <div className="flex gap-2 items-center bg-slate-50 p-1.5 rounded-2xl border border-slate-200 focus-within:border-slate-900 focus-within:bg-white transition-all shadow-inner-light">
                      <input 
                        type="text" value={chatInput} onChange={e => setChatInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleChatSubmit()}
                        placeholder="輸入標的、策略或風險諮詢..." className="flex-grow bg-transparent text-[13px] font-bold px-3 py-1 outline-none"
                      />
                      <button onClick={handleChatSubmit} disabled={isChatLoading || !chatInput.trim()} className="w-9 h-9 bg-slate-950 text-white rounded-xl flex items-center justify-center disabled:opacity-10 active:scale-90 transition-transform shadow-md"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg></button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Mobile Navigation */}
        {!isDesktop && (
          <div className="h-16 bg-white border-t border-slate-200 flex items-center justify-around flex-shrink-0 z-[60] pb-[env(safe-area-inset-bottom)] shadow-up px-6">
            <button onClick={() => setMobileTab('chart')} className={`flex flex-col items-center gap-1.5 transition-all duration-300 relative ${mobileTab === 'chart' ? 'text-slate-950 scale-105' : 'text-slate-300'}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z"></path></svg>
              <span className="text-[9px] font-black uppercase tracking-widest">即時圖表</span>
              {mobileTab === 'chart' && <div className="absolute -bottom-2 w-1 h-1 bg-slate-950 rounded-full"></div>}
            </button>
            <button onClick={() => setMobileTab('ai')} className={`flex flex-col items-center gap-1.5 transition-all duration-300 relative ${mobileTab === 'ai' ? 'text-emerald-600 scale-105' : 'text-slate-300'}`}>
              <div className="relative">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                {analysis.result && <div className="absolute -top-1 -right-1 w-2 h-2 bg-rose-500 rounded-full ring-2 ring-white"></div>}
              </div>
              <span className="text-[9px] font-black uppercase tracking-widest">智能助手</span>
              {mobileTab === 'ai' && <div className="absolute -bottom-2 w-1 h-1 bg-emerald-600 rounded-full"></div>}
            </button>
          </div>
        )}

        {/* Overlay Modals */}
        {isPasteOverlayOpen && (
          <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-lg z-[100] flex items-center justify-center animate-fade-in p-6" onClick={() => setIsPasteOverlayOpen(false)}>
            <div className="bg-white p-8 sm:p-10 rounded-[2.5rem] shadow-2xl text-center max-w-xs w-full border border-white/20 animate-slide-up" onClick={e => e.stopPropagation()}>
              <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-sm">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
              </div>
              <h3 className="text-xl font-black text-slate-950 mb-3 uppercase tracking-tight">導入盤面快照</h3>
              <p className="text-slate-500 text-[11px] font-bold leading-relaxed mb-8 px-2">
                請在您的交易介面截圖，然後
                <span className="block mt-1 text-slate-950 bg-slate-100 py-1 rounded-lg">在此處長按貼上或點擊選擇</span>
              </p>
              <div className="flex flex-col gap-3">
                <button onClick={() => fileInputRef.current?.click()} className="w-full py-3.5 bg-slate-950 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg active:scale-95 transition-transform">選擇相簿照片</button>
                <button onClick={() => setIsPasteOverlayOpen(false)} className="w-full py-3 text-[10px] font-black text-slate-300 uppercase tracking-[0.2em] hover:text-slate-900 transition-colors">暫不分析</button>
              </div>
            </div>
          </div>
        )}
      </main>

      <Modal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} title="新增監控標的">
        <div className="relative group">
          <input 
            type="text" value={newChipValue} onChange={e => setNewChipValue(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addChip()}
            className="w-full p-4 border-2 border-slate-100 rounded-2xl focus:border-slate-950 text-center text-4xl font-black mb-6 uppercase transition-all" placeholder="AAPL" autoFocus
          />
        </div>
        <button onClick={addChip} className="w-full py-4 bg-slate-950 text-white rounded-2xl font-black text-sm shadow-xl mb-4 active:scale-95 transition-transform">立即關注</button>
        <button onClick={() => setIsAddModalOpen(false)} className="w-full text-[10px] font-black text-slate-300 uppercase tracking-widest hover:text-slate-950">取消</button>
      </Modal>

      {/* PWA Install Guide Modal */}
      <Modal isOpen={isInstallModalOpen} onClose={() => setIsInstallModalOpen(false)} title="下載分析終端 App">
        <div className="space-y-6">
          <div className="flex justify-center">
            <div className="w-16 h-16 bg-emerald-500 rounded-2xl flex items-center justify-center text-white shadow-lg">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
            </div>
          </div>
          
          <div className="text-center space-y-2">
            <p className="text-sm font-bold text-slate-800">將 MA Pro 加入主畫面</p>
            <p className="text-[11px] text-slate-400 font-medium px-4">像原生 App 一樣使用，享受全屏體驗與更快的啟動速度。</p>
          </div>

          <div className="bg-slate-50 p-4 rounded-2xl space-y-4">
            {isIOS ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3 text-xs font-bold text-slate-700">
                  <span className="w-5 h-5 bg-white rounded-full flex items-center justify-center shadow-sm">1</span>
                  點擊瀏覽器下方的 分享按鈕
                </div>
                <div className="flex items-center gap-3 text-xs font-bold text-slate-700">
                  <span className="w-5 h-5 bg-white rounded-full flex items-center justify-center shadow-sm">2</span>
                  向下滑動並選擇 <span className="px-2 py-0.5 bg-white border rounded shadow-xs text-[10px]">加入主畫面</span>
                </div>
              </div>
            ) : (
              <div className="text-center">
                <p className="text-xs font-bold text-slate-700 mb-3">您的瀏覽器支持一鍵安裝</p>
                <button 
                  onClick={handleInstallClick}
                  className="w-full py-3 bg-emerald-600 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-md hover:bg-emerald-700"
                >
                  立即下載安裝
                </button>
              </div>
            )}
          </div>

          <button onClick={() => setIsInstallModalOpen(false)} className="w-full text-[10px] font-black text-slate-300 uppercase tracking-widest hover:text-slate-950 py-2">稍後再說</button>
        </div>
      </Modal>

      <style>{`
        .safe-top { padding-top: env(safe-area-inset-top); }
        .shadow-up { box-shadow: 0 -4px 12px -2px rgba(0, 0, 0, 0.05); }
        .shadow-inner-light { box-shadow: inset 0 2px 4px 0 rgba(0, 0, 0, 0.02); }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-4px); }
          75% { transform: translateX(4px); }
        }
        .animate-shake { animation: shake 0.2s ease-in-out infinite; animation-iteration-count: 2; }
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
