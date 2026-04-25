CREATE TABLE "AdminAuditLog" (
	"id" serial PRIMARY KEY NOT NULL,
	"adminId" integer NOT NULL,
	"actionType" text NOT NULL,
	"resourceType" text NOT NULL,
	"resourceId" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'success' NOT NULL,
	"errorMessage" text,
	"ipAddress" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "SystemConfig" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description" text,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"updatedBy" integer,
	CONSTRAINT "SystemConfig_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "isActive" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_adminId_User_id_fk" FOREIGN KEY ("adminId") REFERENCES "public"."User"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SystemConfig" ADD CONSTRAINT "SystemConfig_updatedBy_User_id_fk" FOREIGN KEY ("updatedBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "AdminAuditLog_adminId_idx" ON "AdminAuditLog" USING btree ("adminId");--> statement-breakpoint
CREATE INDEX "AdminAuditLog_actionType_idx" ON "AdminAuditLog" USING btree ("actionType");--> statement-breakpoint
CREATE INDEX "AdminAuditLog_createdAt_idx" ON "AdminAuditLog" USING btree ("createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "SystemConfig_key_idx" ON "SystemConfig" USING btree ("key");