import { motion } from "framer-motion";
import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react";

export function HolographicEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
}: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetPosition,
    targetX,
    targetY,
  });

  return (
    <>
      <defs>
        <filter id={`glow-${id}`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="glow" />
          <feMerge>
            <feMergeNode in="glow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Shadow/Glow Path */}
      <path
        id={id}
        style={style}
        className="react-flow__edge-path opacity-20"
        d={edgePath}
        stroke="var(--accent-mint)"
        strokeWidth={4}
        fill="none"
        filter={`url(#glow-${id})`}
      />

      {/* Main Path */}
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{ ...style, stroke: "var(--accent-mint)", strokeWidth: 1.5, opacity: 0.8 }}
      />

      {/* Data Pulse Animation */}
      <motion.path
        d={edgePath}
        fill="none"
        stroke="white"
        strokeWidth={2}
        strokeDasharray="10 60"
        strokeLinecap="round"
        initial={{ strokeDashoffset: 70 }}
        animate={{ strokeDashoffset: -70 }}
        transition={{
          duration: 3,
          repeat: Infinity,
          ease: "linear",
        }}
        filter={`url(#glow-${id})`}
        style={{ opacity: 0.6 }}
      />

      {/* Tapered end effect (gradient) */}
      <linearGradient id={`grad-${id}`} x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="var(--accent-mint)" stopOpacity="0.2" />
        <stop offset="100%" stopColor="var(--accent-mint)" stopOpacity="1" />
      </linearGradient>
    </>
  );
}
