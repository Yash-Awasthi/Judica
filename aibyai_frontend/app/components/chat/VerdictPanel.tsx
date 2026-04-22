import { useRef, useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import { Gavel, Copy, Share2, Check, Coins } from "lucide-react";
import { cn } from "~/lib/utils";
import gsap from "gsap";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { DeliberationCost } from "~/hooks/useDeliberation";

interface VerdictPanelProps {
  verdict: string;
  cost: DeliberationCost | null;
  isStreaming: boolean;
}

export function VerdictPanel({ verdict, cost, isStreaming }: VerdictPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!panelRef.current) return;
    gsap.fromTo(
      panelRef.current,
      { opacity: 0, y: 30 },
      { opacity: 1, y: 0, duration: 0.6, ease: "power2.out" }
    );
  }, []);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(verdict);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [verdict]);

  return (
    <div ref={panelRef} style={{ opacity: 0 }}>
      <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10">
                <Gavel className="w-4 h-4 text-primary" />
              </div>
              <CardTitle className="text-base">Council Verdict</CardTitle>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleCopy}
                disabled={isStreaming}
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-green-500" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={isStreaming}
              >
                <Share2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="pt-4">
          <div className="prose prose-sm dark:prose-invert max-w-none text-foreground/90">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{verdict}</ReactMarkdown>
          </div>
          {isStreaming && (
            <span className="inline-block w-1.5 h-4 bg-primary/60 animate-pulse ml-0.5 align-text-bottom" />
          )}
          {cost && (
            <>
              <Separator className="my-4" />
              <div className="flex items-center gap-2">
                <Coins className="w-3.5 h-3.5 text-muted-foreground" />
                <Badge variant="outline" className="text-xs font-mono">
                  {cost.tokens.toLocaleString()} tokens
                </Badge>
                <Badge variant="outline" className="text-xs font-mono">
                  ${cost.usd.toFixed(4)}
                </Badge>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
