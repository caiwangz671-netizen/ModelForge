import { useEffect, useState, useRef } from 'react';
// import { useChatStore } from '@/store/chatStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { /* ToolUsePanel, WebSearchResults, */ CurrentTimeContext } from '@/components/ToolUse';
import { Brain, Send, Loader2, Bot, User, Sparkles, Wand2 } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

// GPT-OSS specific types
interface GPTOSSMessage {
  id: string;
  role: 'system' | 'developer' | 'user' | 'assistant' | 'tool';
  content: string;
  reasoning?: string;
  analysis?: string;
  commentary?: string;
  tool_calls?: any[];
  timestamp: Date;
}

interface GPTOSSConfig {
  reasoningLevel: 'low' | 'medium' | 'high';
  enableWebSearch: boolean;
  enablePython: boolean;
  enableBrowser: boolean;
}

export function GPTOSSChat() {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<GPTOSSMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [config, setConfig] = useState<GPTOSSConfig>({
    reasoningLevel: 'medium',
    enableWebSearch: true,
    enablePython: true,
    enableBrowser: false,
  });
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Add system message with current time context
  useEffect(() => {
    const systemMessage: GPTOSSMessage = {
      id: 'system-1',
      role: 'system',
      content: t('gptoss.systemPrompt', {
        currentTime: new Date().toISOString(),
      }),
      timestamp: new Date(),
    };
    setMessages([systemMessage]);
  }, [t]);

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return;

    const userMessage: GPTOSSMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: input,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsStreaming(true);

    // Prepare messages for API
    const apiMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'developer' ? 'system' : m.role,
        content: m.content,
      }));

    apiMessages.push({ role: 'user', content: input });

    try {
      const response = await fetch('http://localhost:8000/api/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-oss-20b', // or user's selected model
          messages: apiMessages,
          system: messages.find(m => m.role === 'system')?.content,
        }),
      });

      if (!response.body) {
        throw new Error('No response body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';
      let reasoningContent = '';

      // Create placeholder for assistant message
      const assistantMessage: GPTOSSMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, assistantMessage]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.thinking || data.reasoning) {
                reasoningContent += data.thinking || data.reasoning;
                setMessages(prev => {
                  const updated = [...prev];
                  const lastMsg = updated[updated.length - 1];
                  if (lastMsg.role === 'assistant') {
                    lastMsg.reasoning = reasoningContent;
                  }
                  return updated;
                });
              }

              if (data.content) {
                assistantContent += data.content;
                setMessages(prev => {
                  const updated = [...prev];
                  const lastMsg = updated[updated.length - 1];
                  if (lastMsg.role === 'assistant') {
                    lastMsg.content = assistantContent;
                  }
                  return updated;
                });
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (error) {
      toast({
        title: t('gptoss.toast.sendFailedTitle'),
        description: error instanceof Error ? error.message : t('common.unknownError'),
        variant: 'destructive',
      });
    } finally {
      setIsStreaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between py-4 border-b">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
            <Brain className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="font-semibold text-lg">{t('gptoss.title')}</h2>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>{t('gptoss.subtitle')}</span>
              <Badge variant="outline" className="text-xs">
                {config.reasoningLevel === 'high'
                  ? t('gptoss.reasoningLevels.high')
                  : config.reasoningLevel === 'medium'
                    ? t('gptoss.reasoningLevels.medium')
                    : t('gptoss.reasoningLevels.low')}
              </Badge>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <CurrentTimeContext />
        </div>
      </div>

      {/* Config Bar */}
      <div className="flex items-center gap-4 py-3 border-b bg-muted/30 px-4">
        <span className="text-sm text-muted-foreground">{t('gptoss.reasoningLevelLabel')}</span>
        <div className="flex gap-1">
          {(['low', 'medium', 'high'] as const).map((level) => (
            <Button
              key={level}
              variant={config.reasoningLevel === level ? 'default' : 'ghost'}
              size="sm"
              className="text-xs"
              onClick={() => setConfig(prev => ({ ...prev, reasoningLevel: level }))}
            >
              {t(`gptoss.reasoningLevels.${level}`)}
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-2 ml-4">
          <Button
            variant={config.enableWebSearch ? 'default' : 'ghost'}
            size="sm"
            className="text-xs gap-1"
            onClick={() => setConfig(prev => ({ ...prev, enableWebSearch: !prev.enableWebSearch }))}
          >
            <Wand2 className="h-3 w-3" />
            {t('gptoss.tools.webSearch')}
          </Button>
          <Button
            variant={config.enablePython ? 'default' : 'ghost'}
            size="sm"
            className="text-xs gap-1"
            onClick={() => setConfig(prev => ({ ...prev, enablePython: !prev.enablePython }))}
          >
            <Sparkles className="h-3 w-3" />
            {t('gptoss.tools.python')}
          </Button>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 py-4" ref={scrollRef}>
        <div className="space-y-6 px-4">
          {messages.filter(m => m.role !== 'system').map((message) => (
            <div key={message.id} className="space-y-3">
              {/* Reasoning Block */}
              {message.reasoning && (
                <div className="ml-11">
                  <Card className="border-amber-200 bg-amber-50/50 dark:bg-amber-950/20">
                    <CardContent className="p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Brain className="h-4 w-4 text-amber-600" />
                        <span className="text-xs font-medium text-amber-600">{t('gptoss.reasoningProcess')}</span>
                      </div>
                      <div className="text-sm text-muted-foreground whitespace-pre-wrap">
                        {message.reasoning}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* Main Message */}
              <div
                className={cn(
                  "flex gap-3",
                  message.role === 'user' ? 'flex-row-reverse' : ''
                )}
              >
                <div
                  className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0",
                    message.role === 'user'
                      ? 'bg-primary'
                      : 'bg-gradient-to-br from-blue-500 to-purple-600'
                  )}
                >
                  {message.role === 'user' ? (
                    <User className="h-4 w-4 text-primary-foreground" />
                  ) : (
                    <Bot className="h-4 w-4 text-white" />
                  )}
                </div>

                <div
                  className={cn(
                    "max-w-[85%] rounded-lg p-4",
                    message.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted'
                  )}
                >
                  <MarkdownRenderer
                    content={message.content}
                    enableMath={true}
                    enableCodeHighlight={true}
                  />
                </div>
              </div>
            </div>
          ))}

          {/* Streaming indicator */}
          {isStreaming && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                <Bot className="h-4 w-4 text-white" />
              </div>
              <div className="bg-muted rounded-lg p-4">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="p-4 border-t bg-background">
        <div className="flex gap-2">
          <Input
            placeholder={t('gptoss.inputPlaceholder')}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isStreaming}
            className="flex-1"
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || isStreaming}
            className="gap-2"
          >
            {isStreaming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Send className="h-4 w-4" />
                {t('gptoss.send')}
              </>
            )}
          </Button>
        </div>
        <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-4">
            <span>{t('gptoss.supportHint')}</span>
          </div>
          <div className="flex items-center gap-2">
            <span>{t('gptoss.enterHint')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
