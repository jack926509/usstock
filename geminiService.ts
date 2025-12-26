
import { GoogleGenAI, Type } from "@google/genai";
import { ChatMessage } from "../types";

const MODEL_PRO = 'gemini-3-pro-image-preview'; 
const MODEL_FLASH = 'gemini-3-flash-preview';

/**
 * 依照規範直接從 process.env.API_KEY 獲取金鑰
 */
const getAI = () => {
  const apiKey = (process.env && process.env.API_KEY) || '';
  return new GoogleGenAI({ apiKey });
};

export interface IndexData {
  name: string;
  symbol: string;
  change: string;
  percent: string;
  isUp: boolean;
}

export const fetchMarketIndices = async (): Promise<IndexData[]> => {
  try {
    const ai = getAI();
    // 使用 gemini-3-pro-image-preview 以支持 googleSearch 獲取實時數據
    const response = await ai.models.generateContent({
      model: MODEL_PRO,
      contents: "Provide current price and percentage change for S&P 500 (^GSPC), Nasdaq (^IXIC), and Dow Jones (^DJI). Return ONLY valid JSON array with keys: name, symbol, change, percent, isUp. Example: [{\"name\": \"S&P 500\", \"symbol\": \"^GSPC\", \"change\": \"+12.5\", \"percent\": \"+0.25%\", \"isUp\": true}]",
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
      },
    });

    if (response.text) {
      return JSON.parse(response.text.trim()) as IndexData[];
    }
    return [];
  } catch (error) {
    console.warn("Index fetch deferred (API Key potentially missing)");
    return [];
  }
};

const highlightKeywords = (text: string): string => {
  const replacements = [
    { regex: /買入|做多|多單|看漲/g, class: 'hl-buy' },
    { regex: /賣出|做空|空單|看跌/g, class: 'hl-sell' },
    { regex: /觀望|盤整|中性|等待/g, class: 'hl-wait' }
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
  try {
    const ai = getAI();
    const prompt = `你是一位專業的量化交易與技術分析專家。
標的：${symbol}。
請詳細分析圖中的移動平均線趨勢、K 線形態及支撐壓力位。
格式要求：
[SUMMARY] 簡短一句話給出操作建議。
[ANALYSIS] 詳細的 Markdown 格式報告。`;

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
      const summaryMatch = fullText.match(/\[SUMMARY\]([\s\S]*?)\[ANALYSIS\]/i);
      const analysisMatch = fullText.match(/\[ANALYSIS\]([\s\S]*)/i);
      
      summary = summaryMatch ? summaryMatch[1].trim() : fullText.split('\n')[0];
      analysis = analysisMatch ? analysisMatch[1].trim() : fullText;

      return {
        summary: highlightKeywords(summary),
        analysis: highlightKeywords(analysis)
      };
    }
    throw new Error("模型無回應");
  } catch (error: any) {
    throw new Error(error.message || "分析請求失敗");
  }
};

export const sendChat = async (
  history: ChatMessage[],
  symbol: string,
  context: string = ""
): Promise<string> => {
  try {
    const ai = getAI();
    const systemInstruction = `你是專業交易終端助手。目前標的：${symbol}。上下文背景：${context}`;

    const contents = history.map(msg => ({
      role: msg.role,
      parts: [{ text: msg.text }]
    }));

    const response = await ai.models.generateContent({
      model: MODEL_FLASH,
      contents,
      config: { systemInstruction }
    });
    return response.text || "暫時無法回應。";
  } catch (error: any) {
    throw new Error(error.message || "通訊錯誤");
  }
};
