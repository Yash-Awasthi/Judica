import { useState, useEffect } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import { 
  FolderPlus, Folder, Plus, Search, MoreVertical, 
  Trash2, Edit2, LayoutGrid, List as ListIcon,
  ChevronRight, Calendar, MessageCircle, Clock
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../context/AuthContext";
import type { Project, Conversation } from "../types";

interface OutletContextType {
  loadConversations: () => void;
  conversations: Conversation[];
}

export default function ProjectsView() {
  const { fetchWithAuth } = useAuth();
  const { conversations } = useOutletContext<OutletContextType>();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  
  // Form State
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDesc, setNewProjectDesc] = useState("");

  const loadProjects = async () => {
    setIsLoading(true);
    try {
      const res = await fetchWithAuth("/api/v1/projects");
      if (res.ok) {
        const data = await res.json();
        setProjects(data);
      }
    } catch (err) {
      console.error("Failed to load projects", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadProjects();
  }, [fetchWithAuth]);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetchWithAuth("/api/v1/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newProjectName,
          description: newProjectDesc,
        }),
      });
      if (res.ok) {
        setShowCreateModal(false);
        setNewProjectName("");
        setNewProjectDesc("");
        loadProjects();
      }
    } catch (err) {
      console.error("Failed to create project", err);
    }
  };

  const filteredProjects = projects.filter(p => 
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex-1 flex flex-col h-full bg-[var(--bg)] overflow-hidden">
      {/* Header HUD */}
      <header className="px-8 py-6 border-b border-white/5 bg-black/40 backdrop-blur-xl flex items-center justify-between z-10">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Folder className="text-[var(--accent-mint)]" size={20} />
            <h1 className="text-xl font-black text-white italic tracking-tight">Project_Archive</h1>
          </div>
          <p className="text-[10px] font-diag uppercase tracking-[0.3em] text-white/30 font-black">Intel_Organization_Sector</p>
        </div>

        <div className="flex items-center gap-4">
          <div className="relative group">
            <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-[var(--accent-mint)] transition-colors" />
            <input 
              type="text"
              placeholder="SEARCH_PROJECTS..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-white/[0.02] border border-white/5 rounded-2xl py-2.5 pl-11 pr-5 text-[10px] text-white font-diag tracking-widest focus:outline-none focus:border-[var(--accent-mint)]/30 min-w-[240px] transition-all"
            />
          </div>

          <div className="h-8 w-px bg-white/5 mx-2" />

          <div className="flex bg-white/[0.02] border border-white/5 rounded-xl p-1">
            <button 
              onClick={() => setViewMode("grid")}
              className={`p-2 rounded-lg transition-all ${viewMode === "grid" ? "bg-[var(--accent-mint)] text-black" : "text-white/20 hover:text-white"}`}
            >
              <LayoutGrid size={14} />
            </button>
            <button 
              onClick={() => setViewMode("list")}
              className={`p-2 rounded-lg transition-all ${viewMode === "list" ? "bg-[var(--accent-mint)] text-black" : "text-white/20 hover:text-white"}`}
            >
              <ListIcon size={14} />
            </button>
          </div>

          <button 
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-6 py-2.5 bg-[var(--accent-mint)] text-black rounded-xl font-black text-[10px] uppercase tracking-widest hover:shadow-[0_0_30px_rgba(110,231,183,0.3)] transition-all active:scale-95"
          >
            <Plus size={14} />
            Initialize_New
          </button>
        </div>
      </header>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-8 scrollbar-custom">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <motion.div 
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
              className="w-12 h-12 border-4 border-[var(--accent-mint)]/20 border-t-[var(--accent-mint)] rounded-full"
            />
            <span className="text-[10px] font-diag text-[var(--accent-mint)] uppercase tracking-[0.5em] animate-pulse">Synchronizing_Vaults...</span>
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center max-w-md mx-auto">
            <div className="w-20 h-20 rounded-3xl bg-white/[0.02] border border-white/5 flex items-center justify-center mb-6 text-white/10">
              <FolderPlus size={40} />
            </div>
            <h3 className="text-xl font-black text-white italic mb-2">No Projects Detected</h3>
            <p className="text-xs text-[var(--text-muted)] leading-relaxed mb-8">
              Your intelligence archive is currently decentralized. Create a project to categorize deliberations into operational sectors.
            </p>
            <button 
              onClick={() => setShowCreateModal(true)}
              className="px-8 py-3 bg-white/[0.04] border border-white/5 hover:border-[var(--accent-mint)]/30 rounded-2xl text-[10px] font-black text-white uppercase tracking-[0.2em] transition-all"
            >
              New_Operational_Project
            </button>
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredProjects.map(project => (
              <motion.div 
                key={project.id}
                layout
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                whileHover={{ y: -5 }}
                className="group bg-[var(--bg-surface-2)] border border-[var(--glass-border)] rounded-2xl p-6 hover:border-[var(--accent-mint)]/30 transition-all cursor-pointer relative overflow-hidden"
                onClick={() => navigate(`/projects/${project.id}`)}
              >
                <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                  <MoreVertical size={16} className="text-white/40" />
                </div>
                
                <div className="w-12 h-12 rounded-xl bg-[var(--accent-mint)]/10 border border-[var(--accent-mint)]/20 flex items-center justify-center mb-4 text-[var(--accent-mint)]">
                  <Folder size={24} />
                </div>

                <h3 className="text-base font-black text-white italic truncate mb-1 group-hover:text-[var(--accent-mint)] transition-colors">{project.name}</h3>
                <p className="text-xs text-[var(--text-muted)] line-clamp-2 mb-6 h-8 italic">"{project.description || "Sector data non-specific."}"</p>

                <div className="flex items-center justify-between pt-4 border-t border-white/5">
                  <div className="flex items-center gap-2">
                    <MessageCircle size={12} className="text-[var(--accent-mint)]" />
                    <span className="text-[10px] font-black text-white/60 tracking-tight">{project.conversationCount || 0} Traces</span>
                  </div>
                  <div className="flex items-center gap-2 opacity-40">
                    <Clock size={12} />
                    <span className="text-[8px] font-diag tracking-widest">{new Date(project.updatedAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredProjects.map(project => (
              <motion.div 
                key={project.id}
                layout
                className="group bg-white/[0.02] border border-white/5 rounded-2xl px-6 py-4 flex items-center justify-between hover:bg-white/[0.04] hover:border-[var(--accent-mint)]/30 transition-all cursor-pointer"
                onClick={() => navigate(`/projects/${project.id}`)}
              >
                <div className="flex items-center gap-4 flex-1">
                  <div className="w-10 h-10 rounded-xl bg-[var(--accent-mint)]/10 flex items-center justify-center text-[var(--accent-mint)]">
                    <Folder size={20} />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-white italic group-hover:text-[var(--accent-mint)] transition-colors">{project.name}</h3>
                    <p className="text-[10px] text-[var(--text-muted)] truncate max-w-md">{project.description}</p>
                  </div>
                </div>

                <div className="flex items-center gap-12 shrink-0">
                  <div className="flex flex-col items-end">
                    <span className="text-[7px] font-diag uppercase tracking-widest text-white/20 mb-1">Deliberations</span>
                    <span className="text-xs font-black text-white">{project.conversationCount || 0} Sessions</span>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-[7px] font-diag uppercase tracking-widest text-white/20 mb-1">Last Update</span>
                    <span className="text-xs font-black text-white">{new Date(project.updatedAt).toLocaleDateString()}</span>
                  </div>
                  <ChevronRight size={18} className="text-white/10 group-hover:text-[var(--accent-mint)] transition-colors" />
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Modal - Create Project */}
      <AnimatePresence>
        {showCreateModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
              onClick={() => setShowCreateModal(false)}
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative w-full max-w-lg bg-[var(--bg-surface-2)] border border-[var(--glass-border)] rounded-3xl overflow-hidden shadow-2xl"
            >
              <div className="p-8">
                <div className="flex items-center gap-4 mb-8">
                  <div className="w-12 h-12 rounded-2xl bg-[var(--accent-mint)] flex items-center justify-center text-black">
                    <FolderPlus size={24} />
                  </div>
                  <div>
                    <h2 className="text-2xl font-black text-white italic tracking-tight uppercase">Initialize_Project</h2>
                    <p className="text-[10px] font-diag uppercase tracking-[0.3em] text-[var(--accent-mint)] font-black">Secure_Sector_Creation</p>
                  </div>
                </div>

                <form onSubmit={handleCreateProject} className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em] ml-1">Project Name</label>
                    <input 
                      type="text"
                      required
                      placeholder="ENTER_SECTOR_IDENTIFIER..."
                      value={newProjectName}
                      onChange={(e) => setNewProjectName(e.target.value)}
                      className="w-full bg-white/[0.04] border border-white/10 rounded-2xl py-4 px-5 text-sm text-white focus:outline-none focus:border-[var(--accent-mint)]/30 transition-all italic font-bold"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em] ml-1">Project Description</label>
                    <textarea 
                      placeholder="DEFINE_OPERATIONAL_PARAMETERS..."
                      rows={4}
                      value={newProjectDesc}
                      onChange={(e) => setNewProjectDesc(e.target.value)}
                      className="w-full bg-white/[0.04] border border-white/10 rounded-2xl py-4 px-5 text-sm text-white focus:outline-none focus:border-[var(--accent-mint)]/30 transition-all italic font-medium resize-none"
                    />
                  </div>

                  <div className="flex gap-4 pt-4">
                    <button 
                      type="button"
                      onClick={() => setShowCreateModal(false)}
                      className="flex-1 py-4 px-6 border border-white/5 rounded-2xl text-[10px] font-black text-white/40 uppercase tracking-widest hover:bg-white/5 transition-all"
                    >
                      Cancel_OP
                    </button>
                    <button 
                      type="submit"
                      className="flex-3 py-4 px-6 bg-[var(--accent-mint)] text-black rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-[0_0_40px_rgba(110,231,183,0.2)] hover:shadow-[0_0_50px_rgba(110,231,183,0.4)] transition-all"
                    >
                      Establish_Project_Connection
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
