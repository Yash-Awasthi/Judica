import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../context/AuthContext";
import { MarketplaceCard } from "../components/MarketplaceCard";
import { SkeletonLoader } from "../components/SkeletonLoader";
import { Search, X, Star, ChevronDown, Plus, Store, Code2, Workflow, UserCircle, Wrench, Package } from "lucide-react";

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
  reviews?: Review[];
  starred?: boolean;
}

interface Review {
  id: string;
  userId: string;
  rating: number;
  comment: string | null;
  createdAt: string;
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

  // Review form
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");

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
      setLoading(false);
    }
  }, [fetchWithAuth, typeFilter, sort, page, search]);

  useEffect(() => { loadItems(); }, [loadItems]);
  useEffect(() => { setPage(1); }, [typeFilter, sort, search]);

  const handleInstall = useCallback(async (id: string) => {
    const res = await fetchWithAuth(`/api/marketplace/${id}/install`, { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      setItems((prev) => prev.map((i) => i.id === id ? { ...i, downloads: i.downloads + 1 } : i));
      if (selectedItem?.id === id) {
        setSelectedItem((prev) => prev ? { ...prev, downloads: prev.downloads + 1 } : prev);
      }
      alert(`Installed "${data.name}" successfully!`);
    }
  }, [fetchWithAuth, selectedItem]);

  const handleStar = useCallback(async (id: string) => {
    const res = await fetchWithAuth(`/api/marketplace/${id}/star`, { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      const delta = data.starred ? 1 : -1;
      setItems((prev) => prev.map((i) => i.id === id ? { ...i, stars: i.stars + delta } : i));
      if (selectedItem?.id === id) {
        setSelectedItem((prev) => prev ? { ...prev, stars: prev.stars + delta, starred: data.starred } : prev);
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

  const handleAddReview = useCallback(async () => {
    if (!selectedItem) return;
    const res = await fetchWithAuth(`/api/marketplace/${selectedItem.id}/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating: reviewRating, comment: reviewComment || null }),
    });
    if (res.ok) {
      const review = await res.json();
      setSelectedItem((prev) =>
        prev ? { ...prev, reviews: [review, ...(prev.reviews || [])] } : prev
      );
      setReviewComment("");
      setReviewRating(5);
    }
  }, [fetchWithAuth, selectedItem, reviewRating, reviewComment]);

  const totalPages = Math.ceil(total / 24);

  return (
    <div className="h-full flex flex-col bg-[var(--bg)] overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-6 pt-6 pb-4 border-b border-[var(--border-subtle)] bg-[var(--bg-surface-1)]">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-[var(--text-primary)] tracking-tight">Marketplace</h1>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">Discover and share prompts, workflows, personas, and tools</p>
          </div>
          <button
            onClick={() => setShowPublish(!showPublish)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-button bg-[rgba(110,231,183,0.08)] text-[var(--accent-mint)] border border-[rgba(110,231,183,0.15)] hover:bg-[rgba(110,231,183,0.15)] transition-colors"
          >
            <Plus size={16} />
            Publish
          </button>
        </div>

        {/* Search + Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search marketplace..."
              className="input-base pl-9"
            />
          </div>

          <div className="flex items-center gap-1.5">
            {TYPE_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setTypeFilter(f.value)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-button transition-all ${
                  typeFilter === f.value
                    ? "bg-[rgba(110,231,183,0.08)] text-[var(--accent-mint)] border border-[rgba(110,231,183,0.15)]"
                    : "text-[var(--text-muted)] hover:bg-[var(--glass-bg-hover)] hover:text-[var(--text-primary)] border border-transparent"
                }`}
              >
                {f.icon}
                {f.label}
              </button>
            ))}
          </div>

          {/* Sort dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowSortDropdown(!showSortDropdown)}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-button hover:bg-[var(--glass-bg-hover)] transition-colors border border-[var(--glass-border)]"
            >
              {SORT_OPTIONS.find((s) => s.value === sort)?.label}
              <ChevronDown size={12} />
            </button>
            <AnimatePresence>
              {showSortDropdown && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowSortDropdown(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="absolute right-0 top-full mt-1 surface-card rounded-card shadow-2xl z-50 py-1 min-w-[160px]"
                  >
                    {SORT_OPTIONS.map((s) => (
                      <button
                        key={s.value}
                        onClick={() => { setSort(s.value); setShowSortDropdown(false); }}
                        className={`w-full text-left px-4 py-2 text-xs transition-colors ${
                          sort === s.value ? "text-[var(--accent-mint)] bg-[rgba(110,231,183,0.06)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--glass-bg-hover)]"
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
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 overflow-y-auto scrollbar-custom">
        {/* Publish panel */}
        <AnimatePresence>
          {showPublish && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="mx-6 mt-4 overflow-hidden"
            >
              <div className="surface-card p-5">
                <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4">Publish to Marketplace</h2>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-[10px] font-bold text-[var(--text-muted)] mb-1.5 uppercase tracking-widest">Type</label>
                    <select value={pubType} onChange={(e) => setPubType(e.target.value as ItemType)} className="input-base">
                      <option value="prompt">Prompt</option>
                      <option value="workflow">Workflow</option>
                      <option value="persona">Persona</option>
                      <option value="tool">Tool</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[var(--text-muted)] mb-1.5 uppercase tracking-widest">Name</label>
                    <input value={pubName} onChange={(e) => setPubName(e.target.value)} placeholder="My awesome prompt" className="input-base" />
                  </div>
                </div>
                <div className="mb-4">
                  <label className="block text-[10px] font-bold text-[var(--text-muted)] mb-1.5 uppercase tracking-widest">Description</label>
                  <input value={pubDesc} onChange={(e) => setPubDesc(e.target.value)} placeholder="What does this do?" className="input-base" />
                </div>
                <div className="mb-4">
                  <label className="block text-[10px] font-bold text-[var(--text-muted)] mb-1.5 uppercase tracking-widest">Tags (comma separated)</label>
                  <input value={pubTags} onChange={(e) => setPubTags(e.target.value)} placeholder="ai, coding, writing" className="input-base" />
                </div>
                <div className="mb-4">
                  <label className="block text-[10px] font-bold text-[var(--text-muted)] mb-1.5 uppercase tracking-widest">Content (JSON or text)</label>
                  <textarea
                    value={pubContent}
                    onChange={(e) => setPubContent(e.target.value)}
                    rows={5}
                    placeholder='{"systemPrompt": "You are a helpful assistant..."}'
                    className="input-base font-mono resize-none"
                  />
                </div>
                <div className="flex justify-end gap-3">
                  <button onClick={() => setShowPublish(false)} className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                    Cancel
                  </button>
                  <button
                    onClick={handlePublish}
                    disabled={publishing || !pubName.trim() || !pubDesc.trim() || !pubContent.trim()}
                    className="btn-pill-primary text-sm px-5 py-2 disabled:opacity-40"
                  >
                    {publishing ? "Publishing..." : "Publish"}
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Grid */}
        <div className="p-6">
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <SkeletonLoader key={i} variant="card" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-16">
              <Store size={48} className="mx-auto mb-3 text-[var(--text-muted)] opacity-30" />
              <p className="text-[var(--text-secondary)] text-sm">No items found</p>
              <p className="text-[var(--text-muted)] text-xs mt-1">Try a different search or filter</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {items.map((item) => (
                  <MarketplaceCard key={item.id} item={item} onClick={handleOpenDetail} onInstall={handleInstall} />
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-6">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-button hover:bg-[var(--glass-bg-hover)] disabled:opacity-30 transition-colors"
                  >
                    Previous
                  </button>
                  <span className="text-xs text-[var(--text-muted)] font-mono">
                    {page} / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-button hover:bg-[var(--glass-bg-hover)] disabled:opacity-30 transition-colors"
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Detail Modal */}
      <AnimatePresence>
        {selectedItem && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setSelectedItem(null)}
          >
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.97 }}
              onClick={(e) => e.stopPropagation()}
              className="surface-card w-full max-w-2xl max-h-[80vh] overflow-y-auto scrollbar-custom shadow-2xl rounded-modal border border-[var(--border-medium)]"
            >
              {/* Modal header */}
              <div className="p-6 border-b border-[var(--border-subtle)]">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-2 py-0.5 text-[10px] font-semibold uppercase rounded-pill bg-[rgba(110,231,183,0.08)] text-[var(--accent-mint)] border border-[rgba(110,231,183,0.15)]">
                        {selectedItem.type}
                      </span>
                      <span className="text-[10px] text-[var(--text-muted)]">v{selectedItem.version}</span>
                    </div>
                    <h2 className="text-lg font-bold text-[var(--text-primary)]">{selectedItem.name}</h2>
                    <p className="text-xs text-[var(--text-muted)] mt-1">by {selectedItem.authorName}</p>
                  </div>
                  <button
                    onClick={() => setSelectedItem(null)}
                    className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--glass-bg-hover)] rounded-lg transition-colors"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              {/* Modal body */}
              <div className="p-6">
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-4">{selectedItem.description}</p>

                {/* Stats + actions */}
                <div className="flex items-center gap-4 mb-6">
                  <button
                    onClick={() => handleStar(selectedItem.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-button border transition-colors ${
                      selectedItem.starred
                        ? "bg-[var(--accent-gold)]/10 text-[var(--accent-gold)] border-[var(--accent-gold)]/20"
                        : "bg-[var(--glass-bg)] text-[var(--text-muted)] border-[var(--glass-border)] hover:text-[var(--accent-gold)]"
                    }`}
                  >
                    <Star size={13} className={selectedItem.starred ? "fill-current" : ""} />
                    {selectedItem.stars}
                  </button>
                  <span className="text-xs text-[var(--text-muted)]">{selectedItem.downloads} downloads</span>
                  <button
                    onClick={() => handleInstall(selectedItem.id)}
                    className="ml-auto btn-pill-primary text-sm px-4 py-2"
                  >
                    Install
                  </button>
                </div>

                {/* Tags */}
                {selectedItem.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-6">
                    {selectedItem.tags.map((tag) => (
                      <span key={tag} className="px-2 py-0.5 text-[10px] font-medium rounded-pill bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--text-muted)]">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                {/* Content preview */}
                <div className="mb-6">
                  <h3 className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest mb-2">Content Preview</h3>
                  <pre className="p-4 bg-[var(--code-bg)] border border-[var(--code-border)] rounded-xl text-xs text-[var(--text-secondary)] font-mono overflow-x-auto max-h-48 whitespace-pre-wrap scrollbar-custom">
                    {typeof selectedItem.content === "string"
                      ? selectedItem.content
                      : JSON.stringify(selectedItem.content, null, 2)}
                  </pre>
                </div>

                {/* Reviews */}
                <div>
                  <h3 className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest mb-3">Reviews</h3>

                  {/* Add review */}
                  <div className="flex items-start gap-3 mb-4 p-3 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-card">
                    <div className="flex gap-0.5">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button key={n} onClick={() => setReviewRating(n)} className="p-0.5">
                          <Star size={14} className={n <= reviewRating ? "text-[var(--accent-gold)] fill-current" : "text-[var(--text-muted)] opacity-30"} />
                        </button>
                      ))}
                    </div>
                    <input
                      value={reviewComment}
                      onChange={(e) => setReviewComment(e.target.value)}
                      placeholder="Write a review..."
                      className="flex-1 px-2 py-1 text-xs bg-transparent text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
                    />
                    <button
                      onClick={handleAddReview}
                      className="px-3 py-1 text-[11px] font-semibold rounded-button bg-[rgba(110,231,183,0.08)] text-[var(--accent-mint)] hover:bg-[rgba(110,231,183,0.15)] transition-colors"
                    >
                      Submit
                    </button>
                  </div>

                  {/* Review list */}
                  {selectedItem.reviews && selectedItem.reviews.length > 0 ? (
                    <div className="space-y-2">
                      {selectedItem.reviews.map((review) => (
                        <div key={review.id} className="p-3 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-button">
                          <div className="flex items-center gap-2 mb-1">
                            <div className="flex gap-0.5">
                              {[1, 2, 3, 4, 5].map((n) => (
                                <Star key={n} size={10} className={n <= review.rating ? "text-[var(--accent-gold)] fill-current" : "text-[var(--text-muted)] opacity-20"} />
                              ))}
                            </div>
                            <span className="text-[10px] text-[var(--text-muted)]">
                              {new Date(review.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                          {review.comment && (
                            <p className="text-xs text-[var(--text-secondary)]">{review.comment}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-[var(--text-muted)] italic">No reviews yet</p>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
