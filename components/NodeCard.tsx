import React, { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { ChatNode } from '../types';

interface NodeCardData {
  id: string;
  onBranch: (id: string) => void;
  scale?: number;
}

const stripMarkdown = (text: string): string => {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .trim();
};

const extractHeadings = (messages: { content: string }[]): { text: string; depth: number; number?: number }[] => {
  const headings: { text: string; depth: number; number?: number }[] = [];

  for (const msg of messages) {
    const lines = msg.content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();

      // 1. Markdown headings: #, ##, ###, ####
      const hashMatch = trimmed.match(/^(#{1,4})\s+(.+)/);
      if (hashMatch) {
        headings.push({ depth: hashMatch[1].length, text: stripMarkdown(hashMatch[2].trim()) });
        continue;
      }

      // 2. Numbered list items that are bold: "1. **Make the dough:**"
      const numberedBoldMatch = trimmed.match(/^(\d+)\.\s+\*\*(.+?)\*\*:?$/);
      if (numberedBoldMatch) {
        headings.push({ depth: 2, number: parseInt(numberedBoldMatch[1]), text: stripMarkdown(numberedBoldMatch[2].trim()) });
        continue;
      }

      // 3. Standalone bold-only lines: "**Ingredients:**"
      const boldOnlyMatch = trimmed.match(/^\*\*(.+?)\*\*:?$/);
      if (boldOnlyMatch) {
        headings.push({ depth: 1, text: stripMarkdown(boldOnlyMatch[1].trim()) });
        continue;
      }
    }
  }

  return headings;
};

import { useNodeData } from '../src/contexts/NodeDataContext';

export const NodeCard = memo(({ data, selected }: NodeProps<NodeCardData>) => {
  const { id, onBranch, scale = 1 } = data;
  const nodes = useNodeData();
  const nodeData = nodes[id];

  const title = nodeData?.title || '';
  const messages = nodeData?.messages || [];
  const hierarchicalID = nodeData?.hierarchicalID || '';

  const firstMessage = messages[0]?.content || '';

  const rawTitle = title && title !== '...'
    ? title
    : (firstMessage.length > 30 ? firstMessage.substring(0, 30) + '...' : firstMessage);

  const displayTitle = stripMarkdown(rawTitle);
  const headings = extractHeadings(messages);

  return (
    <div
      style={{
        transform: `scale(${scale})`,
        transformOrigin: 'left center',
        width: '260px',
      }}
      className={`
        relative group transition-all duration-500 ease-out p-5 rounded-3xl border flex flex-col gap-2 shadow-sm
        ${selected
          ? 'bg-[var(--accent-color)]/10 border-[var(--accent-color)] shadow-[var(--accent-color)]/10 ring-1 ring-[var(--accent-color)]/20 shadow-2xl'
          : 'bg-[var(--card-bg)] border-[var(--border-color)] hover:border-[var(--accent-color)]/50 hover:bg-[var(--card-hover)] shadow-sm hover:shadow-lg'}
      `}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: 'var(--border-color)', border: 'none', width: '8px', height: '8px', left: '-4px' }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: 'var(--accent-color)', border: 'none', width: '8px', height: '8px', right: '-4px' }}
      />

      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${selected ? 'bg-[var(--accent-color)] animate-pulse' : 'bg-[var(--app-text-muted)] opacity-30'}`} />
            <span className="text-[9px] font-black text-[var(--app-text-muted)] uppercase tracking-[0.2em]">
              NODE {hierarchicalID}
            </span>
            <span className="text-[8px] px-1.5 py-0.5 bg-[var(--sidebar-bg)] rounded text-[var(--app-text-muted)] font-mono ml-auto border border-[var(--border-color)]">
              {messages.length} MSGS
            </span>
          </div>
          <h3 className={`text-[13px] font-bold text-[var(--app-text)] leading-tight transition-all duration-300 ${title === '...' ? 'animate-pulse opacity-40' : ''}`}>
            {displayTitle || "Untitled Segment"}
          </h3>
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onBranch(id);
          }}
          className="shrink-0 p-2 bg-[var(--sidebar-bg)] hover:bg-[var(--accent-color)] rounded-xl text-[var(--app-text-muted)] hover:text-white transition-all active:scale-90 border border-[var(--border-color)] shadow-sm"
          title="Branch from end of this node"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {/* Heading list */}
      {headings.length > 0 && (
        <div className="border-t border-[var(--border-color)] pt-2 flex flex-col gap-1">
          {headings.map((h, i) => {
            const isTop = h.depth === 1;
            return (
              <div
                key={i}
                className="flex items-baseline gap-2"
              >
                {h.number != null ? (
                  <span className="shrink-0 text-[11px] font-bold text-[var(--app-text-muted)] opacity-40 leading-none w-4 text-right">
                    {h.number}.
                  </span>
                ) : (
                  <span className={`shrink-0 mt-[3px] rounded-full ${isTop ? 'w-1 h-1 bg-[var(--accent-color)] opacity-40' : 'w-1.5 h-1.5 bg-[var(--border-color)]'}`} />
                )}
                <span className={`leading-snug ${isTop ? 'text-[12px] font-bold text-[var(--app-text-muted)]' : 'text-[13px] text-[var(--app-text)] opacity-80'}`}>
                  {h.text}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});