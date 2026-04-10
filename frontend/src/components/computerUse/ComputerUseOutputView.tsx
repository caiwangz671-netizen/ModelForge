import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Monitor, MessageSquare, Image as ImageIcon, Loader2 } from 'lucide-react';
import { MarkdownRenderer, StreamingMarkdownRenderer } from '@/components/MarkdownRenderer';

interface ComputerUseOutputViewProps {
  latestScreenshot: string | null;
  screenSummary: string;
  modelOutput: string;
  isStreaming: boolean;
}

export function ComputerUseOutputView({
  latestScreenshot,
  screenSummary,
  modelOutput,
  isStreaming,
}: ComputerUseOutputViewProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <Card className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,#0c1525,#09111d)] text-slate-100 shadow-[0_24px_80px_-60px_rgba(2,6,23,0.9)]">
        <CardHeader className="border-b border-white/10 pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Monitor className="w-4 h-4" />
              <CardTitle className="text-base text-white">{t('computerUse.screenPanelTitle')}</CardTitle>
            </div>
            {isStreaming && (
              <Badge className="animate-pulse rounded-full border border-cyan-400/20 bg-cyan-400/10 text-cyan-100 shadow-none">
                {t('common.loading')}
              </Badge>
            )}
          </div>
          <CardDescription className="text-sm leading-6 text-slate-400">{t('computerUse.screenPanelDescription')}</CardDescription>
        </CardHeader>

        <CardContent className="space-y-3">
          <div className="overflow-hidden rounded-[22px] border border-white/10 bg-black/25">
            {latestScreenshot ? (
              <img
                src={latestScreenshot}
                alt={t('computerUse.latestScreenshot')}
                className="aspect-video w-full object-cover"
              />
            ) : (
              <div className="flex aspect-video items-center justify-center bg-white/[0.03]">
                <div className="text-center">
                  <ImageIcon className="mx-auto mb-2 h-8 w-8 text-slate-600" />
                  <p className="text-sm text-slate-400">{t('computerUse.noScreenshot')}</p>
                </div>
              </div>
            )}
          </div>

          {screenSummary && (
            <div className="rounded-[18px] border border-cyan-400/15 bg-cyan-400/10 p-3">
              <p className="mb-1 text-xs font-semibold text-cyan-100">
                {t('computerUse.latestSummary')}
              </p>
              <p className="line-clamp-4 text-xs leading-6 text-cyan-100/80">
                {screenSummary}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,#0c1525,#09111d)] text-slate-100 shadow-[0_24px_80px_-60px_rgba(2,6,23,0.9)]">
        <CardHeader className="border-b border-white/10 pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4" />
              <CardTitle className="text-base text-white">{t('computerUse.assistantStream')}</CardTitle>
            </div>
            {isStreaming && (
              <Loader2 className="h-4 w-4 animate-spin text-cyan-200" />
            )}
          </div>
        </CardHeader>

        <CardContent>
          {modelOutput ? (
            <div className="rounded-[22px] border border-white/10 bg-white/[0.03] p-4">
              {isStreaming ? (
                <StreamingMarkdownRenderer
                  content={modelOutput}
                  enableMath={false}
                  enableCodeHighlight={false}
                  className="text-[15px] leading-7 text-slate-100 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                />
              ) : (
                <MarkdownRenderer
                  content={modelOutput}
                  enableMath={false}
                  enableCodeHighlight={false}
                  className="text-[15px] leading-7 text-slate-100 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                />
              )}
            </div>
          ) : (
            <div className="py-8 text-center">
              <MessageSquare className="mx-auto mb-2 h-8 w-8 text-slate-600" />
              <p className="text-sm text-slate-400">
                {isStreaming ? t('computerUse.waitingAssistant') : t('computerUse.noAssistantYet')}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
