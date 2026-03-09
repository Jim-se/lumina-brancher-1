// Client is now handled by the backend proxy

// --- Helper Functions ---

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

const isImageFile = (file: File): boolean => {
  return file.type.startsWith('image/');
};

// --- Main Service Functions ---

import { API_BASE_URL } from './frontendConfig';
import { supabase } from './supabaseClient';

export interface ResponseStreamDelta {
  text?: string;
  reasoning?: string;
}

export interface ResponseUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

const toSafeTokenCount = (value: any): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return Math.round(parsed);
};

const collectTextFragments = (value: any): string[] => {
  if (!value) return [];

  if (typeof value === 'string') {
    return value ? [value] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap(collectTextFragments);
  }

  if (typeof value === 'object') {
    if (typeof value.text === 'string') {
      return value.text ? [value.text] : [];
    }

    if (typeof value.content === 'string') {
      return value.content ? [value.content] : [];
    }

    if (Array.isArray(value.content)) {
      return value.content.flatMap(collectTextFragments);
    }

    if (value.summary) {
      return collectTextFragments(value.summary);
    }

    if (value.part) {
      return collectTextFragments(value.part);
    }
  }

  return [];
};

const extractResponseDeltas = (payload: any): ResponseStreamDelta[] => {
  const deltas: ResponseStreamDelta[] = [];

  if (payload?.type === 'response.output_text.delta' && typeof payload.delta === 'string') {
    deltas.push({ text: payload.delta });
  }

  if (
    (payload?.type === 'response.reasoning_text.delta' ||
      payload?.type === 'response.reasoning_summary_text.delta') &&
    typeof payload.delta === 'string'
  ) {
    deltas.push({ reasoning: payload.delta });
  }

  const choice = payload?.choices?.[0];
  const choiceDelta = choice?.delta ?? choice?.message ?? payload?.delta;

  if (choiceDelta) {
    collectTextFragments(choiceDelta.content).forEach((text) => deltas.push({ text }));
    collectTextFragments(choiceDelta.reasoning).forEach((reasoning) => deltas.push({ reasoning }));
    collectTextFragments(choiceDelta.reasoning_content).forEach((reasoning) => deltas.push({ reasoning }));
    collectTextFragments(choiceDelta.reasoningDetails).forEach((reasoning) => deltas.push({ reasoning }));
    collectTextFragments(choiceDelta.reasoning_details).forEach((reasoning) => deltas.push({ reasoning }));
  }

  return deltas;
};

const extractResponseUsage = (payload: any): ResponseUsage | null => {
  const usage = payload?.usage;
  if (!usage || typeof usage !== 'object') {
    return null;
  }

  const hasUsageFields = [
    'prompt_tokens',
    'completion_tokens',
    'total_tokens',
    'input_tokens',
    'output_tokens',
    'promptTokens',
    'completionTokens',
    'totalTokens',
    'inputTokens',
    'outputTokens'
  ].some((field) => field in usage);

  if (!hasUsageFields) {
    return null;
  }

  const inputTokens = toSafeTokenCount(
    usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokens ?? usage.inputTokens
  );
  const outputTokens = toSafeTokenCount(
    usage.completion_tokens ?? usage.output_tokens ?? usage.completionTokens ?? usage.outputTokens
  );

  return {
    inputTokens,
    outputTokens,
    totalTokens: toSafeTokenCount(
      usage.total_tokens ?? usage.totalTokens ?? inputTokens + outputTokens
    ),
  };
};

