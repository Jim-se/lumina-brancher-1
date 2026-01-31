
import React, { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { ChatNode } from '../types';

interface NodeCardData extends ChatNode {
  onBranch: (id: string) => void;
  scale?: number;
}

export const NodeCard = memo(({ data, selected }: NodeProps<NodeCardData>) => {
  const { title, id, onBranch, scale = 1, messages, hierarchicalID } = data;
  const lastMessage = messages[messages.length - 1]?.content || '';
  const firstMessage = messages[0]?.content || '';
  
  const displayTitle = title && title !== '...' 
    ? title 
    : (firstMessage.length > 30 ? firstMessage.substring(0, 30) + '...' : firstMessage);

  return (
    <div 
      style={{ 
        transform: `scale(${scale})`,
        transformOrigin: 'left center',
        width: '260px' 
      }}
      className={`
        relative group transition-all duration-500 ease-out p-5 rounded-2xl border flex flex-col gap-2
        ${selected 
          ? 'bg-blue-600/20 border-blue-500 shadow-[0_0_40px_rgba(59,130,246,0.3)] ring-1 ring-blue-500/50' 
          : 'bg-zinc-900/90 backdrop-blur-xl border-zinc-800 hover:border-zinc-600 hover:bg-zinc-800/95 shadow-2xl'}
      `}
    >
      <Handle 
        type="target" 
        position={Position.Left} 
        style={{ background: '#3f3f46', border: 'none', width: '8px', height: '8px', left: '-4px' }}
      />
      
      <Handle 
        type="source" 
        position={Position.Right} 
        style={{ background: '#3b82f6', border: 'none', width: '8px', height: '8px', right: '-4px' }}
      />

      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${selected ? 'bg-blue-400 animate-pulse' : 'bg-zinc-700'}`} />
            <span className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.2em]">
              NODE {hierarchicalID}
            </span>
            <span className="text-[8px] px-1.5 py-0.5 bg-zinc-800 rounded text-zinc-400 font-mono ml-auto">
              {messages.length} MSGS
            </span>
          </div>
          <h3 className={`text-[13px] font-bold text-white leading-tight better-words transition-all duration-300 ${title === '...' ? 'animate-pulse text-zinc-500' : ''}`}>
            {displayTitle || "Untitled Segment"}
          </h3>
        </div>
        
        <button
          onClick={(e) => {
            e.stopPropagation();
            onBranch(id);
          }}
          className="shrink-0 p-2 bg-zinc-800 hover:bg-blue-600 rounded-xl text-zinc-400 hover:text-white transition-all active:scale-90 border border-zinc-700/50 shadow-lg"
          title="Branch from end of this node"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

     {/* <div className="mt-1 border-t border-zinc-800/50 pt-2">
        <p className="text-[10px] text-zinc-400 italic line-clamp-1 opacity-60 mb-1">Latest:</p>
        <p className="text-[10px] text-zinc-500 line-clamp-2 leading-relaxed font-medium">
          {lastMessage || "Empty sequence..."}
        </p>
      </div>
      */}
      {selected && (
        <div  />
      )}
    </div>
  );
});