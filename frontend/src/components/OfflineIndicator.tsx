import { useState, useEffect, useCallback } from "react";
import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "aibyai-offline";
const STORE_NAME = "conversations";
const DB_VERSION = 1;
const MAX_CACHED = 20;

interface CachedConversation {
  id: string;
  title: string;
  messages: Array<{ question: string; verdict: string; createdAt: string }>;
  cachedAt: number;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("cachedAt", "cachedAt");
        }
      },
    });
  }
  return dbPromise;
}

export async function cacheConversation(conversation: CachedConversation): Promise<void> {
  try {
    const db = await getDB();
    await db.put(STORE_NAME, { ...conversation, cachedAt: Date.now() });

    // Evict oldest entries beyond MAX_CACHED
    const all = await db.getAllFromIndex(STORE_NAME, "cachedAt");
    if (all.length > MAX_CACHED) {
      const toRemove = all.slice(0, all.length - MAX_CACHED);
      for (const item of toRemove) {
        await db.delete(STORE_NAME, item.id);
      }
    }
  } catch {
    // IndexedDB may be unavailable in some contexts
  }
}

export async function getCachedConversations(): Promise<CachedConversation[]> {
  try {
    const db = await getDB();
    const all = await db.getAllFromIndex(STORE_NAME, "cachedAt");
    return all.reverse(); // newest first
  } catch {
    return [];
  }
}

export async function getCachedConversation(id: string): Promise<CachedConversation | undefined> {
  try {
    const db = await getDB();
    return await db.get(STORE_NAME, id);
  } catch {
    return undefined;
  }
}

export function OfflineIndicator() {
  const [online, setOnline] = useState(navigator.onLine);
  const [cachedCount, setCachedCount] = useState(0);
  const [showCached, setShowCached] = useState(false);
  const [cached, setCached] = useState<CachedConversation[]>([]);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Count cached conversations
    getCachedConversations().then((convos) => {
      setCachedCount(convos.length);
      setCached(convos);
    });

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const toggleCached = useCallback(() => {
    setShowCached((prev) => !prev);
  }, []);

  if (online) return null;

  return (
    <>
      <div className="fixed top-0 left-0 right-0 z-[9999] bg-amber-600 text-white text-center py-1.5 text-xs font-semibold tracking-wide shadow-lg flex items-center justify-center gap-3">
        <span>Offline — cached responses only</span>
        {cachedCount > 0 && (
          <button
            onClick={toggleCached}
            className="px-2 py-0.5 bg-white/20 hover:bg-white/30 rounded text-[10px] uppercase tracking-wider transition-colors"
          >
            {showCached ? "Hide" : `${cachedCount} cached`}
          </button>
        )}
      </div>
      {showCached && cached.length > 0 && (
        <div className="fixed top-8 left-1/2 -translate-x-1/2 z-[9998] bg-gray-900 border border-white/10 rounded-xl shadow-2xl p-4 max-w-md w-full max-h-64 overflow-y-auto">
          <h3 className="text-xs font-bold text-white/70 uppercase tracking-wider mb-2">Cached Conversations</h3>
          {cached.map((c) => (
            <div
              key={c.id}
              className="py-2 border-b border-white/5 last:border-0"
            >
              <p className="text-sm text-white font-medium truncate">{c.title}</p>
              <p className="text-[10px] text-white/40 mt-0.5">
                {c.messages.length} messages — cached {new Date(c.cachedAt).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
