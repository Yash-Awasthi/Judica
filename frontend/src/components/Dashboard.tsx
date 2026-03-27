
interface DashboardProps {
  onSelectTemplate: (summon: string) => void;
}

const templates = [
  {
    id: "debate",
    title: "Debate Council",
    subtitle: "Dialectic Analysis",
    description: "Members argue opposing sides. Features the Devil's Advocate, Conventionalist, and Pragmatist for rigorous stress testing.",
    icon: "balance",
    color: "from-teal-500/10 to-cyan-600/5",
    border: "border-teal-500/15",
    iconBg: "bg-teal-500/10 border-teal-500/20",
    iconColor: "text-teal-400",
    tags: ["Opposition", "Stress Test"],
    summon: "debate"
  },
  {
    id: "research",
    title: "Research Council",
    subtitle: "Knowledge Synthesis",
    description: "Multi-angle deep analysis. Features the Data Analyst, Critic, and Synthesizer for evidence-backed conclusions.",
    icon: "database",
    color: "from-blue-500/10 to-indigo-600/5",
    border: "border-blue-500/15",
    iconBg: "bg-blue-500/10 border-blue-500/20",
    iconColor: "text-blue-400",
    tags: ["Evidence", "Fact-Check"],
    summon: "research"
  },
  {
    id: "technical",
    title: "Technical Council",
    subtitle: "Engineering Audit",
    description: "Engineering & architecture decisions. Security, Performance, and DX experts provide comprehensive system assessment.",
    icon: "terminal",
    color: "from-violet-500/10 to-purple-600/5",
    border: "border-violet-500/15",
    iconBg: "bg-violet-500/10 border-violet-500/20",
    iconColor: "text-violet-400",
    tags: ["Infrastructure", "Security"],
    summon: "technical"
  },
  {
    id: "creative",
    title: "Creative Council",
    subtitle: "Ideation Hub",
    description: "Brainstorming & creative problem solving. Visionary, Minimalist, and Storyteller for unconventional breakthroughs.",
    icon: "auto_awesome",
    color: "from-amber-500/10 to-orange-600/5",
    border: "border-amber-500/15",
    iconBg: "bg-amber-500/10 border-amber-500/20",
    iconColor: "text-amber-400",
    tags: ["Narrative", "Aesthetics"],
    summon: "creative"
  }
];

const stats = [
  { label: "AI Models", value: "10+", icon: "hub" },
  { label: "Deliberation Rounds", value: "1–5", icon: "repeat" },
  { label: "Export Formats", value: "MD / JSON", icon: "download" },
];

export function Dashboard({ onSelectTemplate }: DashboardProps) {
  return (
    <div className="flex-1 min-h-screen relative flex flex-col items-center overflow-y-auto scrollbar-custom">

      {/* Content */}
      <div className="max-w-4xl w-full px-6 md:px-10 pt-20 pb-32 flex flex-col items-center relative z-10">

        {/* Hero Section */}
        <section className="text-center mb-16 animate-fade-in">
          {/* Overline badge */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-accent/5 border border-accent/15 mb-8">
            <span className="status-dot bg-accent text-accent animate-pulse" />
            <span className="text-[10px] font-black uppercase tracking-[0.25em] text-accent">
              Multi-Model Deliberation Engine
            </span>
          </div>

          <h1 className="text-5xl md:text-7xl font-black tracking-tight mb-4 leading-none">
            <span className="shimmer-text">AI COUNCIL</span>
          </h1>
          <h2 className="text-lg font-semibold tracking-tight text-text-muted mb-5">
            The Digital Magistrate
          </h2>
          <p className="text-text-dim max-w-md mx-auto text-sm leading-relaxed">
            Summon a council of diverse AI minds to deliberate on your question.
            Receive a synthesized multi-perspective verdict in seconds.
          </p>

          {/* Quick stats row */}
          <div className="flex items-center justify-center gap-6 mt-8">
            {stats.map(({ label, value, icon }) => (
              <div key={label} className="flex items-center gap-2 text-text-muted">
                <span className="material-symbols-outlined text-accent/60 text-base">{icon}</span>
                <span className="text-xs font-bold">{value}</span>
                <span className="text-xs text-text-dim hidden sm:inline">{label}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Council type grid */}
        <section className="w-full mb-8">
          <div className="text-[10px] font-black uppercase tracking-[0.2em] text-text-dim mb-4 px-1">
            Summon a Council
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {templates.map((template, i) => (
              <button
                key={template.id}
                onClick={() => onSelectTemplate(template.summon)}
                className={`
                  group relative flex flex-col items-start p-5 rounded-2xl text-left overflow-hidden
                  bg-gradient-to-br ${template.color}
                  border ${template.border}
                  hover:brightness-125 transition-all duration-300
                  animate-slide-up
                `}
                style={{ animationDelay: `${i * 80}ms` }}
              >
                {/* Top row */}
                <div className="flex items-center gap-3 mb-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${template.iconBg}`}>
                    <span
                      className={`material-symbols-outlined ${template.iconColor}`}
                      style={{ fontSize: '20px' }}
                    >
                      {template.icon}
                    </span>
                  </div>
                  <div>
                    <h3 className="font-bold text-text tracking-tight text-sm">{template.title}</h3>
                    <p className={`text-[9px] ${template.iconColor} uppercase font-black tracking-[0.2em]`}>
                      {template.subtitle}
                    </p>
                  </div>
                </div>

                {/* Description */}
                <p className="text-xs text-text-muted leading-relaxed mb-4">
                  {template.description}
                </p>

                {/* Tags + Arrow */}
                <div className="flex items-center justify-between w-full">
                  <div className="flex gap-1.5">
                    {template.tags.map(tag => (
                      <span
                        key={tag}
                        className="px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.05] text-[9px] text-text-dim font-bold uppercase tracking-wider"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                  <span
                    className={`material-symbols-outlined text-sm opacity-0 group-hover:opacity-100 transition-all duration-200 group-hover:translate-x-0.5 ${template.iconColor}`}
                  >
                    arrow_forward
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* Custom prompt hint */}
        <div className="glass-panel rounded-2xl px-6 py-4 w-full text-center animate-fade-in" style={{ animationDelay: '400ms' }}>
          <p className="text-xs text-text-muted">
            Or start a{" "}
            <button
              onClick={() => onSelectTemplate("default")}
              className="text-accent hover:text-accent-2 transition-colors font-bold underline underline-offset-2 decoration-accent/30"
            >
              General Council
            </button>
            {" "}— freely configure your own council members and custom personas.
          </p>
        </div>
      </div>

      {/* Background decorative elements */}
      <div className="fixed inset-0 pointer-events-none -z-10 bg-black overflow-hidden">
        <div className="absolute top-[-15%] left-[10%] w-[700px] h-[700px] bg-accent/3 blur-[150px] rounded-full animate-glow-pulse" />
        <div className="absolute bottom-[-10%] right-[5%] w-[500px] h-[500px] bg-accent-3/4 blur-[120px] rounded-full animate-glow-pulse" style={{ animationDelay: '2s' }} />
      </div>
    </div>
  );
}
