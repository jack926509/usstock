export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export type TabType = 'analysis' | 'chat';

export interface AnalysisState {
  isAnalyzing: boolean;
  result: string | null;
  summary: string | null;
  error: string | null;
  imageBase64: string | null;
}

declare global {
  interface Window {
    TradingView: any;
  }
}