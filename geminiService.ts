
import { GoogleGenAI, Type } from "@google/genai";
import { ChatMessage } from "../types";

const MODEL_PRO = 'gemini-3-pro-preview'; 
const MODEL_FLASH = 'gemini-3-flash-preview';

export interface IndexData {
  name: string;
  symbol: string;
  change: string;
  percent: string;
  isUp: boolean;
}

export const fetchMarketIndices = async (): Promise<IndexData[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = "Provide current price/percent change for S&P 500 (^GSPC), Nasdaq (^IXIC), and Dow (^DJI). Return ONLY valid JSON array with keys: name, symbol, change, percent, isUp. Values must be strings (except isUp).";

  try {
    const response = await ai.models.generateContent({
      model: MODEL_PRO,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
      },
    });

    if (response.text) {
      const cleaned = response.text.replace(/```json|```/g, '').trim();
      return JSON.parse(cleaned) as IndexData[];
    }
    return [];
  } catch (error) {
    console.error("Gemini 市場數據錯誤", error);
    return [];
  }
};

const highlightKeywords = (text: string): string => {
  const replacements = [
    { regex: /買入|做多|多單/g, class: 'hl-buy' },
    { regex: /賣出|做空|空單/g, class: 'hl-sell' },
    { regex: /觀望|中性|盤整|等待/g, class: 'hl-wait' }
  ];
  let processedText = text;
  replacements.forEach(r => {
    processedText = processedText.replace(r.regex, (match) => `<span class="${r.class}">${match}</span>`);
  });
  return processedText;
};

export const analyzeImage = async (
  symbol: string,
  base64Image: string,
  mimeType: string = 'image/jpeg'
): Promise<{ summary: string; analysis: string }> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = `你是一位資深量化交易員與美股分析師。目標標的：${symbol}。
分析圖中的移動平均線排列、K 線形態、支撐與壓力位。
請按照格式 [SUMMARY] 和 [ANALYSIS] 回覆。重點使用加粗強調。`;

  try {
    const response = await ai.models.generateContent({
      model: MODEL_FLASH,
      contents: {
        parts: [
            { text: prompt },
            { inlineData: { mimeType, data: base64Image } }
        ]
      }
    });

    if (response.text) {
      const fullText = response.text;
      let summary = "";
      let analysis = "";
      const summaryMatch = fullText.match(/\[SUMMARY\]([\s\S]*?)\[ANALYSIS\]/);
      const analysisMatch = fullText.match(/\[ANALYSIS\]([\s\S]*)/);
      if (summaryMatch) summary = summaryMatch[1].trim();
      if (analysisMatch) analysis = analysisMatch[1].trim();
      if (!summary && !analysis) analysis = fullText;

      return {
        summary: highlightKeywords(summary),
        analysis: highlightKeywords(analysis)
      };
    }
    throw new Error("模型未返回有效分析。");
  } catch (error: any) {
    throw new Error(error.message || "分析引擎繁忙或 API Key 無效。");
  }
};

export const sendChat = async (
  history: ChatMessage[],
  symbol: string,
  context: string = ""
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const systemInstruction = `專業美股助手。標的 ${symbol}。參考內容：${context}`;

  const contents = history.map(msg => ({
    role: msg.role,
    parts: [{ text: msg.text }]
  }));

  try {
    const response = await ai.models.generateContent({
      model: MODEL_FLASH,
      contents,
      config: { systemInstruction }
    });
    return response.text || "無法處理此問題。";
  } catch (error: any) {
    throw new Error(error.message || "聊天服務異常。");
  }
};
