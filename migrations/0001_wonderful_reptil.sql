CREATE TABLE "Project" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text,
	"icon" text,
	"defaultCouncilComposition" jsonb,
	"defaultSystemPrompt" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL,
	"deletedAt" timestamp
);
--> statement-breakpoint
ALTER TABLE "Chat" ALTER COLUMN "embedding" SET DATA TYPE vector(1536);--> statement-breakpoint
ALTER TABLE "SemanticCache" ALTER COLUMN "embedding" SET DATA TYPE vector(1536);--> statement-breakpoint
ALTER TABLE "Conversation" ADD COLUMN "projectId" text;--> statement-breakpoint
ALTER TABLE "Conversation" ADD COLUMN "activeTab" text DEFAULT 'discussion' NOT NULL;--> statement-breakpoint
ALTER TABLE "Conversation" ADD COLUMN "summaryData" jsonb;--> statement-breakpoint
ALTER TABLE "Project" ADD CONSTRAINT "Project_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "Project_userId_idx" ON "Project" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "Project_userId_name_key" ON "Project" USING btree ("userId","name");--> statement-breakpoint
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_projectId_Project_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE set null ON UPDATE no action;