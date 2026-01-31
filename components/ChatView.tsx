
import React, { useRef, useEffect, useMemo, useState } from 'react';
import { ChatNode, Message } from '../types';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { vs } from 'react-syntax-highlighter/dist/esm/styles/hljs';

interface ChatViewProps {
  history: ChatNode[]; 
  onSendMessage: (text: string, files: File[]) => void;
  onBranch: (nodeId: string) => void;
  isGenerating: boolean;
  isBranching?: boolean;
  onCancelBranch?: () => void;
  currentNodeId: string | null;
  currentTitle?: string;
  selectedModel: string;
  onModelSelect: (modelId: string) => void;
}

const MODELS = [
  { id: 'gemini-3-pro-preview', name: 'Gemini 3.0 Pro' },
  { id: 'gemini-3-flash-preview', name: 'Gemini 3.0 Flash' },
  { id: 'gpt-5', name: 'ChatGPT 5'}
  //{ id: 'gemini-3-pro', name: 'Gemini 3 Pro' },
];

export const ChatView: React.FC<ChatViewProps> = ({ 
  history, 
  onSendMessage, 
  onBranch, 
  isGenerating,
  isBranching,
  onCancelBranch,
  currentNodeId,
  currentTitle,
  selectedModel,
  onModelSelect,
}) => {
  const [input, setInput] = React.useState('');
  const [files, setFiles] = useState<File[]>([]); // New state for files
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null); // New ref for file input
  const isAtBottomRef = useRef(true);
  const [userHasScrolledUp, setUserHasScrolledUp] = useState(false);
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const [showMinimap, setShowMinimap] = useState(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(event.target as Node)) {
        setIsModelMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);
    
  // Modified auto-scroll effect - respect user intent
  useEffect(() => {
    if (scrollRef.current && !userHasScrolledUp) {
      if (isAtBottomRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }
  }, [history, userHasScrolledUp]); // Add userHasScrolledUp dependency

  // Force snap only on generation START, and reset the flag
  useEffect(() => {
    if (isGenerating && scrollRef.current) {
      isAtBottomRef.current = true;
      setUserHasScrolledUp(false); // Reset when new generation starts
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [isGenerating]);

  const handleScroll = () => {
  if (scrollRef.current) {
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const distanceToBottom = scrollHeight - scrollTop - clientHeight;
    
    // User scrolled up even a tiny bit? Unlock immediately
    if (distanceToBottom > 10) {  // Very low threshold
      isAtBottomRef.current = false;
      setUserHasScrolledUp(true);
    } else {
      isAtBottomRef.current = true;
      setUserHasScrolledUp(false);
    }

    // Minimap logic
    setShowMinimap(true);
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      setShowMinimap(false);
    }, 1500);
  }
};

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
  console.log('🔍 handleFileSelect called!', e.target.files?.length, 'files');
  if (e.target.files && e.target.files.length > 0) {
    const newFiles = Array.from(e.target.files); // ✅ Capture files FIRST
    setFiles((prev) => {
      console.log('📦 Previous files:', prev.length, 'Adding:', newFiles.length);
      return [...prev, ...newFiles];
    });
    // Reset AFTER, with setTimeout
    setTimeout(() => {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }, 0);
  }
};

  // ADD THIS FUNCTION:
  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData.items;
    const pastedFiles: File[] = [];

    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === 'file' && items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) {
          pastedFiles.push(file);
        }
      }
    }

    if (pastedFiles.length > 0) {
      setFiles((prev) => [...prev, ...pastedFiles]);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!input.trim() && files.length === 0 || isGenerating) return;
    onSendMessage(input, files);
    setInput('');
    setFiles([]);

    setTimeout(() => {
    const textarea = document.querySelector('textarea');
    if (textarea) {
      textarea.style.height = 'auto';
    }
  }, 0);
  };

  const currentHierarchicalId = useMemo(() => {
    if (history.length === 0) return null;
    return history[history.length - 1].hierarchicalID;
  }, [history]);

  // Flatten messages from the history nodes
  const allMessages: { msg: Message, nodeId: string, isLastInNode: boolean }[] = [];
  history.forEach((node) => {
    node.messages.forEach((msg, idx) => {
      allMessages.push({ 
        msg, 
        nodeId: node.id, 
        isLastInNode: idx === node.messages.length - 1 
      });
    });
  });

  return (
    <div className="w-full h-full flex flex-col bg-transparent overflow-hidden pt-20 relative">
      
      {/* CENTERED EMPTY STATE */}
      {allMessages.length === 0 && !isGenerating && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-700 gap-4 pointer-events-none z-0">
          <div className="w-16 h-16 bg-zinc-900 rounded-2xl flex items-center justify-center border border-zinc-800">
            <svg className="w-8 h-8 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <p className="text-lg font-medium tracking-wide">Enter a prompt to start this chat.</p>
        </div>
      )}

      {/* SCROLLABLE MESSAGE AREA */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto custom-scrollbar relative z-10">
        <div className="max-w-3xl mx-auto px-6 pt-8 pb-12 space-y-8">
          {allMessages.map(({ msg, nodeId }, idx) => (
            <div id={`msg-${idx}`} key={`${nodeId}-${idx}`} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} group animate-in fade-in slide-in-from-bottom-2 duration-500`}>
        <div className={`max-w-full px-5 py-3 rounded-3xl relative transition-all duration-300 ${msg.role === 'user' ? 'bg-zinc-800/60 text-white rounded-tr-none border border-zinc-700/30' : 'bg-transparent text-zinc-200 rounded-tl-none border-none pl-0'}`}>                <ReactMarkdown components={{
                  code: ({node, inline, className, children, ...props}: any) => {
                    const match = /language-(\w+)/.exec(className || '');
                    const codeContent = String(children).replace(/\n$/, '');
                    
                    if (inline) return <code className="bg-zinc-800 text-blue-400 px-2 py-1 rounded text-sm font-mono" {...props}>{children}</code>;
                    
                    return (
                      <div className="relative group/code my-4 rounded-lg overflow-hidden border border-zinc-700/50">
                        {/* Header/Title Bar */}
                        <div className="flex items-center justify-between px-4 py-2 bg-zinc-900 border-b border-zinc-800 text-xs text-zinc-400">
                           <span className="font-mono">{match ? match[1] : 'code'}</span>
                           <button 
                             onClick={() => {
                               navigator.clipboard.writeText(codeContent);
                               // You might want to add a toast notification here
                             }}
                             className="flex items-center gap-1.5 hover:text-white transition-colors"
                           >
                             <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                             <span>Copy</span>
                           </button>
                        </div>
                        
                        {/* Code Block */}
                         {match ? (
                            <SyntaxHighlighter 
                              style={vscDarkPlus} 
                              language={match[1]} 
                              PreTag="div" 
                              className="!my-0 !bg-[#0d0d0d] custom-scrollbar" 
                              customStyle={{ margin: 0, padding: '1.5rem', background: '#0d0d0d' }}
                              {...props}
                            >
                              {codeContent}
                            </SyntaxHighlighter>
                        ) : (
                           <div className="p-4 bg-[#0d0d0d] overflow-x-auto custom-scrollbar">
                              <code className="font-mono text-sm text-zinc-200" {...props}>{children}</code>
                           </div>
                        )}
                      </div>
                    );
                  },
                  // --- CUSTOM TYPOGRAPHY (From User Request) ---
                      h1: ({node, ...props}) => <h1 className="text-2xl font-bold mb-4 text-white" {...props} />,
                      h2: ({node, ...props}) => <h2 className="text-xl font-bold mb-3 text-white" {...props} />,
                      h3: ({node, ...props}) => <h3 className="text-lg font-bold mb-2 text-white" {...props} />,
                      p: ({node, ...props}) => (
                            <p 
                              className={`leading-relaxed ${msg.role === 'user' ? 'mb-0' : 'mb-4 text-zinc-300'}`} 
                              {...props} 
                            />
                          ),                      
                      ul: ({node, ...props}) => <ul className="list-disc list-inside mb-4 space-y-2 text-zinc-300" {...props} />,
                      ol: ({node, ...props}) => <ol className="list-decimal list-inside mb-4 space-y-2 text-zinc-300" {...props} />,
                      li: ({node, ...props}) => <li className="text-zinc-300" {...props} />,
                      strong: ({node, ...props}) => <strong className="font-bold text-white" {...props} />,
                      a: ({node, ...props}) => <a className="text-blue-400 hover:text-blue-300 underline" target="_blank" rel="noopener noreferrer" {...props} />,
                      blockquote: ({node, ...props}) => <blockquote className="border-l-4 border-zinc-600 pl-4 italic text-zinc-400 my-4" {...props} />,  }}>
                  {msg.content}
                </ReactMarkdown>
                {msg.role === 'model' && (
                  <div className="mt-2 flex justify-end opacity-40 group-hover:opacity-100 transition-all">
                    <button onClick={() => onBranch(nodeId)} className="flex items-center gap-2 text-zinc-500 hover:text-blue-400 transition-colors py-1 pl-0 pr-2">
                       <span className="text-[10px] uppercase font-bold tracking-widest">Create new branch</span>
                       <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}

          {isGenerating && (
            <div className="flex justify-start pl-8 py-2">
              <svg className="w-6 h-6 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
          )}
        </div>
      </div>

      {/* Minimap */}
      <div 
        className={`absolute right-4 top-24 bottom-32 w-4 z-50 transition-opacity duration-300 ${showMinimap ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onMouseEnter={() => {
           setShowMinimap(true);
           if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
        }}
        onMouseLeave={() => {
           scrollTimeoutRef.current = setTimeout(() => setShowMinimap(false), 1000);
        }}
      >
        <div className="w-full h-full flex flex-col gap-1 py-2 overflow-hidden items-end">
          {allMessages.map((m, i) => (
            <div 
              key={i}
              onClick={() => document.getElementById(`msg-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
              className={`w-full rounded-sm cursor-pointer transition-all ${
                m.msg.role === 'user' 
                  ? 'bg-blue-500 opacity-60 hover:opacity-100' 
                  : 'bg-zinc-500 opacity-40 hover:opacity-100'
              }`}
              style={{
                height: `${Math.max(4, Math.min((m.msg.content.length / 50), 60))}px`,
                minHeight: '8px'
              }}
              title={`${m.msg.role}: ${m.msg.content.substring(0, 20)}...`}
            />
          ))}
        </div>
      </div>

      <div className="w-full bg-gradient-to-t from-black via-black/80 to-transparent pb-10 pt-6">
        <div className="max-w-3xl mx-auto px-6">
          {isBranching && (
            <div className="flex items-center justify-between px-6 py-3 bg-blue-600/10 border border-blue-500/30 text-blue-400 rounded-t-2xl mb-[-1px] mx-2 animate-in slide-in-from-bottom-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                <span className="text-[10px] font-black uppercase tracking-widest">Creating new branch</span>
              </div>
              <button onClick={onCancelBranch} className="text-[9px] font-black uppercase hover:text-white transition-colors flex items-center gap-1">
                Dismiss
              </button>
            </div>
          )}

          <div className={`flex flex-col gap-0 bg-zinc-800/40 border rounded-[2rem] p-0.7 transition-all shadow-inner ${isBranching ? 'border-blue-500/50 rounded-t-2xl ring-2 ring-blue-500/10' : 'border-zinc-700/50 focus-within:border-zinc-500 focus-within:bg-zinc-800/60'}`}>
           
           {files.length > 0 && (
            <div className="w-full flex gap-2 px-4 pt-4 overflow-x-auto custom-scrollbar">
              {files.map((file, i) => (
                <div key={i} className="flex items-center gap-2 bg-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-300 border border-zinc-700 shrink-0">
                  <span className="truncate max-w-[150px]">{file.name}</span>
                  <button 
                    type="button"
                    onClick={() => removeFile(i)}
                    className="hover:text-red-400 transition-colors"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
           
           <form onSubmit={handleSubmit} className="w-full flex flex-col gap-2 px-3 pb-3 pt-2">
              
              <input 
                type="file" 
                multiple 
                ref={fileInputRef}
                className="hidden"
                onChange={handleFileSelect}
              />

              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onPaste={handlePaste}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e);
                  }
                }}
                placeholder={isBranching ? "Type your message..." : "Type your message..."}
                className="w-full bg-transparent border-none px-2 py-2 text-base font-medium focus:outline-none placeholder:text-zinc-600 text-white resize-none overflow-y-auto custom-scrollbar min-h-[44px]"
                style={{
                  minHeight: '44px',
                  maxHeight: '200px',
                  height: 'auto'
                }}
                rows={1}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = 'auto';
                  target.style.height = Math.min(target.scrollHeight, 200) + 'px';
                }}
              />

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isGenerating}
                        className="p-2 text-zinc-400 hover:text-blue-400  rounded-full transition-all disabled:opacity-50"
                        title="Attach files"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                        </svg>
                    </button>

                   {/* Model Dropdown */}
                   <div className="relative" ref={modelMenuRef}>
                     <button 
                        type="button" 
                        onClick={() => setIsModelMenuOpen(!isModelMenuOpen)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-zinc-400 hover:text-white transition-all group"
                      >
                        <span>{MODELS.find(m => m.id === selectedModel)?.name || 'Select Model'}</span>
                        <svg className={`w-3 h-3 text-zinc-600 group-hover:text-zinc-400 transition-transform ${isModelMenuOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                     </button>
                     
                     {isModelMenuOpen && (
                        <div className="absolute bottom-full left-0 mb-2 w-48 bg-[#0a0a0a] border border-zinc-800 rounded-xl shadow-2xl overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-200">
                          {MODELS.map((model) => (
                            <button
                              key={model.id}
                              type="button"
                              onClick={() => {
                                onModelSelect(model.id);
                                setIsModelMenuOpen(false);
                              }}
                              className={`w-full text-left px-4 py-2.5 text-xs font-medium transition-colors ${selectedModel === model.id ? 'bg-zinc-900 text-white' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/50'}`}
                            >
                              {model.name}
                            </button>
                          ))}
                        </div>
                     )}
                   </div>
                </div>
              
                <button 
                  type="submit" 
                  disabled={(!input.trim() && files.length === 0) || isGenerating} 
                  className={`p-2 rounded-xl transition-all ${(!input.trim() && files.length === 0) || isGenerating ? 'text-zinc-600 cursor-not-allowed' : (isBranching ? 'text-blue-500 hover:text-blue-400' : 'text-zinc-200 hover:text-white')} hover:scale-[1.02] active:scale-[0.98]`}
                >
                  {isGenerating ? (
                    <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  ) : (
                    /* Fatter Icon */
                    <svg className="w-5 h-5 " viewBox="0 0 24 24" fill="currentColor">
                      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                    </svg>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );

};