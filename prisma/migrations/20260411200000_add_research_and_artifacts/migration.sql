-- Tier 4: Research Jobs
CREATE TABLE "ResearchJob" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "query" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "steps" JSONB NOT NULL DEFAULT '[]',
    "report" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ResearchJob_userId_createdAt_idx" ON "ResearchJob"("userId", "createdAt");

ALTER TABLE "ResearchJob" ADD CONSTRAINT "ResearchJob_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tier 4: Artifacts
CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "conversationId" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "language" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Artifact_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Artifact_userId_createdAt_idx" ON "Artifact"("userId", "createdAt");
CREATE INDEX "Artifact_conversationId_idx" ON "Artifact"("conversationId");

ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
