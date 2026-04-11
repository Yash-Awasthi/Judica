import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import { MarketplaceCard } from "../components/MarketplaceCard";
import { Search, X, Star, ChevronDown, Plus } from "lucide-react";

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

const TYPE_FILTERS: { value: ItemType | "all"; label: string; icon: string }[] = [
  { value: "all", label: "All", icon: "apps" },
  { value: "prompt", label: "Prompts", icon: "edit_note" },
  { value: "workflow", label: "Workflows", icon: "account_tree" },
  { value: "persona", label: "Personas", icon: "person" },
  { value: "tool", label: "Tools", icon: "build" },
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

  // Reset page on filter/sort change
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
      try {
        content = JSON.parse(pubContent);
      } catch {
        content = { text: pubContent };
      }

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
        setPubName("");
        setPubDesc("");
        setPubTags("");
        setPubContent("");
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
    <div className="h-full flex flex-col bg-[#030303] overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-6 pt-6 pb-4 border-b border-white/[0.04]">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-text tracking-tight">Marketplace</h1>
            <p className="text-xs text-text-dim mt-0.5">Discover and share prompts, workflows, personas, and tools</p>
          </div>
          <button
            onClick={() => setShowPublish(!showPublish)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors"
          >
            <Plus size={16} />
            Publish
          </button>
        </div>

        {/* Search + Filters */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-dim" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search marketplace..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-white/[0.03] border border-white/[0.06] rounded-xl text-text placeholder:text-text-dim/50 focus:outline-none focus:border-accent/30"
            />
          </div>

          <div className="flex items-center gap-1.5">
            {TYPE_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setTypeFilter(f.value)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-all ${
                  typeFilter === f.value
                    ? "bg-accent/10 text-accent border border-accent/20"
                    : "text-text-dim hover:bg-white/[0.04] hover:text-text border border-transparent"
                }`}
              >
                <span className="material-symbols-outlined text-[14px]">{f.icon}</span>
                {f.label}
              </button>
            ))}
          </div>

          {/* Sort dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowSortDropdown(!showSortDropdown)}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-text-muted hover:text-text rounded-lg hover:bg-white/[0.04] transition-colors border border-white/[0.06]"
            >
              {SORT_OPTIONS.find((s) => s.value === sort)?.label}
              <ChevronDown size={12} />
            </button>
            {showSortDropdown && (
              <div className="absolute right-0 top-full mt-1 bg-[#0a0a0a] border border-white/[0.08] rounded-xl shadow-2xl z-50 py-1 min-w-[160px]">
                {SORT_OPTIONS.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => {
                      setSort(s.value);
                      setShowSortDropdown(false);
                    }}
                    className={`w-full text-left px-4 py-2 text-xs transition-colors ${
                      sort === s.value ? "text-accent bg-accent/5" : "text-text-muted hover:text-text hover:bg-white/[0.04]"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 overflow-y-auto">
        {/* Publish panel */}
        {showPublish && (
          <div className="mx-6 mt-4 p-5 bg-white/[0.02] border border-white/[0.06] rounded-2xl">
            <h2 className="text-sm font-semibold text-text mb-4">Publish to Marketplace</h2>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-[11px] font-medium text-text-dim mb-1.5 uppercase tracking-wider">Type</label>
                <select
                  value={pubType}
                  onChange={(e) => setPubType(e.target.value as ItemType)}
                  className="w-full px-3 py-2 text-sm bg-white/[0.03] border border-white/[0.06] rounded-lg text-text focus:outline-none focus:border-accent/30"
                >
                  <option value="prompt">Prompt</option>
                  <option value="workflow">Workflow</option>
                  <option value="persona">Persona</option>
                  <option value="tool">Tool</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-text-dim mb-1.5 uppercase tracking-wider">Name</label>
                <input
                  value={pubName}
                  onChange={(e) => setPubName(e.target.value)}
                  placeholder="My awesome prompt"
                  className="w-full px-3 py-2 text-sm bg-white/[0.03] border border-white/[0.06] rounded-lg text-text placeholder:text-text-dim/50 focus:outline-none focus:border-accent/30"
                />
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-[11px] font-medium text-text-dim mb-1.5 uppercase tracking-wider">Description</label>
              <input
                value={pubDesc}
                onChange={(e) => setPubDesc(e.target.value)}
                placeholder="What does this do?"
                className="w-full px-3 py-2 text-sm bg-white/[0.03] border border-white/[0.06] rounded-lg text-text placeholder:text-text-dim/50 focus:outline-none focus:border-accent/30"
              />
            </div>
            <div className="mb-4">
              <label className="block text-[11px] font-medium text-text-dim mb-1.5 uppercase tracking-wider">Tags (comma separated)</label>
              <input
                value={pubTags}
                onChange={(e) => setPubTags(e.target.value)}
                placeholder="ai, coding, writing"
                className="w-full px-3 py-2 text-sm bg-white/[0.03] border border-white/[0.06] rounded-lg text-text placeholder:text-text-dim/50 focus:outline-none focus:border-accent/30"
              />
            </div>
            <div className="mb-4">
              <label className="block text-[11px] font-medium text-text-dim mb-1.5 uppercase tracking-wider">Content (JSON or plain text)</label>
              <textarea
                value={pubContent}
                onChange={(e) => setPubContent(e.target.value)}
                rows={6}
                placeholder='{"systemPrompt": "You are a helpful assistant..."}'
                className="w-full px-3 py-2 text-sm bg-white/[0.03] border border-white/[0.06] rounded-lg text-text placeholder:text-text-dim/50 focus:outline-none focus:border-accent/30 font-mono resize-none"
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowPublish(false)}
                className="px-4 py-2 text-sm text-text-muted hover:text-text transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handlePublish}
                disabled={publishing || !pubName.trim() || !pubDesc.trim() || !pubContent.trim()}
                className="px-4 py-2 text-sm font-semibold rounded-xl bg-accent text-black hover:bg-accent/90 transition-colors disabled:opacity-40"
              >
                {publishing ? "Publishing..." : "Publish"}
              </button>
            </div>
          </div>
        )}

        {/* Grid */}
        <div className="p-6">
          {loading ? (
            <div className="text-center py-16 text-text-dim text-sm">Loading marketplace...</div>
          ) : items.length === 0 ? (
            <div className="text-center py-16">
              <span className="material-symbols-outlined text-[48px] text-text-dim/30 mb-3 block">storefront</span>
              <p className="text-text-muted text-sm">No items found</p>
              <p className="text-text-dim text-xs mt-1">Try a different search or filter</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {items.map((item) => (
                  <MarketplaceCard
                    key={item.id}
                    item={item}
                    onClick={handleOpenDetail}
                    onInstall={handleInstall}
                  />
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-6">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1.5 text-xs text-text-muted hover:text-text rounded-lg hover:bg-white/[0.04] disabled:opacity-30 transition-colors"
                  >
                    Previous
                  </button>
                  <span className="text-xs text-text-dim">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="px-3 py-1.5 text-xs text-text-muted hover:text-text rounded-lg hover:bg-white/[0.04] disabled:opacity-30 transition-colors"
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
      {selectedItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setSelectedItem(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-[#0a0a0a] border border-white/[0.08] rounded-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto shadow-2xl"
          >
            {/* Modal header */}
            <div className="p-6 border-b border-white/[0.04]">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-2 py-0.5 text-[10px] font-semibold uppercase rounded-md bg-accent/10 text-accent border border-accent/20">
                      {selectedItem.type}
                    </span>
                    <span className="text-[10px] text-text-dim">v{selectedItem.version}</span>
                  </div>
                  <h2 className="text-lg font-bold text-text">{selectedItem.name}</h2>
                  <p className="text-xs text-text-dim mt-1">by {selectedItem.authorName}</p>
                </div>
                <button
                  onClick={() => setSelectedItem(null)}
                  className="p-1 text-text-dim hover:text-text transition-colors"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Modal body */}
            <div className="p-6">
              <p className="text-sm text-text-muted leading-relaxed mb-4">{selectedItem.description}</p>

              {/* Stats + actions */}
              <div className="flex items-center gap-4 mb-6">
                <button
                  onClick={() => handleStar(selectedItem.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                    selectedItem.starred
                      ? "bg-amber-400/10 text-amber-400 border-amber-400/20"
                      : "bg-white/[0.03] text-text-muted border-white/[0.06] hover:text-amber-400"
                  }`}
                >
                  <Star size={13} className={selectedItem.starred ? "fill-amber-400" : ""} />
                  {selectedItem.stars}
                </button>
                <span className="text-xs text-text-dim">{selectedItem.downloads} downloads</span>
                <button
                  onClick={() => handleInstall(selectedItem.id)}
                  className="ml-auto px-4 py-2 text-sm font-semibold rounded-xl bg-accent text-black hover:bg-accent/90 transition-colors"
                >
                  Install
                </button>
              </div>

              {/* Tags */}
              {selectedItem.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-6">
                  {selectedItem.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-white/[0.04] border border-white/[0.06] text-text-dim"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* Content preview */}
              <div className="mb-6">
                <h3 className="text-xs font-semibold text-text-dim uppercase tracking-wider mb-2">Content Preview</h3>
                <pre className="p-4 bg-white/[0.02] border border-white/[0.06] rounded-xl text-xs text-text-muted font-mono overflow-x-auto max-h-48 whitespace-pre-wrap">
                  {typeof selectedItem.content === "string"
                    ? selectedItem.content
                    : JSON.stringify(selectedItem.content, null, 2)}
                </pre>
              </div>

              {/* Reviews */}
              <div>
                <h3 className="text-xs font-semibold text-text-dim uppercase tracking-wider mb-3">Reviews</h3>

                {/* Add review */}
                <div className="flex items-start gap-3 mb-4 p-3 bg-white/[0.02] border border-white/[0.06] rounded-xl">
                  <div className="flex gap-0.5">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        onClick={() => setReviewRating(n)}
                        className="p-0.5"
                      >
                        <Star
                          size={14}
                          className={n <= reviewRating ? "text-amber-400 fill-amber-400" : "text-text-dim/30"}
                        />
                      </button>
                    ))}
                  </div>
                  <input
                    value={reviewComment}
                    onChange={(e) => setReviewComment(e.target.value)}
                    placeholder="Write a review..."
                    className="flex-1 px-2 py-1 text-xs bg-transparent text-text placeholder:text-text-dim/50 focus:outline-none"
                  />
                  <button
                    onClick={handleAddReview}
                    className="px-3 py-1 text-[11px] font-semibold rounded-lg bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
                  >
                    Submit
                  </button>
                </div>

                {/* Review list */}
                {selectedItem.reviews && selectedItem.reviews.length > 0 ? (
                  <div className="space-y-2">
                    {selectedItem.reviews.map((review) => (
                      <div key={review.id} className="p-3 bg-white/[0.01] border border-white/[0.04] rounded-lg">
                        <div className="flex items-center gap-2 mb-1">
                          <div className="flex gap-0.5">
                            {[1, 2, 3, 4, 5].map((n) => (
                              <Star
                                key={n}
                                size={10}
                                className={n <= review.rating ? "text-amber-400 fill-amber-400" : "text-text-dim/20"}
                              />
                            ))}
                          </div>
                          <span className="text-[10px] text-text-dim">
                            {new Date(review.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                        {review.comment && (
                          <p className="text-xs text-text-muted">{review.comment}</p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-text-dim italic">No reviews yet</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