export const generateResponse = async (
  prompt: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  files: File[] = [],
  modelId: string = "openai/gpt-4o",
  thinking: boolean = false
) => {
  try {
    const messages: any[] = history.map(msg => ({
      role: (msg.role as string) === 'model' ? 'assistant' : msg.role,
      content: msg.content || (msg as any).parts?.[0]?.text
    }));

    let userContent: any;
    if (files.length > 0) {
      const contentParts: any[] = [];
      if (prompt.trim()) {
        contentParts.push({ type: "text", text: prompt });
      }

      for (const file of files) {
        if (isImageFile(file)) {
          const base64Data = await fileToBase64(file);
          contentParts.push({
            type: "image_url",
            image_url: { url: `data:${file.type};base64,${base64Data}` }
          });
        }
      }
      userContent = contentParts;
    } else {
      userContent = prompt;
    }

    messages.push({ role: 'user', content: userContent });

    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;

    const sendChatRequest = async (requestBody: any) => {
      return fetch(`${API_BASE_URL}/api/openrouter/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(requestBody),
      });
    };

    const baseRequestBody: any = {
      model: modelId,
      messages,
      stream: true,
      stream_options: { include_usage: true }
    };
    const fullReasoningBody = {
      ...baseRequestBody,
      include_reasoning: true,
      reasoning: { effort: 'medium', summary: 'auto' }
    };
    const lightReasoningBody = {
      ...baseRequestBody,
      include_reasoning: true
    };

    let response = await sendChatRequest(thinking ? fullReasoningBody : baseRequestBody);
    if (!response.ok && thinking && response.status === 400) {
      console.warn(`OpenRouter rejected detailed reasoning params for ${modelId}. Retrying with include_reasoning only.`);
      response = await sendChatRequest(lightReasoningBody);
    }

    if (!response.ok && thinking && response.status === 400) {
      console.warn(`OpenRouter rejected reasoning params for ${modelId}. Retrying without reasoning traces.`);
      response = await sendChatRequest(baseRequestBody);
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Proxy Error: ${response.status}${errorText ? ` - ${errorText}` : ''}`);
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let streamConsumed = false;
    let latestUsage: ResponseUsage | null = null;

    return {
      getDeltaStream: async function* () {
        if (!reader) return;
        if (streamConsumed) {
          throw new Error('OpenRouter stream has already been consumed.');
        }

        streamConsumed = true;
        let buffer = '';

        const processEventBlock = (eventBlock: string): { deltas: ResponseStreamDelta[]; usage: ResponseUsage | null } => {
          const data = eventBlock
            .split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n')
            .trim();

          if (!data || data === '[DONE]') {
            return { deltas: [], usage: null };
          }

          try {
            const parsed = JSON.parse(data);
            return {
              deltas: extractResponseDeltas(parsed),
              usage: extractResponseUsage(parsed)
            };
          } catch {
            return { deltas: [], usage: null };
          }
        };

        try {
          while (true) {
            const { done, value } = await reader.read();
            buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

            const eventBlocks = buffer.split(/\r?\n\r?\n/);
            buffer = eventBlocks.pop() ?? '';

            for (const eventBlock of eventBlocks) {
              const { deltas, usage } = processEventBlock(eventBlock);
              if (usage) {
                latestUsage = usage;
              }

              for (const delta of deltas) {
                yield delta;
              }
            }

            if (done) {
              break;
            }
          }

          if (buffer.trim()) {
            const { deltas, usage } = processEventBlock(buffer);
            if (usage) {
              latestUsage = usage;
            }

            for (const delta of deltas) {
              yield delta;
            }
          }
        } finally {
          reader.releaseLock();
        }
      },
      getTextStream: async function* () {
        for await (const delta of this.getDeltaStream()) {
          if (delta.text) yield delta.text;
        }
      },
      getUsage: () => latestUsage,
      cancel: () => reader?.cancel()
    };

  } catch (error: any) {
    console.error("❌ Proxy OpenRouter API Error:", error);
    throw error;
  }
};

export const generateTitle = async (
  userMessage: string,
  aiResponse: string,
  modelName: string
) => {
  try {
    const messages = [
      { role: "system", content: "Summarize this into a 3-word title. No quotes." },
      { role: "user", content: `User: ${userMessage.slice(0, 200)}\nAI: ${aiResponse.slice(0, 200)}` }
    ];

    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;

    const response = await fetch(`${API_BASE_URL}/api/openrouter/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ model: modelName, messages })
    });

    if (!response.ok) throw new Error(`Proxy Error: ${response.status}`);

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.replace(/["']/g, "").trim() || "New Chat";

  } catch (error) {
    console.error("Title generation failed:", error);
    return "New Discussion";
  }
};
