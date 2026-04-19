import { useState, useEffect, useCallback } from "react";
import * as React from 'react';
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../context/AuthContext";
import { MarketplaceCard } from "../components/MarketplaceCard";
import { SectorHUD } from "../components/SectorHUD";
import { TechnicalGrid } from "../components/TechnicalGrid";
import { StatsHUD } from "../components/StatsHUD";
import { Store, Code2, Workflow, UserCircle, Wrench, Package } from "lucide-react";

// Subcomponents
import { MarketplaceFilterBar } from "../components/marketplace/MarketplaceFilterBar";
import { AssetPublishForm } from "../components/marketplace/AssetPublishForm";
import { AssetDetailModal } from "../components/marketplace/AssetDetailModal";
import { MarketplaceGridSkeleton } from "../components/LoadingSkeletons";

interface MarketplaceItem {
  id: string;
  type: string;
  name: string;
  description: string;
  content: any;
  authorId: string;
  authorName: string;
  tags: string[];
  stars: number;
  downloads: number;
  version: string;
  published: boolean;
  createdAt: string;
  reviews?: any[];
  starred?: boolean;
}

type ItemType = "prompt" | "workflow" | "persona" | "tool";
type SortMode = "stars" | "downloads" | "newest";

const TYPE_FILTERS: { value: ItemType | "all"; label: string; icon: React.ReactNode }[] = [
  { value: "all", label: "All", icon: <Package size={14} /> },
  { value: "prompt", label: "Prompts", icon: <Code2 size={14} /> },
  { value: "workflow", label: "Workflows", icon: <Workflow size={14} /> },
  { value: "persona", label: "Personas", icon: <UserCircle size={14} /> },
  { value: "tool", label: "Tools", icon: <Wrench size={14} /> },
];

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "stars", label: "Most Popular" },
  { value: "downloads", label: "Most Downloaded" },
  { value: "newest", label: "Newest" },
];

