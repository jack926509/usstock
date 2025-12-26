import React, { useEffect, useRef } from 'react';

interface TradingViewWidgetProps {
  symbol: string;
}

export const TradingViewWidget: React.FC<TradingViewWidgetProps> = ({ symbol }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 確保容器存在且 TradingView 腳本已加載
    if (!containerRef.current || !window.TradingView) return;

    // 清空舊容器內容以防止重複掛載實例
    containerRef.current.innerHTML = '';
    const widgetId = `tv_widget_${Math.random().toString(36).substring(7)}`;
    const widgetContainer = document.createElement('div');
    widgetContainer.id = widgetId;
    widgetContainer.style.height = '100%';
    widgetContainer.style.width = '100%';
    containerRef.current.appendChild(widgetContainer);

    const widget = new window.TradingView.widget({
      autosize: true,
      symbol: symbol,
      interval: "D",
      timezone: "Asia/Taipei",
      theme: "light",
      style: "1",
      locale: "zh_TW",
      toolbar_bg: "#ffffff",
      enable_publishing: false,
      allow_symbol_change: true,
      container_id: widgetId,
      studies: [
        { id: "MASimple@tv-basicstudies", inputs: { length: 20 } },
        { id: "MASimple@tv-basicstudies", inputs: { length: 50 } },
        { id: "MASimple@tv-basicstudies", inputs: { length: 200 } }
      ],
      // 移除頂部工具列一些干擾因素
      hide_side_toolbar: false,
      save_image: false,
      backgroundColor: "#F8FAFC",
      gridColor: "#F1F5F9",
    });

    return () => {
      // 雖然 TV widget 沒有提供標準的 .remove()，但清空容器有助於 GC
      if (containerRef.current) containerRef.current.innerHTML = '';
    };
  }, [symbol]);

  return (
    <div ref={containerRef} className="absolute inset-0 w-full h-full overflow-hidden bg-[#F8FAFC]" />
  );
};