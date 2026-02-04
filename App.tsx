//n
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { ChatState, ChatNode, Message } from './types';
import { ChatView } from './components/ChatView';
import { NodeView } from './components/NodeView';
import { generateResponse, generateTitle } from './services/geminiService';
import { dbService } from './services/dbService';
import { supabase } from './services/supabaseClient';
import { generateResponseOpenAI } from './services/openaiService';

interface Conversation {
  id: string;
  nodes: Record<string, ChatNode>;
  rootNodeId: string | null;
  currentNodeId: string | null;
  title: string;
  timestamp: number;
}

const STORAGE_KEY = 'lumina_conversations_v2'; // Bumped version for logic change

const App: React.FC = () => {
  const [conversations, setConversations] = useState<any[]>([]); 
  const [isLoading, setIsLoading] = useState(true);
  const [isSwitching, setIsSwitching] = useState(false);

  const handleLogout = async () => {
    if (confirm("Are you sure you want to log out?")) {
      await supabase.auth.signOut();
    }
  };

  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  
  const [workspace, setWorkspace] = useState<ChatState & { branchingFromId: string | null }>({
    nodes: {},
    rootNodeId: null,
    currentNodeId: null,
    viewMode: 'chat',
    branchingFromId: null,
  });

  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedModel, setSelectedModel] = useState("gemini-3-flash-preview");

  // Add this near the top of your App component, after the useState declarations:

useEffect(() => {
  console.log('🔍 [WORKSPACE UPDATE]');
  console.log('  - Total nodes:', Object.keys(workspace.nodes).length);
  console.log('  - Node IDs:', Object.keys(workspace.nodes));
  console.log('  - Current node:', workspace.currentNodeId);
  console.log('  - Root node:', workspace.rootNodeId);
  console.log('  - Branching from:', workspace.branchingFromId);
}, [workspace.nodes, workspace.currentNodeId, workspace.rootNodeId, workspace.branchingFromId]);

  useEffect(() => {
    const loadSidebar = async () => {
      try {
        const data = await dbService.fetchConversations();
        setConversations(data);
      } catch (err) {
        console.error("Sidebar load failed:", err);
      } finally {
        setIsLoading(false);
      }
    };
    loadSidebar();
  }, []);

  const getFullHistoryPath = useCallback((nodeId: string | null): ChatNode[] => {
    if (!nodeId) return [];
    const path: ChatNode[] = [];
    let currentId: string | null = nodeId;
    
    while (currentId && workspace.nodes[currentId]) {
      path.unshift(workspace.nodes[currentId]);
      currentId = workspace.nodes[currentId].parentId;
    }
    return path;
  }, [workspace.nodes]);

  const activeMessages = useMemo(() => {
    // History is the full set of messages in nodes leading up to current
    const path = getFullHistoryPath(workspace.currentNodeId);
    return path.flatMap(node => 
      [...node.messages].sort((a, b) => a.ordinal - b.ordinal)
    );
  }, [workspace.currentNodeId, getFullHistoryPath]);

    const generateHierarchicalLabel = (parentId: string | null, nodes: Record<string, ChatNode>): string => {
    if (!parentId) return "1";
    const parent = nodes[parentId];
    const siblingsCount = parent.childrenIds.length;
    const endsWithLetter = /[a-z]$/.test(parent.hierarchicalID);
    return endsWithLetter ? `${parent.hierarchicalID}.${siblingsCount + 1}` : `${parent.hierarchicalID}.${String.fromCharCode(97 + siblingsCount)}`;
  };

  const generateCoolId = (parentId: string | null, nodes: Record<string, ChatNode>): string => {
    if (!parentId) return "1";
    const parent = nodes[parentId];
    const siblingsCount = parent.childrenIds.length;
    const endsWithLetter = /[a-z]$/.test(parentId);
    return endsWithLetter ? `${parentId}.${siblingsCount + 1}` : `${parentId}.${String.fromCharCode(97 + siblingsCount)}`;
  };

  const handleDeleteConversation = async (convId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent selecting the conversation when clicking delete
    
    if (confirm("Delete this conversation? This action cannot be undone.")) {
      try {
        await dbService.deleteConversation(convId);
        
        // If we're deleting the active conversation, reset workspace
        if (activeConvId === convId) {
          setActiveConvId(null);
          setWorkspace({
            nodes: {},
            rootNodeId: null,
            currentNodeId: null,
            viewMode: 'chat',
            branchingFromId: null,
          });
        }
        
        // Refresh the sidebar
        const updatedConvs = await dbService.fetchConversations();
        setConversations(updatedConvs);
      } catch (err) {
        console.error("Delete failed:", err);
        alert("Failed to delete conversation");
      }
    }
  };

  const handleSelectConversation = async (id: string | null) => {
    console.log('🔍 handleSelectConversation called! id:', id, 'activeConvId:', activeConvId);
    
    // Don't reload if we're already on this conversation
    if (id === activeConvId) {
      console.log('⏭️ Skipping - already active');
      return;
    }
    setActiveConvId(id);
    setIsSwitching(true);
    // If id is null, we are starting a NEW thread. Reset workspace.
    if (!id) {
      setWorkspace({
        nodes: {},
        rootNodeId: null,
        currentNodeId: null,
        viewMode: 'chat',
        branchingFromId: null,
      });
      setIsSwitching(false);
      return;
    }

    try {
      const nodesMap = await dbService.fetchConversationDetail(id);
      const header = conversations.find(c => c.id === id);

      setWorkspace({
        nodes: nodesMap,
        rootNodeId: header?.root_node_id || null, 
        currentNodeId: header?.current_node_id || null,
        viewMode: 'chat',
        branchingFromId: null,
      });
    } catch (err) {
      console.error("Hydration failed:", err);
    } finally {
      setIsSwitching(false);
    }
  };

  const handleSendMessage = async (text: string, files: File[]) => {
    if (isGenerating || (!text.trim() && files.length === 0)) return;

    console.log('🚀 [START] Message send initiated');
    const perfStart = performance.now();
    setIsGenerating(true);

    let currentConvId = activeConvId;
    const isNewConversation = !currentConvId;
    const isBranching = !!workspace.branchingFromId;
    const timestamp = Date.now();

    // 1. GENERATE IDS ON CLIENT (The "Forever" IDs)
    // We use crypto.randomUUID() to generate a real UUID v4 immediately.
    // If we need a new node, we generate its ID now and keep it forever.
    const clientGeneratedNodeId = self.crypto.randomUUID();
    
    // Determine the Target Node ID immediately
    const targetNodeId = (isNewConversation || isBranching) 
      ? clientGeneratedNodeId 
      : workspace.currentNodeId!;

    const capturedParentId = isBranching ? workspace.branchingFromId : null;
    const capturedHLabel = generateHierarchicalLabel(capturedParentId, workspace.nodes);

    const currentMessages = (workspace.currentNodeId && workspace.nodes[workspace.currentNodeId])
      ? workspace.nodes[workspace.currentNodeId].messages
      : [];

    const userMsg: Message = {
      role: 'user',
      content: text,
      timestamp: timestamp,
      ordinal: isNewConversation || isBranching ? 0 : currentMessages.length
    };

    // 2. OPTIMISTIC UPDATE (Using the REAL ID)
    if (isNewConversation || isBranching) {
      console.log('🟢 [OPTIMISTIC] Creating new node with PERMANENT ID:', targetNodeId);

      setWorkspace(prev => {
        const newNodes = {
          ...prev.nodes,
          [targetNodeId]: {
            id: targetNodeId, // <--- We use the final ID right away
            hierarchicalID: capturedHLabel,
            parentId: capturedParentId,
            messages: [{ ...userMsg }],
            title: '...',
            timestamp: timestamp,
            childrenIds: [],
            isBranch: isBranching
          }
        };

        // Update parent's childrenIds if branching
        if (capturedParentId && prev.nodes[capturedParentId]) {
          newNodes[capturedParentId] = {
            ...prev.nodes[capturedParentId],
            childrenIds: [...prev.nodes[capturedParentId].childrenIds, targetNodeId]
          };
        }

        return {
          ...prev,
          nodes: newNodes,
          currentNodeId: targetNodeId,
          rootNodeId: !capturedParentId ? targetNodeId : prev.rootNodeId,
          branchingFromId: null
        };
      });
    } else {
      // Normal message appending
      setWorkspace(prev => {
        const node = prev.nodes[targetNodeId];
        if (!node) return prev;
        return {
          ...prev,
          nodes: {
            ...prev.nodes,
            [targetNodeId]: { ...node, messages: [...node.messages, userMsg] }
          }
        };
      });
    }

    try {
      // 3. GENERATE AI RESPONSE (Stream into the view)
      // Manually build context because state might not have updated in this closure yet
      let aiContext;
      if (isNewConversation || isBranching) {
          const parentHistory = getFullHistoryPath(capturedParentId);
          aiContext = parentHistory.flatMap(n => 
            n.messages.map(m => ({ role: m.role, parts: [{ text: m.content }] }))
          );
      } else {
          const historyPath = getFullHistoryPath(targetNodeId);
          aiContext = historyPath.flatMap(n => 
            n.messages.map(m => ({ role: m.role, parts: [{ text: m.content }] }))
          );
      }

      const isOpenAI = selectedModel.startsWith('gpt-');
      let stream;
      
      // Call API
      if (isOpenAI) {
        const openaiContext = aiContext.map((msg: any) => ({
          role: msg.role === 'model' ? 'assistant' as const : msg.role as 'user',
          content: msg.parts[0].text
        }));
        stream = await generateResponseOpenAI(text, openaiContext, files, selectedModel);
      } else {
        stream = await generateResponse(text, aiContext, files, selectedModel);
      }

      // 4. STREAM HANDLING
      let fullResponse = "";
      const aiMsgTimestamp = Date.now();
      const aiMsg: Message = {
        role: 'model',
        content: '',
        timestamp: aiMsgTimestamp,
        ordinal: userMsg.ordinal + 1
      };

      // Add empty AI message to UI
      setWorkspace(prev => {
        const node = prev.nodes[targetNodeId];
        if (!node) return prev;
        return {
          ...prev,
          nodes: {
            ...prev.nodes,
            [targetNodeId]: { ...node, messages: [...node.messages, aiMsg] }
          }
        };
      });

      // Stream Helper
      const streamWordsGradually = async (textChunk: string) => {
        fullResponse += textChunk;
        setWorkspace(prev => {
          const node = prev.nodes[targetNodeId];
          if (!node) return prev;
          const updatedMessages = [...node.messages];
          const lastMsg = updatedMessages[updatedMessages.length - 1];
          if (lastMsg.role === 'model') {
             lastMsg.content = fullResponse;
          }
          return {
            ...prev,
            nodes: { ...prev.nodes, [targetNodeId]: { ...node, messages: updatedMessages } }
          };
        });
        await new Promise(r => setTimeout(r, 0));
      };

      // Process Stream
      if (isOpenAI) {
        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || '';
          if (content) await streamWordsGradually(content);
        }
      } else {
        for await (const chunk of stream) {
          const chunkText = typeof chunk.text === 'function' ? chunk.text() : chunk.text || "";
          await streamWordsGradually(chunkText);
        }
      }

      setIsGenerating(false);

      // 5. DATABASE SYNC (Background)
      // We already have the IDs, we just need to save them.
      
      if (isNewConversation) {
        // Create conversation wrapper first
        const newConv = await dbService.createConversation("New Discussion");
        currentConvId = newConv.id;
        setActiveConvId(currentConvId);
      }

      if (isNewConversation || isBranching) {
        // SAVE NODE WITH OUR PRE-GENERATED ID
        await dbService.createNode({
          id: targetNodeId, // <--- PASSING THE ID WE GENERATED
          conversations_id: currentConvId!,
          parent_id: capturedParentId,
          hierarchical_id: capturedHLabel,
          is_branch: isBranching,
          title: '...'
        });
      }

      // Save Messages
      await dbService.createMessage({
        nodes_id: targetNodeId,
        role: 'user',
        content: text,
        ordinal: userMsg.ordinal
      });

      await dbService.createMessage({
        nodes_id: targetNodeId,
        role: 'model',
        content: fullResponse,
        ordinal: aiMsg.ordinal
      });

      // Update Pointers
      if (isNewConversation) {
        await dbService.updateConversationState(currentConvId!, {
          root_node_id: targetNodeId,
          current_node_id: targetNodeId
        });
      } else if (isBranching) {
        await dbService.updateConversationState(currentConvId!, {
          current_node_id: targetNodeId
        });
      }

      // 6. FINAL SYNC (Just to update sidebar/titles, NO NODE SWAPPING)
      const sidebarData = await dbService.fetchConversations();
      setConversations(sidebarData);
      
      console.log(`✅ [COMPLETE] Total time: ${(performance.now() - perfStart).toFixed(0)}ms`);
      
      if (isNewConversation || isBranching) {
        generateTitle(text, fullResponse).then(async (llmTitle) => {
          try {
            console.log("🏷️ Generated Title:", llmTitle);

            // A. Update Database
            await dbService.updateNodeTitle(targetNodeId, llmTitle);
            
            if (isNewConversation) {
               // Update conversation title in DB
               await dbService.updateConversationState(currentConvId!, { title: llmTitle });
            }

            // B. UPDATE LOCAL WORKSPACE (The Safe Way)
            // We update ONLY the title field of the specific node.
            // We do NOT re-fetch the whole node list, preventing the "stale data" wipeout.
            setWorkspace(prev => {
              const node = prev.nodes[targetNodeId];
              if (!node) return prev; // Safety check
              return {
                ...prev,
                nodes: {
                  ...prev.nodes,
                  [targetNodeId]: {
                    ...node,
                    title: llmTitle
                  }
                }
              };
            });

            // C. Update Sidebar (Background Sync)
            // This is safe to re-fetch because it doesn't affect the active view
            const updatedSidebar = await dbService.fetchConversations();
            setConversations(updatedSidebar);

          } catch (titleErr) {
            console.warn("Title generation failed silently:", titleErr);
            // We don't alert here because the message was sent successfully
          }
        });
      }

    } catch (err) {
      console.error("Message Failure:", err);
      setIsGenerating(false);
      alert("Something went wrong: " + (err as Error).message);
      // No rollback needed usually, but you can add it if you want to be strict
    }
  };


  const handleClearAll = () => {
    if (confirm("Purge all topological data from local storage?")) {
      setConversations([]);
      setActiveConvId(null);
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  const currentTitle = useMemo(() => {
    const node = workspace.currentNodeId ? workspace.nodes[workspace.currentNodeId] : null;
    return node?.title && node.title !== '...' ? node.title : "Lumina Session";
  }, [workspace.nodes, workspace.currentNodeId]);

  return (
    <div className="flex h-screen w-screen bg-[#020203] text-zinc-100 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-[300px] bg-[#050505] border-r border-zinc-900 flex flex-col z-[110] shadow-2xl">
        {/* lUMINA LOGO */}
        <div className="flex items-center gap-4 pointer-events-auto pt-10 px-8 mb-4">
    <div className="w-10 h-10 bg-zinc-900 border border-zinc-800 rounded-xl flex items-center justify-center shadow-2xl">
        <svg className="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
    </div>
    <div>
        <h1 className="text-[13px] font-black tracking-[0.4em] uppercase text-white">LLM-Brancher</h1>
        <p className="text-[8px] font-bold tracking-[0.2em] uppercase text-zinc-600">Alpha Version</p>
    </div>
</div>

        <div className="p-6">
          <button 
            onClick={() => handleSelectConversation(null)}
            className="w-full flex items-center justify-center gap-3 py-4 bg-zinc-900 border border-zinc-800 hover:border-blue-500 hover:bg-zinc-800 rounded-2xl transition-all group active:scale-95 shadow-lg"
          >
            <div className="p-1 bg-blue-600/20 rounded-md">
              <svg className="w-4 h-4 text-blue-500 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" />
              </svg>
              
            </div>
            
            <span className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-300">New Chat</span>
          </button>
        </div>

        <div className="px-6 mb-4 flex items-center justify-between">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-600">Chats</p>
          
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar px-3 space-y-2">
          {conversations.length === 0 && (
            <div className="px-3 py-20 text-center opacity-10">
              <svg className="w-12 h-12 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth={1} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
              <p className="text-[10px] font-bold uppercase tracking-widest">No active protocols</p>
            </div>
          )}
          {conversations.map((conv) => (
            <div
    key={conv.id}
    className={`relative group/conv rounded-2xl transition-all border ${activeConvId === conv.id ? 'bg-blue-600/10 border-blue-500/30 text-white shadow-inner ring-1 ring-blue-500/20' : 'bg-transparent border-transparent text-zinc-200 hover:bg-zinc-900 hover:text-zinc-300'}`}
  >
    <button
      onClick={() => handleSelectConversation(conv.id)}
      className="w-full text-left px-5 py-5 rounded-2xl transition-all"
    >
      <h3 className="text-[13px] font-bold truncate pr-10 leading-tight mb-1.5">{conv.title}</h3>
      <div className="flex items-center gap-2">
        {/* <span className="text-[8px] font-mono opacity-40 uppercase tracking-tighter bg-zinc-800 px-1 rounded">V-{conv.id.substring(0, 4)}</span> */} 
       <span className="w-1 h-1 rounded-full bg-zinc-800" />  
        <span className="text-[8px] font-mono opacity-40 uppercase tracking-tighter">{new Date(conv.created_at).toLocaleDateString()}</span> 
      </div>
    </button>
    
    {/* Delete Button */}
    <button
      onClick={(e) => handleDeleteConversation(conv.id, e)}
      className="absolute right-3 top-1/2 -translate-y-1/2 p-2 opacity-0 group-hover/conv:opacity-100 hover:bg-red-600 bg-zinc-800 rounded-lg transition-all"
      title="Delete conversation"
    >
      <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
      </svg>
    </button>
    
    {activeConvId === conv.id && (
      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-blue-500 rounded-r-full shadow-[0_0_10px_rgba(59,130,246,1)]" />
    )}
  </div>
          ))}
        </div>

        <div className="p-6 border-t border-zinc-900 bg-zinc-950/50">
           <div className="flex items-center gap-3 opacity-100 grayscale group hover:grayscale-0 transition-all cursor-default">
              <button 
            onClick={() => handleLogout()}
            className="w-full flex items-center justify-center gap-3 py-4 bg-zinc-900 border border-zinc-800 hover:border-blue-500 hover:bg-zinc-800 rounded-2xl transition-all group active:scale-95 shadow-lg"
          >
            
            <span className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-300">LOG OUT</span>
          </button>
           </div>
        </div>
      </aside>

      {/* Main Workspace */}
      <div className="flex-1 flex flex-col relative overflow-hidden bg-black">
        <header className="z-[100] h-20 bg-black/50 backdrop-blur-md px-10 flex items-center justify-between absolute top-0 left-0 right-0 border-b border-zinc-900/50">
  <div className="flex items-center gap-6 overflow-hidden">
    <h2 className="text-[13px] font-black tracking-[0.2em] uppercase text-white truncate max-w-[300px]">
      {currentTitle}
    </h2>
    {workspace.currentNodeId && (
      <div className="flex items-center gap-2 px-3 py-1 bg-zinc-900 border border-zinc-800 rounded-full">
        <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Branch</span>
        <span className="text-[10px] font-mono text-blue-500">
          {workspace.nodes[workspace.currentNodeId]?.hierarchicalID}
        </span>
      </div>
    )}
  </div>

  <div className="flex items-center gap-4">
    <button
      onClick={() => {
            console.log('🔄 [VIEW SWITCH] Switching from', workspace.viewMode, 'to', workspace.viewMode === 'chat' ? 'node' : 'chat');

        setWorkspace(p => ({ ...p, viewMode: p.viewMode === 'chat' ? 'node' : 'chat' }))}
      }
        className={`flex items-center gap-3 px-6 py-2.5 rounded-xl transition-all duration-300 border ${
        workspace.viewMode === 'chat' 
          ? 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white' 
          : 'bg-blue-600 border-blue-500 text-white shadow-[0_0_20px_rgba(37,99,235,0.3)]'
      }`}
    >
      <span className="text-[10px] font-black uppercase tracking-widest">
        {workspace.viewMode === 'chat' ? 'Map Overview' : 'Back to Chat'}
      </span>
    </button>
  </div>
</header>

        <main className="flex-1 relative overflow-hidden ">
  {isSwitching && (
    <div className="absolute inset-0 z-[150] bg-black/20 backdrop-blur-xl flex flex-col items-center justify-center transition-all duration-500">
      <div className="relative">
        <div className="w-16 h-16 rounded-full border-t-2 border-blue-500 animate-spin" />
        <div className="absolute inset-0 m-auto w-8 h-8 bg-blue-500/20 rounded-full animate-pulse flex items-center justify-center">
           <div className="w-2 h-2 bg-blue-500 rounded-full shadow-[0_0_10px_rgba(59,130,246,1)]" />
        </div>
      </div>
      
    </div>
  )}
          <div className={`absolute inset-0 transition-all duration-170 ease-in-out ${workspace.viewMode === 'chat' ? 'blur-3xl grayscale opacity-10 scale-100 pointer-events-none' : 'opacity-100 scale-100'}`}>
            <NodeView 
              nodes={workspace.nodes} 
              rootNodeId={workspace.rootNodeId} 
              currentNodeId={workspace.currentNodeId} 
              viewMode={workspace.viewMode}
              onSelectNode={(id) => setWorkspace(prev => ({ ...prev, currentNodeId: id, branchingFromId: null, viewMode: 'chat' }))}
              onBranchNode={(id) => setWorkspace(p => ({ ...p, branchingFromId: id, currentNodeId: id, viewMode: 'chat' }))}
            />
          </div>

          <div 
            className={`relative z-50 w-full h-full flex items-center justify-center transition-all duration-[850ms] ease-[cubic-bezier(0.19,1,0.22,1)] ${workspace.viewMode === 'chat' ? 'chat-layer-enter scale-100 opacity-100 translate-y-0' : 'chat-layer-exit scale-[0.95] opacity-0 translate-y-24 pointer-events-none'}`}
          >
            <ChatView 
              history={getFullHistoryPath(workspace.currentNodeId)} 
              onSendMessage={handleSendMessage} 
              onBranch={(id) => setWorkspace(p => ({ ...p, branchingFromId: id, viewMode: 'chat' }))}
              isGenerating={isGenerating}
              isBranching={!!workspace.branchingFromId}
              onCancelBranch={() => setWorkspace(prev => ({ ...prev, branchingFromId: null }))}
              currentNodeId={workspace.currentNodeId}
              currentTitle={currentTitle}
              selectedModel={selectedModel}
              onModelSelect={setSelectedModel}
            />
          </div>
        </main>
      </div>
    </div>
  );
};

export default App;