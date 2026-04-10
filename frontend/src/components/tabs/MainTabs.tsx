import React, { useState, useCallback } from 'react';
import { ChatArea } from '../ChatArea';
import type { ChatMessage } from '../../types/index';
import { EnhancedSearch } from '../EnhancedSearch';
import { CostTracker } from '../CostTracker';
import { AuditLogs } from '../AuditLogs';
import { Settings } from '../Settings';
import type { CouncilMember } from '../../types/index';
import { useCouncilStream, type SSEEvent } from '../../hooks/useCouncilStream';

type TabId = 'ask' | 'history' | 'cost' | 'audit' | 'settings';

interface Tab {
  id: TabId;
  label: string;
  icon: string;
}

const tabs: Tab[] = [
  { id: 'ask', label: 'Ask', icon: 'chat' },
  { id: 'history', label: 'History', icon: 'history' },
  { id: 'cost', label: 'Cost', icon: 'attach_money' },
  { id: 'audit', label: 'Audit', icon: 'fact_check' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

// Default council members for standalone mode
const defaultMembers: CouncilMember[] = [
  {
    id: '1',
    name: 'GPT-4',
    type: 'openai-compat',
    apiKey: '',
    model: 'gpt-4',
    active: true,
    role: 'analyst',
    tone: 'neutral',
    customBehaviour: ''
  },
  {
    id: '2',
    name: 'Claude',
    type: 'anthropic',
    apiKey: '',
    model: 'claude-3-opus',
    active: true,
    role: 'critic',
    tone: 'neutral',
    customBehaviour: ''
  }
];

interface MainTabsProps {
  initialTab?: TabId;
}

export const MainTabs: React.FC<MainTabsProps> = ({ initialTab = 'ask' }) => {
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  
  // ChatArea state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [members, setMembers] = useState<CouncilMember[]>(defaultMembers);
  const [activeTitle, setActiveTitle] = useState('New Conversation');
  
  const handleEvent = useCallback((event: SSEEvent) => {
    setMessages(prev => {
      const lastMsg = prev[prev.length - 1];
      if (!lastMsg) return prev;

      const newMessages = [...prev];
      const currentMsg = { ...lastMsg };
      newMessages[newMessages.length - 1] = currentMsg;

      switch (event.type) {
        case 'member_chunk':
          if (!currentMsg.opinions) currentMsg.opinions = [];
          const opIndex = currentMsg.opinions.findIndex((o: any) => o.name === event.name);
          if (opIndex === -1) {
            currentMsg.opinions.push({ name: event.name, archetype: '', opinion: event.chunk });
          } else {
            currentMsg.opinions[opIndex].opinion += event.chunk;
            currentMsg.opinions = [...currentMsg.opinions];
          }
          break;
        case 'opinion':
          if (!currentMsg.opinions) currentMsg.opinions = [];
          const existingOp = currentMsg.opinions.findIndex((o: any) => o.name === event.name);
          if (existingOp === -1) {
            currentMsg.opinions.push({ name: event.name, archetype: event.archetype, opinion: event.opinion });
          } else {
            currentMsg.opinions[existingOp] = { ...currentMsg.opinions[existingOp], archetype: event.archetype, opinion: event.opinion };
          }
          break;
        case 'verdict_chunk':
          currentMsg.verdict = (currentMsg.verdict || '') + event.chunk;
          break;
        case 'verdict':
          currentMsg.verdict = event.verdict;
          break;
        case 'peer_review':
          currentMsg.peerReviews = event.reviews;
          break;
        case 'scored':
          currentMsg.scored = event.scored;
          break;
        case 'cost':
          currentMsg.costs = event.models;
          currentMsg.totalCostUsd = event.totalUsd;
          break;
        case 'done':
          currentMsg.verdict = event.verdict;
          currentMsg.durationMs = event.latency;
          currentMsg.cacheHit = event.cacheHit;
          setIsStreaming(false);
          break;
        case 'error':
          currentMsg.verdict = (currentMsg.verdict || '') + `\n\n[Error: ${event.message}]`;
          setIsStreaming(false);
          break;
      }

      return newMessages;
    });
  }, []);

  const { startStream } = useCouncilStream({
    onEvent: handleEvent,
    onError: (msg) => {
      console.error("Stream Error:", msg);
      setIsStreaming(false);
    }
  });

  const handleSendMessage = useCallback((_text: string, _summon: string, _useStream: boolean, _rounds: number) => {
    const newMessage: ChatMessage = {
      id: Date.now().toString(),
      question: _text,
      opinions: [],
    };
    setMessages(prev => [...prev, newMessage]);
    setIsStreaming(true);
    setActiveTitle(_text.slice(0, 50));
    
    // Call actual backend stream
    startStream({
      question: _text,
      mode: 'auto', // Default to auto as per README
      rounds: _rounds,
      useStream: _useStream,
      summon: _summon
    });
  }, [startStream]);
  
  const handleToggleSidebar = useCallback(() => {
    // No-op in tab mode
  }, []);
  
  const handleExport = useCallback((format: 'markdown' | 'json') => {
    console.log('Export as', format);
  }, []);

  const renderContent = () => {
    switch (activeTab) {
      case 'ask':
        return (
          <ChatArea
            messages={messages}
            isStreaming={isStreaming}
            onSendMessage={handleSendMessage}
            onToggleSidebar={handleToggleSidebar}
            activeTitle={activeTitle}
            members={members}
            onUpdateMembers={setMembers}
            onExport={handleExport}
            isLoading={false}
          />
        );
      case 'history':
        return <EnhancedSearch />;
      case 'cost':
        return <CostTracker />;
      case 'audit':
        return <AuditLogs />;
      case 'settings':
        return <Settings />;
      default:
        return (
          <ChatArea
            messages={messages}
            isStreaming={isStreaming}
            onSendMessage={handleSendMessage}
            onToggleSidebar={handleToggleSidebar}
            activeTitle={activeTitle}
            members={members}
            onUpdateMembers={setMembers}
            onExport={handleExport}
            isLoading={false}
          />
        );
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Tab Bar */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-border bg-card">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`
              flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
              transition-all duration-200
              ${activeTab === tab.id
                ? 'bg-accent/10 text-accent border border-accent/20'
                : 'text-text-muted hover:text-text hover:bg-muted/50'
              }
            `}
          >
            <span className="material-symbols-outlined text-base">{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden">
        {renderContent()}
      </div>
    </div>
  );
};