export function MarketplaceView() {
  const { fetchWithAuth } = useAuth();
  const [items, setItems] = useState<MarketplaceItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<ItemType | "all">("all");
  const [sort, setSort] = useState<SortMode>("stars");
  const [page, setPage] = useState(1);
  const [selectedItem, setSelectedItem] = useState<MarketplaceItem | null>(null);
  const [showPublish, setShowPublish] = useState(false);
  const [showSortDropdown, setShowSortDropdown] = useState(false);

  // Publish form state
  const [pubType, setPubType] = useState<ItemType>("prompt");
  const [pubName, setPubName] = useState("");
  const [pubDesc, setPubDesc] = useState("");
  const [pubTags, setPubTags] = useState("");
  const [pubContent, setPubContent] = useState("");
  const [publishing, setPublishing] = useState(false);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (typeFilter !== "all") params.set("type", typeFilter);
      params.set("sort", sort);
      params.set("page", String(page));
      params.set("limit", "24");
      if (search.trim()) params.set("search", search.trim());

      const res = await fetchWithAuth(`/api/marketplace?${params}`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items);
        setTotal(data.total);
      }
    } finally {
      // Add a slight delay for smoother transition out of skeleton
      setTimeout(() => setLoading(false), 400);
    }
  }, [fetchWithAuth, typeFilter, sort, page, search]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadItems(); }, [loadItems]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setPage(1); }, [typeFilter, sort, search]);

  const handleInstall = useCallback(async (id: string) => {
    const res = await fetchWithAuth(`/api/marketplace/${id}/install`, { method: "POST" });
    if (res.ok) {
      setItems((prev: MarketplaceItem[]) => prev.map((i: MarketplaceItem) => i.id === id ? { ...i, downloads: i.downloads + 1 } : i));
      if (selectedItem?.id === id) {
        setSelectedItem((prev: MarketplaceItem | null) => prev ? { ...prev, downloads: prev.downloads + 1 } : prev);
      }
      // Success feedback could be toast here
    }
  }, [fetchWithAuth, selectedItem]);

  const handleStar = useCallback(async (id: string) => {
    const res = await fetchWithAuth(`/api/marketplace/${id}/star`, { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      const delta = data.starred ? 1 : -1;
      setItems((prev: MarketplaceItem[]) => prev.map((i: MarketplaceItem) => i.id === id ? { ...i, stars: i.stars + delta } : i));
      if (selectedItem?.id === id) {
        setSelectedItem((prev: MarketplaceItem | null) => prev ? { ...prev, stars: prev.stars + delta, starred: data.starred } : prev);
      }
    }
  }, [fetchWithAuth, selectedItem]);

  const handleOpenDetail = useCallback(async (id: string) => {
    const res = await fetchWithAuth(`/api/marketplace/${id}`);
    if (res.ok) {
      const data = await res.json();
      setSelectedItem(data);
    }
  }, [fetchWithAuth]);

  const handlePublish = useCallback(async () => {
    if (!pubName.trim() || !pubDesc.trim() || !pubContent.trim()) return;
    setPublishing(true);
    try {
      let content: any;
      try { content = JSON.parse(pubContent); }
      catch { content = { text: pubContent }; }

      const res = await fetchWithAuth("/api/marketplace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: pubType,
          name: pubName.trim(),
          description: pubDesc.trim(),
          content,
          tags: pubTags.split(",").map((t) => t.trim()).filter(Boolean),
        }),
      });

      if (res.ok) {
        setPubName(""); setPubDesc(""); setPubTags(""); setPubContent("");
        setShowPublish(false);
        loadItems();
      }
    } finally {
      setPublishing(false);
    }
  }, [fetchWithAuth, pubType, pubName, pubDesc, pubTags, pubContent, loadItems]);

  const totalPages = Math.ceil(total / 24);

  return (
    <div className="relative min-h-screen bg-[#000000] overflow-hidden">
      <TechnicalGrid />
      
      <div className="relative z-10 h-full overflow-y-auto scrollbar-custom p-4 lg:p-8">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="max-w-7xl mx-auto space-y-12 pb-24"
        >
          <SectorHUD 
            sectorId="EXCH-07"
            title="Neural_Assets"
            subtitle="High-Fidelity Marketplace // Logical Blueprints"
            accentColor="var(--accent-mint)"
            telemetry={[
              { label: "MARKET_LOAD", value: "64%", status: "optimal" },
              { label: "ASSET_COUNT", value: total.toString(), status: "online" },
              { label: "UPLINK", value: "SECURE", status: "optimal" }
            ]}
          />

          <MarketplaceFilterBar 
            search={search} setSearch={setSearch}
            typeFilter={typeFilter} setTypeFilter={setTypeFilter}
            sort={sort} setSort={setSort}
            showPublish={showPublish} setShowPublish={setShowPublish}
            showSortDropdown={showSortDropdown} setShowSortDropdown={setShowSortDropdown}
            typeFilters={TYPE_FILTERS}
            sortOptions={SORT_OPTIONS}
          />

          <div className="space-y-8">
            <AnimatePresence>
              {showPublish && (
                <AssetPublishForm 
                  pubType={pubType} setPubType={setPubType}
                  pubName={pubName} setPubName={setPubName}
                  pubDesc={pubDesc} setPubDesc={setPubDesc}
                  pubTags={pubTags} setPubTags={setPubTags}
                  pubContent={pubContent} setPubContent={setPubContent}
                  publishing={publishing}
                  onPublish={handlePublish}
                  onCancel={() => setShowPublish(false)}
                />
              )}
            </AnimatePresence>

            <div>
              {loading ? (
                <MarketplaceGridSkeleton />
              ) : items.length === 0 ? (
                <div className="text-center py-20 bg-white/[0.01] rounded-[2.5rem] border border-dashed border-white/10">
                  <Store size={48} className="mx-auto mb-4 text-[var(--accent-mint)] opacity-20" />
                  <p className="text-[10px] font-black uppercase tracking-[0.4em] text-white/40">No Neural Assets Detected</p>
                  <p className="text-[9px] font-mono text-[var(--text-muted)] mt-2 opacity-50 uppercase tracking-widest">Redefine query parameters or check uplink</p>
                </div>
              ) : (
                <div className="space-y-12">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {items.map((item) => (
                      <MarketplaceCard key={item.id} item={item} onClick={handleOpenDetail} onInstall={handleInstall} />
                    ))}
                  </div>

                  {totalPages > 1 && (
                    <div className="flex items-center justify-center gap-8 py-10 border-t border-white/5">
                      <button
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page === 1}
                        className="px-6 py-2 text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)] hover:text-white transition-all disabled:opacity-10"
                      >
                        Prev_Sector
                      </button>
                      <div className="flex items-center gap-4">
                        <span className="text-[10px] font-mono text-[var(--accent-mint)] font-bold">{page.toString().padStart(2, '0')}</span>
                        <div className="w-16 h-[1px] bg-white/10" />
                        <span className="text-[10px] font-mono text-white/20">{totalPages.toString().padStart(2, '0')}</span>
                      </div>
                      <button
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        disabled={page === totalPages}
                        className="px-6 py-2 text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)] hover:text-white transition-all disabled:opacity-10"
                      >
                        Next_Sector
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </motion.div>

        <StatsHUD 
          stats={[
            { label: "MARKET_ASSETS", value: total, color: "var(--accent-mint)" },
            { label: "ASSET_CLASSES", value: TYPE_FILTERS.length - 1, color: "var(--accent-blue)" },
            { label: "SYNC_UPLINK", value: "SECURE", color: "var(--accent-mint)" }
          ]}
        />
      </div>

      <AssetDetailModal 
        item={selectedItem} 
        onClose={() => setSelectedItem(null)} 
        onStar={handleStar}
        onInstall={handleInstall}
      />
    </div>
  );
}
