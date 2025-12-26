import { GoogleGenAI, Type } from "@google/genai";
import { ChatMessage } from "../types";

// Fix: Always use process.env.API_KEY directly in the named parameter.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Recommended models for standard text/image tasks.
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
  if (!process.env.API_KEY) return [];

  const prompt = "Provide current price/percent change for S&P 500 (^GSPC), Nasdaq (^IXIC), and Dow (^DJI). Return ONLY valid JSON array with keys: name, symbol, change, percent, isUp. Values must be strings (except isUp). Example: [{\"name\":\"S&P 500\",\"symbol\":\"SPX\",\"change\":\"+10\",\"percent\":\"+0.2%\",\"isUp\":true}]";

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
      try {
        const cleaned = response.text.replace(/```json|```/g, '').trim();
        return JSON.parse(cleaned) as IndexData[];
      } catch (e) {
        console.error("JSON parse error on indices", e);
        return [];
      }
    }
    return [];
  } catch (error) {
    console.error("Gemini Market Data error", error);
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
  if (!process.env.API_KEY) throw new Error("API Key is not configured.");

  const prompt = `你是一位資深量化交易員與美股分析師。目標標的：${symbol}。
請分析圖中的移動平均線排列、K 線形態、支撐與壓力位。

請嚴格按照以下格式回覆：
[SUMMARY]
在此處提供一個 150 字以內的重點精華總結，包含當前趨勢診斷、關鍵價位精華、以及具體的操作建議核心。
[ANALYSIS]
## 1. 趨勢診斷
## 2. 關鍵價位 (支撐/壓力)
## 3. 操作策略建議 (買入 / 賣出 / 觀望)

重點請使用 **加粗** 強調。`;

  try {
    const response = await ai.models.generateContent({
      model: MODEL_FLASH,
      contents: {
        parts: [
            { text: prompt },
            {
                inlineData: {
                    mimeType: mimeType,
                    data: base64Image
                }
            }
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

      // If parsing fails, fall back to showing everything in analysis
      if (!summary && !analysis) {
        analysis = fullText;
      }

      return {
        summary: highlightKeywords(summary),
        analysis: highlightKeywords(analysis)
      };
    }
    throw new Error("模型未返回有效分析。");
  } catch (error: any) {
    console.error("Gemini Analysis error", error);
    throw new Error(error.message || "分析引擎繁忙，請稍後再試。");
  }
};

export const sendChat = async (
  history: ChatMessage[],
  symbol: string,
  context: string = ""
): Promise<string> => {
  if (!process.env.API_KEY) throw new Error("API Key required.");

  let systemInstruction = `你是一位專業的美股助手。目前的關注標的是 ${symbol}。`;
  if (context) {
    systemInstruction += `\n請參考之前的技術分析報告內容來回答問題：\n${context}`;
  }
  systemInstruction += `\n請用專業、精煉、且具備洞察力的口吻回答，並適時給出風險提示。`;

  const contents = history.map(msg => ({
    role: msg.role,
    parts: [{ text: msg.text }]
  }));

  try {
    const response = await ai.models.generateContent({
      model: MODEL_FLASH,
      contents: contents,
      config: {
        systemInstruction: systemInstruction,
      }
    });

    return response.text || "我目前無法處理此問題，請嘗試調整提問方式。";
  } catch (error: any) {
    console.error("Gemini Chat error", error);
    throw new Error(error.message || "聊天室服務異常。");
  }
};