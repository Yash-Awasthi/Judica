import { motion } from "framer-motion";
import { Skeleton } from "./LoadingSkeletons";

interface ViewSkeletonProps {
  className?: string;
}

export function ViewSkeleton({ className = "" }: ViewSkeletonProps) {
  return (
    <div className={`p-6 lg:p-10 space-y-12 animate-pulse ${className} bg-black h-screen overflow-hidden`}>
      {/* SectorHUD Skeleton */}
      <div className="flex items-end justify-between border-b border-white/5 pb-8">
        <div className="space-y-4">
          <Skeleton className="h-4 w-24 rounded opacity-50" />
          <Skeleton className="h-12 w-80 rounded-xl" />
          <Skeleton className="h-4 w-96 rounded opacity-30" />
        </div>
        <div className="flex gap-6">
          {[1, 2, 3].map(i => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-16 rounded ml-auto opacity-20" />
              <Skeleton className="h-8 w-24 rounded-lg" />
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-12 gap-8">
        {/* Left Col Skeleton */}
        <div className="col-span-8 space-y-8">
          <Skeleton className="h-96 w-full rounded-[3.5rem] bg-white/[0.02]" />
          <div className="grid grid-cols-3 gap-6">
            <Skeleton className="h-48 rounded-[2rem] bg-white/[0.02]" />
            <Skeleton className="h-48 rounded-[2rem] bg-white/[0.02]" />
            <Skeleton className="h-48 rounded-[2rem] bg-white/[0.02]" />
          </div>
        </div>

        {/* Right Col Skeleton */}
        <div className="col-span-4 space-y-12">
          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <Skeleton className="h-3 w-32 rounded opacity-20" />
              <div className="h-[1px] flex-1 bg-white/5" />
            </div>
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-24 w-full rounded-[2rem] bg-white/[0.02]" />
              ))}
            </div>
          </div>
          
          <div className="space-y-4">
             <Skeleton className="h-4 w-40 rounded opacity-20" />
             <div className="grid grid-cols-2 gap-4">
               <Skeleton className="h-12 rounded-xl bg-white/[0.02]" />
               <Skeleton className="h-12 rounded-xl bg-white/[0.02]" />
               <Skeleton className="h-12 rounded-xl bg-white/[0.02]" />
               <Skeleton className="h-12 rounded-xl bg-white/[0.02]" />
             </div>
          </div>
        </div>
      </div>

      <motion.div 
        className="fixed bottom-10 right-10 w-16 h-16 rounded-full bg-[var(--accent-mint)] opacity-10 blur-xl"
        animate={{ scale: [1, 1.3, 1], opacity: [0.1, 0.2, 0.1] }}
        transition={{ repeat: Infinity, duration: 3 }}
      />
    </div>
  );
}
