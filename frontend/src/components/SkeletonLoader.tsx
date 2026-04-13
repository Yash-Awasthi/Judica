import { useState } from "react";

interface SkeletonLoaderProps {
  variant?: "card" | "text" | "avatar" | "chart" | "line";
  count?: number;
  className?: string;
}

export function SkeletonLoader({ variant = "text", count = 1, className = "" }: SkeletonLoaderProps) {
  const items = Array.from({ length: count }, (_, i) => i);

  const [chartBarHeights] = useState(() => Array.from({ length: 8 }, () => 30 + Math.random() * 70));
  const [lineWidths] = useState(() => Array.from({ length: count }, () => 60 + Math.random() * 40));

  const renderSkeleton = (key: number) => {
    switch (variant) {
      case "avatar":
        return <div key={key} className={`skeleton w-10 h-10 rounded-full ${className}`} />;

      case "card":
        return (
          <div key={key} className={`space-y-3 p-6 rounded-card border border-[var(--border-subtle)] ${className}`}>
            <div className="skeleton h-4 w-3/4 rounded" />
            <div className="skeleton h-3 w-full rounded" />
            <div className="skeleton h-3 w-5/6 rounded" />
            <div className="flex gap-2 pt-2">
              <div className="skeleton h-6 w-16 rounded-pill" />
              <div className="skeleton h-6 w-20 rounded-pill" />
            </div>
          </div>
        );

      case "chart":
        return (
          <div key={key} className={`space-y-2 ${className}`}>
            <div className="skeleton h-4 w-32 rounded mb-4" />
            <div className="flex items-end gap-2 h-40">
              {Array.from({ length: 8 }, (_, i) => (
                <div
                  key={i}
                  className="skeleton flex-1 rounded-t"
                  style={{ height: `${chartBarHeights[i]}%` }}
                />
              ))}
            </div>
          </div>
        );

      case "line":
        return <div key={key} className={`skeleton h-3 rounded ${className}`} style={{ width: `${lineWidths[key]}%` }} />;

      case "text":
      default:
        return (
          <div key={key} className={`space-y-2 ${className}`}>
            <div className="skeleton h-3 w-full rounded" />
            <div className="skeleton h-3 w-5/6 rounded" />
            <div className="skeleton h-3 w-4/6 rounded" />
          </div>
        );
    }
  };

  return <>{items.map(renderSkeleton)}</>;
}
