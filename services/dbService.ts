import { supabase } from './supabaseClient';
import { ChatNode, Message } from '../types';

export const dbService = {
  async fetchConversations() {
    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  // Add this inside your dbService object
  async fetchUserProfile(): Promise<{ fullName: string | null; email: string | undefined; createdAt: string | undefined } | null> {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) return null;

    const { data, error } = await supabase
      .from('users')
      .select('full_name')
      .eq('id', user.id)
      .single();
      
    if (error) {
      console.warn("Could not fetch user profile:", error);
      return { fullName: null, email: user.email, createdAt: user.created_at };
    }
    
    return { 
      fullName: data?.full_name || null, 
      email: user.email,
      createdAt: user.created_at
    };
  },

  async fetchConversationDetail(conversationId: string) {
    // 1. Fetch nodes
    const { data: nodesData, error: nodesError } = await supabase
      .from('nodes')
      .select('*')
      .eq('conversations_id', conversationId);
    
    if (nodesError) throw nodesError;

    // 2. Fetch messages for these nodes
    const { data: msgsData, error: msgsError } = await supabase
      .from('messages')
      .select('*')
      .in('nodes_id', nodesData.map(n => n.id))
      .order('ordinal', { ascending: true });

    if (msgsError) throw msgsError;

    // 3. Reconstruct the local graph
    const nodes: Record<string, ChatNode> = {};
    nodesData.forEach(n => {
      nodes[n.id] = {
        id: n.id,
        hierarchicalID: n.hierarchical_id,
        parentId: n.parent_id,
        title: n.title || '...',
        timestamp: new Date(n.created_at).getTime(),
        isBranch: n.is_branch,
        messages: msgsData
          .filter(m => m.nodes_id === n.id)
          .map(m => ({
            id: m.id,
            role: m.role as 'user' | 'model',
            content: m.content,
            timestamp: new Date(m.created_at).getTime(),
            ordinal: m.ordinal
          })),
        childrenIds: nodesData
          .filter(child => child.parent_id === n.id)
          .map(child => child.id)
      };
    });

    return nodes;
  },

 async initializeNewConversation(title: string, firstPrompt: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Auth required');

  // Start an explicit transaction using Supabase RPC
  const { data, error } = await supabase.rpc('create_conversation_with_root', {
    p_title: title,
    p_user_id: user.id,
    p_hierarchical_id: '1'
  });

  if (error) throw error;
  
  return {
    conv: { id: data.conversation_id, title, user_id: user.id },
    rootNode: { id: data.node_id, hierarchical_id: '1' }
  };
  },

  async createConversation(title: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    
    const { data, error } = await supabase
      .from('conversations')
      .insert({ title, user_id: user.id })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async deleteConversation(conversationId: string): Promise<void> {
    const { error } = await supabase
      .from('conversations')
      .delete()
      .eq('id', conversationId);
    
    if (error) throw error;
  },

  async updateConversationState(id: string, updates: { root_node_id?: string, current_node_id?: string, title?: string }) {
    const { data: { user } } = await supabase.auth.getUser(); // Add this
    if (!user) throw new Error('Not authenticated');
    
    const { error } = await supabase
      .from('conversations')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user.id);      
    if (error) throw error;
  },

  async reportBug(description: string, logs: string = "") {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from('bug_reports')
      .insert({
        user_id: user.id,
        description: description,
        logs: logs
      });

    if (error) throw error;
  },

  async createNode(payload: { 
    id?: string, // <--- ADD THIS
    conversations_id: string, 
    parent_id: string | null, 
    hierarchical_id: string, 
    is_branch: boolean, 
    title?: string,
  }) {

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { data, error } = await supabase
      .from('nodes')
      .insert({
        id: payload.id, // <--- ADD THIS
        conversations_id: payload.conversations_id,
        parent_id: payload.parent_id,
        hierarchical_id: payload.hierarchical_id,
        is_branch: payload.is_branch,
        title: payload.title || '...',
        user_id: user.id
      })
      .select() // This tells Supabase to send the new row back
      .single();
    if (error) throw error;
      return data;
  },

  async updateNodeTitle(id: string, title: string) {
    const { data: { user } } = await supabase.auth.getUser(); // Add this
    if (!user) throw new Error('Not authenticated');

    const { error } = await supabase
      .from('nodes')
      .update({ title })
      .eq('id', id)
      .eq('user_id', user.id);
    if (error) throw error;
  },

  async createMessage(payload: { 
    nodes_id: string, 
    role: string, 
    content: string, 
    ordinal: number 
  }) {

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { data, error } = await supabase
      .from('messages')
      .insert({
        ...payload, 
        user_id: user.id})
      .select()
      .single();
    if (error) throw error;
    return data;
  }
};
