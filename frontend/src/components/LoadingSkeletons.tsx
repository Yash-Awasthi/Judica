import { motion } from "framer-motion";

export const Skeleton = ({ className }: { className?: string }) => (
  <div className={`relative overflow-hidden ${className}`}>
    <motion.div
      animate={{
        opacity: [0.03, 0.08, 0.03],
        x: ["-100%", "100%"]
      }}
      transition={{
        duration: 2.5,
        repeat: Infinity,
        ease: "linear"
      }}
      className="absolute inset-0 bg-gradient-to-r from-transparent via-[var(--accent-mint)]/10 to-transparent"
    />
    <div className="w-full h-full bg-white/[0.03]" />
  </div>
);

const SkeletonPulse = Skeleton;

export const CardSkeleton = () => (
  <div className="p-6 rounded-[2rem] bg-white/[0.01] border border-white/5 space-y-4">
    <SkeletonPulse className="h-6 w-32 rounded-lg" />
    <div className="space-y-2">
      <SkeletonPulse className="h-4 w-full rounded-md" />
      <SkeletonPulse className="h-4 w-[85%] rounded-md" />
    </div>
    <div className="pt-4 flex justify-between">
      <SkeletonPulse className="h-8 w-24 rounded-xl" />
      <SkeletonPulse className="h-4 w-12 rounded-full mt-2" />
    </div>
  </div>
);

export const MarketplaceGridSkeleton = () => (
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
    {Array.from({ length: 8 }).map((_, i) => (
      <CardSkeleton key={i} />
    ))}
  </div>
);

export const TerminalSkeleton = () => (
  <div className="p-6 rounded-[2.5rem] bg-[#0A0A0A] border border-white/5 font-mono">
    <div className="flex items-center gap-2 mb-6 border-b border-white/5 pb-4">
      <div className="w-2 h-2 rounded-full bg-red-500/20" />
      <div className="w-2 h-2 rounded-full bg-yellow-500/20" />
      <div className="w-2 h-2 rounded-full bg-green-500/20" />
      <SkeletonPulse className="h-3 w-40 rounded-full ml-4" />
    </div>
    <div className="space-y-3">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="flex gap-4">
          <SkeletonPulse className="h-3 w-16 rounded opacity-20" />
          <SkeletonPulse className={`h-3 rounded ${i % 3 === 0 ? "w-[70%]" : "w-[40%]"}`} />
        </div>
      ))}
    </div>
  </div>
);

export const HUDSkeleton = () => (
  <div className="p-10 rounded-[2.5rem] bg-white/[0.01] border border-white/5 space-y-8">
    <div className="flex justify-between items-end">
      <div className="space-y-2">
        <SkeletonPulse className="h-4 w-20 rounded opacity-50" />
        <SkeletonPulse className="h-10 w-64 rounded-xl" />
      </div>
      <div className="flex gap-4">
        <div className="space-y-2">
          <SkeletonPulse className="h-3 w-12 rounded ml-auto" />
          <SkeletonPulse className="h-8 w-24 rounded-lg" />
        </div>
        <div className="space-y-2">
          <SkeletonPulse className="h-3 w-12 rounded ml-auto" />
          <SkeletonPulse className="h-8 w-24 rounded-lg" />
        </div>
      </div>
    </div>
    <div className="h-[1px] w-full bg-white/5" />
    <div className="grid grid-cols-3 gap-8">
       {Array.from({ length: 3 }).map((_, i) => (
         <div key={i} className="space-y-2">
           <SkeletonPulse className="h-3 w-16 rounded opacity-30" />
           <SkeletonPulse className="h-6 w-full rounded" />
         </div>
       ))}
    </div>
  </div>
);
export const ActivityFeedSkeleton = () => (
  <div className="space-y-4">
    <div className="flex items-center justify-between">
      <Skeleton className="h-4 w-32 rounded" />
      <Skeleton className="h-4 w-16 rounded-full" />
    </div>
    <div className="space-y-2">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="surface-card p-3 flex items-center gap-3">
          <Skeleton className="w-8 h-8 rounded-lg shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="flex justify-between items-center">
              <Skeleton className="h-3 w-32 rounded" />
              <Skeleton className="h-2 w-10 rounded" />
            </div>
            <Skeleton className="h-2 w-full rounded" />
          </div>
        </div>
      ))}
    </div>
  </div>
);

export const TopPerformersSkeleton = () => (
  <div className="space-y-4">
    <div className="flex items-center justify-between px-1">
      <Skeleton className="h-4 w-40 rounded" />
      <Skeleton className="h-3 w-20 rounded" />
    </div>
    <div className="grid grid-cols-1 gap-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="surface-card p-4 pl-5 space-y-4">
          <div className="flex justify-between items-start">
            <div className="space-y-2">
              <Skeleton className="h-2 w-24 rounded" />
              <Skeleton className="h-5 w-40 rounded" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-6 w-16 rounded ml-auto" />
              <Skeleton className="h-2 w-20 rounded ml-auto" />
            </div>
          </div>
          <div className="space-y-2">
            <Skeleton className="h-2 w-24 rounded" />
            <Skeleton className="h-1.5 w-full rounded-full" />
          </div>
        </div>
      ))}
    </div>
  </div>
);
