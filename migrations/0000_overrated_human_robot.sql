CREATE TABLE "DailyUsage" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"date" timestamp NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"tokens" integer DEFAULT 0 NOT NULL,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Evaluation" (
	"id" serial PRIMARY KEY NOT NULL,
	"sessionId" text NOT NULL,
	"conversationId" text NOT NULL,
	"userId" integer NOT NULL,
	"coherence" real DEFAULT 0 NOT NULL,
	"consensus" real DEFAULT 0 NOT NULL,
	"diversity" real DEFAULT 0 NOT NULL,
	"quality" real DEFAULT 0 NOT NULL,
	"efficiency" real DEFAULT 0 NOT NULL,
	"overallScore" real DEFAULT 0 NOT NULL,
	"recommendations" jsonb,
	"strengths" jsonb,
	"weaknesses" jsonb,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "UsageLog" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"conversationId" text,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"promptTokens" integer DEFAULT 0 NOT NULL,
	"completionTokens" integer DEFAULT 0 NOT NULL,
	"costUsd" real DEFAULT 0 NOT NULL,
	"latencyMs" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "UserArchetype" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"councilConfigId" integer,
	"archetypeId" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"thinkingStyle" text NOT NULL,
	"asks" text NOT NULL,
	"blindSpot" text NOT NULL,
	"systemPrompt" text NOT NULL,
	"tools" text[] DEFAULT '{}' NOT NULL,
	"icon" text,
	"colorBg" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "UserSettings" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "UserSettings_userId_unique" UNIQUE("userId")
);
--> statement-breakpoint
CREATE TABLE "User" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text,
	"username" text NOT NULL,
	"passwordHash" text NOT NULL,
	"customInstructions" text DEFAULT '' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	CONSTRAINT "User_email_unique" UNIQUE("email"),
	CONSTRAINT "User_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "AuditLog" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer,
	"conversationId" text,
	"modelName" text NOT NULL,
	"prompt" text NOT NULL,
	"response" text NOT NULL,
	"tokensIn" integer DEFAULT 0 NOT NULL,
	"tokensOut" integer DEFAULT 0 NOT NULL,
	"latencyMs" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Chat" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer,
	"question" text NOT NULL,
	"verdict" text NOT NULL,
	"opinions" jsonb NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"cacheHit" boolean DEFAULT false NOT NULL,
	"conversationId" text,
	"durationMs" integer,
	"tokensUsed" integer,
	"embedding" vector(1536)
);
--> statement-breakpoint
CREATE TABLE "ContextSummary" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversationId" text NOT NULL,
	"summary" text NOT NULL,
	"messageCount" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Conversation" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" integer,
	"title" text DEFAULT 'New Conversation' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL,
	"isPublic" boolean DEFAULT false NOT NULL,
	"sessionSummary" text
);
--> statement-breakpoint
CREATE TABLE "SemanticCache" (
	"id" serial PRIMARY KEY NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"keyHash" text NOT NULL,
	"opinions" jsonb NOT NULL,
	"prompt" text NOT NULL,
	"verdict" text NOT NULL,
	"embedding" vector(1536),
	CONSTRAINT "SemanticCache_keyHash_unique" UNIQUE("keyHash")
);
--> statement-breakpoint
CREATE TABLE "CouncilConfig" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"config" jsonb NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "CouncilConfig_userId_unique" UNIQUE("userId")
);
--> statement-breakpoint
CREATE TABLE "RefreshToken" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"tokenHash" text NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "RefreshToken_tokenHash_unique" UNIQUE("tokenHash")
);
--> statement-breakpoint
CREATE TABLE "RevokedToken" (
	"id" serial PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "RevokedToken_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "CustomPersona" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"name" text NOT NULL,
	"systemPrompt" text NOT NULL,
	"temperature" real DEFAULT 0.7 NOT NULL,
	"critiqueStyle" text,
	"domain" text,
	"aggressiveness" integer DEFAULT 5 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "CustomProvider" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"name" text NOT NULL,
	"baseUrl" text NOT NULL,
	"authType" text NOT NULL,
	"authKey" text NOT NULL,
	"authHeaderName" text,
	"capabilities" jsonb NOT NULL,
	"models" text[] NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "PromptDNA" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"name" text NOT NULL,
	"systemPrompt" text NOT NULL,
	"steeringRules" text NOT NULL,
	"consensusBias" text NOT NULL,
	"critiqueStyle" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "SharedFact" (
	"id" text PRIMARY KEY NOT NULL,
	"conversationId" text NOT NULL,
	"content" text NOT NULL,
	"sourceAgent" text NOT NULL,
	"type" text NOT NULL,
	"confidence" real NOT NULL,
	"confirmedBy" text[] NOT NULL,
	"disputedBy" text[] NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "KBDocument" (
	"id" text PRIMARY KEY NOT NULL,
	"kbId" text NOT NULL,
	"uploadId" text NOT NULL,
	"filename" text NOT NULL,
	"chunkCount" integer DEFAULT 0 NOT NULL,
	"indexed" boolean DEFAULT false NOT NULL,
	"indexedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "KnowledgeBase" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Upload" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"filename" text NOT NULL,
	"originalName" text NOT NULL,
	"mimeType" text NOT NULL,
	"sizeBytes" integer NOT NULL,
	"storagePath" text NOT NULL,
	"processed" boolean DEFAULT false NOT NULL,
	"extractedText" text,
	"metadata" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Memory" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"kbId" text,
	"content" text NOT NULL,
	"chunkIndex" integer DEFAULT 0 NOT NULL,
	"sourceName" text,
	"sourceUrl" text,
	"embedding" vector(1536) NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "MemoryBackend" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"type" text NOT NULL,
	"config" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "MemoryBackend_userId_unique" UNIQUE("userId")
);
--> statement-breakpoint
CREATE TABLE "Artifact" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"conversationId" text,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"content" text NOT NULL,
	"language" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ResearchJob" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"query" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"report" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "WorkflowRun" (
	"id" text PRIMARY KEY NOT NULL,
	"workflowId" text NOT NULL,
	"userId" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"inputs" jsonb NOT NULL,
	"outputs" jsonb,
	"error" text,
	"startedAt" timestamp DEFAULT now() NOT NULL,
	"endedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "Workflow" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"definition" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "PromptVersion" (
	"id" text PRIMARY KEY NOT NULL,
	"promptId" text NOT NULL,
	"versionNum" integer NOT NULL,
	"content" text NOT NULL,
	"model" text,
	"temperature" real,
	"notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Prompt" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "GroupMembership" (
	"userId" integer NOT NULL,
	"groupId" text NOT NULL,
	CONSTRAINT "GroupMembership_userId_groupId_pk" PRIMARY KEY("userId","groupId")
);
--> statement-breakpoint
CREATE TABLE "SharedConversation" (
	"id" text PRIMARY KEY NOT NULL,
	"conversationId" text NOT NULL,
	"ownerId" integer NOT NULL,
	"shareToken" text NOT NULL,
	"access" text DEFAULT 'read' NOT NULL,
	"expiresAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "SharedConversation_conversationId_unique" UNIQUE("conversationId"),
	CONSTRAINT "SharedConversation_shareToken_unique" UNIQUE("shareToken")
);
--> statement-breakpoint
CREATE TABLE "SharedPrompt" (
	"id" text PRIMARY KEY NOT NULL,
	"promptId" text NOT NULL,
	"ownerId" integer NOT NULL,
	"shareToken" text NOT NULL,
	"access" text DEFAULT 'read' NOT NULL,
	"expiresAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "SharedPrompt_promptId_unique" UNIQUE("promptId"),
	CONSTRAINT "SharedPrompt_shareToken_unique" UNIQUE("shareToken")
);
--> statement-breakpoint
CREATE TABLE "SharedWorkflow" (
	"id" text PRIMARY KEY NOT NULL,
	"workflowId" text NOT NULL,
	"ownerId" integer NOT NULL,
	"shareToken" text NOT NULL,
	"access" text DEFAULT 'read' NOT NULL,
	"expiresAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "SharedWorkflow_workflowId_unique" UNIQUE("workflowId"),
	CONSTRAINT "SharedWorkflow_shareToken_unique" UNIQUE("shareToken")
);
--> statement-breakpoint
CREATE TABLE "UserGroup" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "MarketplaceItem" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"content" jsonb NOT NULL,
	"authorId" integer NOT NULL,
	"authorName" text NOT NULL,
	"tags" text[] NOT NULL,
	"downloads" integer DEFAULT 0 NOT NULL,
	"stars" integer DEFAULT 0 NOT NULL,
	"version" text DEFAULT '1.0.0' NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "MarketplaceReview" (
	"id" text PRIMARY KEY NOT NULL,
	"itemId" text NOT NULL,
	"userId" integer NOT NULL,
	"rating" integer NOT NULL,
	"comment" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "MarketplaceStar" (
	"userId" integer NOT NULL,
	"itemId" text NOT NULL,
	CONSTRAINT "MarketplaceStar_userId_itemId_pk" PRIMARY KEY("userId","itemId")
);
--> statement-breakpoint
CREATE TABLE "UserSkill" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"code" text NOT NULL,
	"parameters" jsonb NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ModelReliability" (
	"model" text PRIMARY KEY NOT NULL,
	"totalResponses" integer DEFAULT 0 NOT NULL,
	"agreedWith" integer DEFAULT 0 NOT NULL,
	"contradicted" integer DEFAULT 0 NOT NULL,
	"toolErrors" integer DEFAULT 0 NOT NULL,
	"avgConfidence" real DEFAULT 0 NOT NULL,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Trace" (
	"id" text PRIMARY KEY NOT NULL,
	"conversationId" text,
	"workflowRunId" text,
	"userId" integer NOT NULL,
	"type" text NOT NULL,
	"steps" jsonb NOT NULL,
	"totalLatencyMs" integer NOT NULL,
	"totalTokens" integer NOT NULL,
	"totalCostUsd" real NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "CodeFile" (
	"id" text PRIMARY KEY NOT NULL,
	"repoId" text NOT NULL,
	"path" text NOT NULL,
	"language" text,
	"content" text NOT NULL,
	"embedding" vector(1536) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "CodeRepository" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"source" text NOT NULL,
	"repoUrl" text,
	"name" text NOT NULL,
	"indexed" boolean DEFAULT false NOT NULL,
	"fileCount" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "DailyUsage" ADD CONSTRAINT "DailyUsage_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "UsageLog" ADD CONSTRAINT "UsageLog_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "UserArchetype" ADD CONSTRAINT "UserArchetype_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_conversationId_Conversation_id_fk" FOREIGN KEY ("conversationId") REFERENCES "public"."Conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_conversationId_Conversation_id_fk" FOREIGN KEY ("conversationId") REFERENCES "public"."Conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ContextSummary" ADD CONSTRAINT "ContextSummary_conversationId_Conversation_id_fk" FOREIGN KEY ("conversationId") REFERENCES "public"."Conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CouncilConfig" ADD CONSTRAINT "CouncilConfig_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CustomPersona" ADD CONSTRAINT "CustomPersona_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CustomProvider" ADD CONSTRAINT "CustomProvider_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PromptDNA" ADD CONSTRAINT "PromptDNA_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "KBDocument" ADD CONSTRAINT "KBDocument_kbId_KnowledgeBase_id_fk" FOREIGN KEY ("kbId") REFERENCES "public"."KnowledgeBase"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "KBDocument" ADD CONSTRAINT "KBDocument_uploadId_Upload_id_fk" FOREIGN KEY ("uploadId") REFERENCES "public"."Upload"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "KnowledgeBase" ADD CONSTRAINT "KnowledgeBase_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_kbId_KnowledgeBase_id_fk" FOREIGN KEY ("kbId") REFERENCES "public"."KnowledgeBase"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MemoryBackend" ADD CONSTRAINT "MemoryBackend_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ResearchJob" ADD CONSTRAINT "ResearchJob_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_workflowId_Workflow_id_fk" FOREIGN KEY ("workflowId") REFERENCES "public"."Workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PromptVersion" ADD CONSTRAINT "PromptVersion_promptId_Prompt_id_fk" FOREIGN KEY ("promptId") REFERENCES "public"."Prompt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Prompt" ADD CONSTRAINT "Prompt_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "GroupMembership" ADD CONSTRAINT "GroupMembership_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "GroupMembership" ADD CONSTRAINT "GroupMembership_groupId_UserGroup_id_fk" FOREIGN KEY ("groupId") REFERENCES "public"."UserGroup"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SharedConversation" ADD CONSTRAINT "SharedConversation_ownerId_User_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SharedPrompt" ADD CONSTRAINT "SharedPrompt_ownerId_User_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SharedWorkflow" ADD CONSTRAINT "SharedWorkflow_ownerId_User_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MarketplaceItem" ADD CONSTRAINT "MarketplaceItem_authorId_User_id_fk" FOREIGN KEY ("authorId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MarketplaceReview" ADD CONSTRAINT "MarketplaceReview_itemId_MarketplaceItem_id_fk" FOREIGN KEY ("itemId") REFERENCES "public"."MarketplaceItem"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MarketplaceReview" ADD CONSTRAINT "MarketplaceReview_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MarketplaceStar" ADD CONSTRAINT "MarketplaceStar_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MarketplaceStar" ADD CONSTRAINT "MarketplaceStar_itemId_MarketplaceItem_id_fk" FOREIGN KEY ("itemId") REFERENCES "public"."MarketplaceItem"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "UserSkill" ADD CONSTRAINT "UserSkill_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CodeFile" ADD CONSTRAINT "CodeFile_repoId_CodeRepository_id_fk" FOREIGN KEY ("repoId") REFERENCES "public"."CodeRepository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CodeRepository" ADD CONSTRAINT "CodeRepository_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "DailyUsage_userId_date_key" ON "DailyUsage" USING btree ("userId","date");--> statement-breakpoint
CREATE INDEX "Evaluation_sessionId_idx" ON "Evaluation" USING btree ("sessionId");--> statement-breakpoint
CREATE INDEX "Evaluation_userId_timestamp_idx" ON "Evaluation" USING btree ("userId","timestamp");--> statement-breakpoint
CREATE INDEX "UsageLog_userId_createdAt_idx" ON "UsageLog" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX "UsageLog_provider_createdAt_idx" ON "UsageLog" USING btree ("provider","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "UserArchetype_userId_archetypeId_key" ON "UserArchetype" USING btree ("userId","archetypeId");--> statement-breakpoint
CREATE INDEX "AuditLog_conversationId_createdAt_idx" ON "AuditLog" USING btree ("conversationId","createdAt");--> statement-breakpoint
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX "Chat_userId_idx" ON "Chat" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "Chat_conversationId_createdAt_idx" ON "Chat" USING btree ("conversationId","createdAt");--> statement-breakpoint
CREATE INDEX "Chat_embedding_hnsw_idx" ON "Chat" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "ContextSummary_conversationId_createdAt_idx" ON "ContextSummary" USING btree ("conversationId","createdAt");--> statement-breakpoint
CREATE INDEX "Conversation_userId_idx" ON "Conversation" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "Conversation_userId_updatedAt_idx" ON "Conversation" USING btree ("userId","updatedAt");--> statement-breakpoint
CREATE INDEX "SemanticCache_embedding_hnsw_idx" ON "SemanticCache" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "CustomPersona_userId_idx" ON "CustomPersona" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "CustomProvider_userId_name_key" ON "CustomProvider" USING btree ("userId","name");--> statement-breakpoint
CREATE INDEX "PromptDNA_userId_idx" ON "PromptDNA" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "SharedFact_conversationId_idx" ON "SharedFact" USING btree ("conversationId");--> statement-breakpoint
CREATE INDEX "KBDocument_kbId_idx" ON "KBDocument" USING btree ("kbId");--> statement-breakpoint
CREATE INDEX "KBDocument_uploadId_idx" ON "KBDocument" USING btree ("uploadId");--> statement-breakpoint
CREATE UNIQUE INDEX "KnowledgeBase_userId_name_key" ON "KnowledgeBase" USING btree ("userId","name");--> statement-breakpoint
CREATE INDEX "Upload_userId_createdAt_idx" ON "Upload" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX "Memory_userId_kbId_idx" ON "Memory" USING btree ("userId","kbId");--> statement-breakpoint
CREATE INDEX "Memory_embedding_hnsw_idx" ON "Memory" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "Artifact_userId_createdAt_idx" ON "Artifact" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX "Artifact_conversationId_idx" ON "Artifact" USING btree ("conversationId");--> statement-breakpoint
CREATE INDEX "ResearchJob_userId_createdAt_idx" ON "ResearchJob" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX "WorkflowRun_workflowId_startedAt_idx" ON "WorkflowRun" USING btree ("workflowId","startedAt");--> statement-breakpoint
CREATE INDEX "WorkflowRun_userId_startedAt_idx" ON "WorkflowRun" USING btree ("userId","startedAt");--> statement-breakpoint
CREATE INDEX "Workflow_userId_createdAt_idx" ON "Workflow" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "PromptVersion_promptId_versionNum_key" ON "PromptVersion" USING btree ("promptId","versionNum");--> statement-breakpoint
CREATE INDEX "Prompt_userId_createdAt_idx" ON "Prompt" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX "MarketplaceItem_authorId_idx" ON "MarketplaceItem" USING btree ("authorId");--> statement-breakpoint
CREATE INDEX "MarketplaceItem_type_idx" ON "MarketplaceItem" USING btree ("type");--> statement-breakpoint
CREATE INDEX "MarketplaceReview_itemId_idx" ON "MarketplaceReview" USING btree ("itemId");--> statement-breakpoint
CREATE INDEX "UserSkill_userId_idx" ON "UserSkill" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "Trace_userId_createdAt_idx" ON "Trace" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX "Trace_conversationId_idx" ON "Trace" USING btree ("conversationId");--> statement-breakpoint
CREATE INDEX "Trace_type_idx" ON "Trace" USING btree ("type");--> statement-breakpoint
CREATE INDEX "CodeFile_repoId_idx" ON "CodeFile" USING btree ("repoId");--> statement-breakpoint
CREATE INDEX "CodeFile_embedding_hnsw_idx" ON "CodeFile" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "CodeRepository_userId_idx" ON "CodeRepository" USING btree ("userId");