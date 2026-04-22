import { useRef, useEffect, useState } from "react";
import { Card, CardContent } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Bot, Brain, Cpu, Sparkles } from "lucide-react";
import { cn } from "~/lib/utils";
import gsap from "gsap";
import type { Opinion } from "~/hooks/useDeliberation";

const AGENT_COLORS: Record<string, { bg: string; border: string; icon: string }> = {
  Analyst: { bg: "bg-blue-500/10", border: "border-blue-500/20", icon: "text-blue-500" },
  Creative: { bg: "bg-purple-500/10", border: "border-purple-500/20", icon: "text-purple-500" },
  Critic: { bg: "bg-amber-500/10", border: "border-amber-500/20", icon: "text-amber-500" },
  Strategist: { bg: "bg-emerald-500/10", border: "border-emerald-500/20", icon: "text-emerald-500" },
  Researcher: { bg: "bg-cyan-500/10", border: "border-cyan-500/20", icon: "text-cyan-500" },
};

const DEFAULT_COLOR = { bg: "bg-muted/50", border: "border-border", icon: "text-muted-foreground" };

const AGENT_ICONS: Record<string, typeof Bot> = {
  Analyst: Brain,
  Creative: Sparkles,
  Critic: Cpu,
};

interface AgentOpinionCardProps {
  opinion: Opinion;
  index: number;
}

export function AgentOpinionCard({ opinion, index }: AgentOpinionCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [displayedContent, setDisplayedContent] = useState("");
  const contentRef = useRef("");
  const animFrameRef = useRef<number | null>(null);

  const colors = AGENT_COLORS[opinion.agent] ?? DEFAULT_COLOR;
  const IconComponent = AGENT_ICONS[opinion.agent] ?? Bot;

  // Slide-in animation on mount
  useEffect(() => {
    if (!cardRef.current) return;
    gsap.fromTo(
      cardRef.current,
      { opacity: 0, y: 20, scale: 0.98 },
      { opacity: 1, y: 0, scale: 1, duration: 0.4, delay: index * 0.1, ease: "power2.out" }
    );
  }, [index]);

  // Animate content appearing char by char for streaming effect
  useEffect(() => {
    if (opinion.done) {
      // If done, show full content immediately
      setDisplayedContent(opinion.content);
      contentRef.current = opinion.content;
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      return;
    }

    const target = opinion.content;
    const current = contentRef.current;

    if (target.length <= current.length) return;

    // Animate remaining characters quickly
    let pos = current.length;
    const charsPerFrame = Math.max(1, Math.floor((target.length - pos) / 10));

    function tick() {
      pos = Math.min(pos + charsPerFrame, target.length);
      const text = target.slice(0, pos);
      contentRef.current = text;
      setDisplayedContent(text);

      if (pos < target.length) {
        animFrameRef.current = requestAnimationFrame(tick);
      } else {
        animFrameRef.current = null;
      }
    }

    animFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, [opinion.content, opinion.done]);

  return (
    <div ref={cardRef} style={{ opacity: 0 }}>
      <Card className={cn("border", colors.border, "transition-colors")}>
        <CardContent className="p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className={cn("flex items-center justify-center w-8 h-8 rounded-lg", colors.bg)}>
              <IconComponent className={cn("w-4 h-4", colors.icon)} />
            </div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm text-foreground">
                {opinion.agent}
              </span>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                {opinion.model}
              </Badge>
            </div>
            {!opinion.done && (
              <div className="ml-auto flex items-center gap-1">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                </span>
                <span className="text-xs text-muted-foreground">Thinking</span>
              </div>
            )}
          </div>
          <div className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">
            {displayedContent}
            {!opinion.done && (
              <span className="inline-block w-1.5 h-4 bg-primary/60 animate-pulse ml-0.5 align-text-bottom" />
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
