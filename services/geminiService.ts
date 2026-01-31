import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove the data URL prefix (e.g., "data:image/png;base64,")
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

const getMimeType = (file: File): string => {
  return file.type || 'application/octet-stream';
};


export const generateResponse = async (
  prompt: string, 
  history: { role: 'user' | 'model'; parts: { text: string }[] }[],
  files: File[] = [],
  modelId: string = "gemini-3-flash-preview",
  isMock: boolean = false
) => {
  try {
    // 1. Build the user message parts
    const userParts: any[] = [];
    
    // Add text prompt
    if (prompt.trim()) {
      userParts.push({ text: prompt });
    }
    
    // Add files
    if (files.length > 0) {
      for (const file of files) {
        const base64Data = await fileToBase64(file);
        const mimeType = getMimeType(file);
        
        userParts.push({
          inlineData: {
            mimeType: mimeType,
            data: base64Data
          }
        });
      }
    }

    // 2. Build the full contents array
    const contents = [
      ...history,
      { role: 'user', parts: userParts }
    ];

    // 3. Call the STREAM method
    const result = await ai.models.generateContentStream({
      model: modelId, 
      contents: contents,
      config: { temperature: 0.8 }
    });

    // 4. Return the stream directly
    return result;

  } catch (error: any) {
    console.error("❌ Gemini API Error Details:", {
      message: error.message,
      fullError: error
    });
    // We throw the error here so App.tsx can catch it and display the "⚠️ Error" message
    throw error; 
  }
};

export const generateTitle = async (prompt: string, response: string, isMock: boolean = false) => {
  
  try {
    const result = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        { 
          role: 'user', 
          parts: [{ 
            text: `Generate a short, descriptive title (2-6 words) for this conversation. Do not use quotes or special characters.

User: "${prompt}"
AI: "${response.substring(0, 150)}..."

Title:` 
          }] 
        }
      ],
      config: { temperature: 0.7 }
    });

    let title = result.text?.replace(/["'#*\n]/g, '').trim() || "";
    
    // Basic validation: reject if empty, too long, or is just the prompt repeated
    if (!title || 
        title.length > 60 || 
        title.length < 3 ||
        title.toLowerCase() === prompt.toLowerCase().substring(0, title.length)) {
      return "New Conversation";
    }
    
    return title;
  } catch (err) {
    return "New Conversation";
  }
};