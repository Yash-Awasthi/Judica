import { motion, AnimatePresence } from "framer-motion";
import { Search, ChevronDown, Activity, Plus } from "lucide-react";

interface FilterOption<T extends string = string> {
  value: T;
  label: string;
  icon: React.ReactNode;
}

interface SortOption<T extends string = string> {
  value: T;
  label: string;
}

interface MarketplaceFilterBarProps<F extends string = string, S extends string = string> {
  search: string;
  setSearch: (s: string) => void;
  typeFilter: F;
  setTypeFilter: (s: F) => void;
  sort: S;
  setSort: (s: S) => void;
  showPublish: boolean;
  setShowPublish: (s: boolean) => void;
  showSortDropdown: boolean;
  setShowSortDropdown: (s: boolean) => void;
  typeFilters: FilterOption<F>[];
  sortOptions: SortOption<S>[];
}

export function MarketplaceFilterBar<F extends string, S extends string>({
  search, setSearch,
  typeFilter, setTypeFilter,
  sort, setSort,
  showPublish, setShowPublish,
  showSortDropdown, setShowSortDropdown,
  typeFilters,
  sortOptions
}: MarketplaceFilterBarProps<F, S>) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative p-10 rounded-[2.5rem] bg-white/[0.01] border border-white/5 backdrop-blur-3xl overflow-hidden group shadow-2xl"
    >
      <div className="absolute top-0 right-0 w-[40%] h-[40%] bg-[var(--accent-mint)]/5 blur-[120px] pointer-events-none" />
      
      <div className="flex flex-wrap items-center gap-8 relative z-10">
        <div className="relative flex-1 min-w-[300px]">
          <Search size={18} className="absolute left-6 top-1/2 -translate-y-1/2 text-[var(--accent-mint)] opacity-30 group-focus-within:opacity-100 transition-opacity" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Query neural database..."
            className="w-full bg-black/40 border border-white/10 rounded-2xl pl-16 pr-6 py-4 text-xs font-diag uppercase tracking-wider text-white focus:outline-none focus:border-[var(--accent-mint)]/40 transition-all placeholder:text-white/10"
          />
        </div>

        <div className="flex items-center gap-3">
          {typeFilters.map((f) => (
            <button
              key={f.value}
              onClick={() => setTypeFilter(f.value)}
              className={`flex items-center gap-3 px-6 py-3 text-[10px] font-black uppercase tracking-widest rounded-xl border transition-all ${
                typeFilter === f.value
                  ? "bg-[var(--accent-mint)]/10 text-[var(--accent-mint)] border-[var(--accent-mint)]/30 shadow-[0_0_20px_rgba(110,231,183,0.1)]"
                  : "text-white/40 border-white/5 hover:bg-white/5"
              }`}
            >
              <span className={typeFilter === f.value ? "text-[var(--accent-mint)]" : "text-white/20"}>{f.icon}</span>
              {f.label}
            </button>
          ))}
        </div>

        <div className="h-10 w-px bg-white/5 mx-2" />

        <div className="relative">
          <button
            onClick={() => setShowSortDropdown(!showSortDropdown)}
            className="flex items-center gap-3 px-6 py-3 text-[10px] font-black uppercase tracking-widest text-white/60 hover:text-white rounded-xl border border-white/10 hover:bg-white/5 transition-all"
          >
            <Activity size={14} className="text-[var(--accent-mint)] opacity-40" />
            {sortOptions.find((s) => s.value === sort)?.label}
            <ChevronDown size={14} className="opacity-40" />
          </button>
          <AnimatePresence>
            {showSortDropdown && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowSortDropdown(false)} />
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 10 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="absolute right-0 top-full mt-4 p-2 rounded-2xl border border-white/10 backdrop-blur-3xl bg-black/90 shadow-2xl z-50 min-w-[200px]"
                >
                  {sortOptions.map((s) => (
                    <button
                      key={s.value}
                      onClick={() => { setSort(s.value); setShowSortDropdown(false); }}
                      className={`w-full text-left px-5 py-3 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${
                        sort === s.value ? "text-[var(--accent-mint)] bg-[var(--accent-mint)]/5" : "text-white/40 hover:text-white hover:bg-white/5"
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>

        <button
           onClick={() => setShowPublish(!showPublish)}
           className="h-12 px-8 rounded-xl bg-[var(--accent-mint)] text-black font-black uppercase tracking-[0.2em] text-[10px] shadow-[0_0_30px_rgba(110,231,183,0.2)] hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center gap-3"
         >
           <Plus size={16} />
           PUBLISH_ASSET
         </button>
      </div>
    </motion.div>
  );
}
