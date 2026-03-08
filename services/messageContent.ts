import { Message } from '../types';

const MESSAGE_CONTENT_PREFIX = '__KLADOS_MESSAGE_V2__';

type PersistedMessageContent = Pick<Message, 'content' | 'thinkingTrace'>;

export const encodeMessageContent = (message: PersistedMessageContent): string => {
  if (!message.thinkingTrace?.trim()) {
    return message.content;
  }

  return `${MESSAGE_CONTENT_PREFIX}${JSON.stringify({
    content: message.content,
    thinkingTrace: message.thinkingTrace,
  })}`;
};

export const decodeMessageContent = (rawContent: string | null | undefined): PersistedMessageContent => {
  const safeContent = rawContent ?? '';

  if (!safeContent.startsWith(MESSAGE_CONTENT_PREFIX)) {
    return { content: safeContent };
  }

  try {
    const parsed = JSON.parse(safeContent.slice(MESSAGE_CONTENT_PREFIX.length));
    return {
      content: typeof parsed?.content === 'string' ? parsed.content : '',
      thinkingTrace: typeof parsed?.thinkingTrace === 'string' ? parsed.thinkingTrace : undefined,
    };
  } catch {
    return { content: safeContent };
  }
};
