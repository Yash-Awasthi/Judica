import { useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Card, CardContent } from "~/components/ui/card";
import {
  MessageSquare,
  Send,
  Paperclip,
  Plus,
  CheckCircle,
  Sparkles,
} from "lucide-react";

const mockConversations = [
  { id: "1", title: "Authentication Architecture", date: "2 hours ago", mode: "Auto", active: true },
  { id: "2", title: "Database Schema Review", date: "Yesterday", mode: "Socratic", active: false },
  { id: "3", title: "API Rate Limiting Strategy", date: "2 days ago", mode: "Red/Blue", active: false },
];

const mockMessages = [
  {
    id: "m1",
    role: "user" as const,
    content: "What's the best approach for implementing authentication?",
  },
  {
    id: "m2",
    role: "archetype" as const,
    name: "The Architect",
    color: "bg-blue-500/20 text-blue-400",
    badgeColor: "border-blue-500/30",
    icon: "🏗️",
    confidence: 0.94,
    content:
      "Authentication should be designed as a layered system. I recommend implementing OAuth 2.0 with PKCE flow as the primary mechanism, backed by a dedicated identity provider. The architecture should separate the authentication layer from authorization — use JWTs for stateless inter-service communication but maintain server-side sessions for browser clients. Key components: an auth gateway, token service, user store, and session manager. Consider implementing a middleware chain pattern where each request passes through authentication, rate limiting, and authorization checks in sequence.",
  },
  {
    id: "m3",
    role: "archetype" as const,
    name: "The Pragmatist",
    color: "bg-amber-500/20 text-amber-400",
    badgeColor: "border-amber-500/30",
    icon: "⚡",
    confidence: 0.91,
    content:
      "Start with a battle-tested library rather than rolling your own. For most projects, NextAuth.js (or Auth.js) or Passport.js will get you 80% of the way with minimal effort. Use bcrypt for password hashing, implement rate limiting on login endpoints from day one, and add MFA as an optional feature early — it's much harder to bolt on later. Store sessions in Redis for easy horizontal scaling. Ship the simple version first, then iterate based on actual security requirements.",
  },
  {
    id: "m4",
    role: "archetype" as const,
    name: "The Ethicist",
    color: "bg-purple-500/20 text-purple-400",
    badgeColor: "border-purple-500/30",
    icon: "⚖️",
    confidence: 0.87,
    content:
      "Authentication is a trust boundary — every design choice has privacy implications. Minimize data collection: don't require real names if usernames suffice. Implement right-to-deletion from the start (GDPR Article 17). Use HttpOnly, Secure, SameSite cookies — never store tokens in localStorage. Consider offering passwordless login (magic links, WebAuthn) to reduce credential theft risk. Audit login attempts and notify users of suspicious activity. Remember: authentication failures should be generic ('Invalid credentials') to prevent user enumeration.",
  },
  {
    id: "m5",
    role: "verdict" as const,
    content:
      "The council recommends a pragmatic, security-first approach to authentication:\n\n1. Use an established library (Auth.js/Passport.js) as the foundation rather than building from scratch\n2. Implement OAuth 2.0 with PKCE for third-party auth, with server-side sessions for browser clients\n3. Apply security best practices from day one: bcrypt hashing, rate limiting, HttpOnly cookies, generic error messages\n4. Design for privacy compliance early — minimize data collection, support right-to-deletion\n5. Plan for MFA and passwordless auth as near-term additions\n\nConfidence: High (91% average across archetypes)",
  },
];

export default function ChatDetailPage() {
  const [inputValue, setInputValue] = useState("");

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left panel: conversation list */}
      <div className="w-72 border-r border-border flex flex-col">
        <div className="p-3 border-b border-border">
          <Button variant="outline" size="sm" className="w-full gap-2">
            <Plus className="size-3.5" />
            New Deliberation
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {mockConversations.map((conv) => (
            <button
              key={conv.id}
              className={`w-full text-left px-3 py-3 border-b border-border/50 transition-colors ${
                conv.active ? "bg-muted" : "hover:bg-muted/50"
              }`}
            >
              <div className="flex items-center gap-2">
                <MessageSquare className="size-3.5 text-muted-foreground shrink-0" />
                <span className="text-sm font-medium truncate">{conv.title}</span>
              </div>
              <div className="flex items-center gap-2 mt-1 ml-5.5">
                <Badge variant="outline" className="text-[10px]">
                  {conv.mode}
                </Badge>
                <span className="text-xs text-muted-foreground">{conv.date}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="border-b border-border px-6 py-3 flex items-center gap-3">
          <h2 className="text-sm font-medium">Authentication Architecture</h2>
          <Badge variant="outline" className="text-[10px]">Auto</Badge>
          <span className="text-xs text-muted-foreground">3 archetypes summoned</span>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {mockMessages.map((msg) => {
            if (msg.role === "user") {
              return (
                <div key={msg.id} className="flex justify-end">
                  <div className="max-w-[70%] rounded-lg bg-primary px-4 py-2.5 text-primary-foreground text-sm">
                    {msg.content}
                  </div>
                </div>
              );
            }

            if (msg.role === "verdict") {
              return (
                <Card key={msg.id} className="border-primary/20 bg-primary/5">
                  <CardContent className="space-y-2">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="size-4 text-primary" />
                      <span className="text-sm font-semibold">Council Verdict</span>
                    </div>
                    <div className="text-sm whitespace-pre-line">{msg.content}</div>
                  </CardContent>
                </Card>
              );
            }

            return (
              <div key={msg.id} className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-base">{msg.icon}</span>
                  <Badge className={msg.color}>{msg.name}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {Math.round((msg.confidence ?? 0) * 100)}% confidence
                  </span>
                </div>
                <div className="ml-7 rounded-lg border border-border bg-card px-4 py-3 text-sm leading-relaxed">
                  {msg.content}
                </div>
              </div>
            );
          })}
        </div>

        {/* Bottom input */}
        <div className="border-t border-border p-4">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Sparkles className="size-3" />
              <span>Auto</span>
            </div>
            <Button variant="ghost" size="icon-sm" disabled>
              <Paperclip className="size-3.5 text-muted-foreground" />
            </Button>
            <Input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Ask the council..."
              className="flex-1"
            />
            <Button size="sm" disabled={!inputValue.trim()}>
              <Send className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
