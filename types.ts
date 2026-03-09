
/**
 * Represents a single message in a conversation.
 */
export interface Message {
  id?: string;
  role: 'user' | 'model';
  content: string;
  thinkingTrace?: string;
  timestamp: number;
  ioTokens?: number;
  cost?: number;
  model?: string;
  provider?: string;
  /**
   * Position within the node (0 = first, 1 = second, etc.)
   * This is critical for database sorting.
   */
  ordinal: number;
}

/**
 * Represents a "Turn" or "Branch Point" in the conversation tree.
 */
export interface ChatNode {
  id: string;
  hierarchicalID: string;       // The "Cool ID" (1.a.1)
  parentId: string | null;
  messages: Message[];
  title: string;     // AI summary
  timestamp: number;
  childrenIds: string[];
  isBranch: boolean;
  branchMessageId?: string | null;
}

export interface ChatState {
  nodes: Record<string, ChatNode>;
  rootNodeId: string | null;
  currentNodeId: string | null;
  viewMode: 'chat' | 'node';
}
