-- CreateTable
CREATE TABLE "Trace" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT,
    "workflowRunId" TEXT,
    "userId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "totalLatencyMs" INTEGER NOT NULL,
    "totalTokens" INTEGER NOT NULL,
    "totalCostUsd" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Trace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelReliability" (
    "model" TEXT NOT NULL,
    "totalResponses" INTEGER NOT NULL DEFAULT 0,
    "agreedWith" INTEGER NOT NULL DEFAULT 0,
    "contradicted" INTEGER NOT NULL DEFAULT 0,
    "toolErrors" INTEGER NOT NULL DEFAULT 0,
    "avgConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelReliability_pkey" PRIMARY KEY ("model")
);

-- CreateIndex
CREATE INDEX "Trace_userId_createdAt_idx" ON "Trace"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Trace_conversationId_idx" ON "Trace"("conversationId");

-- CreateIndex
CREATE INDEX "Trace_type_idx" ON "Trace"("type");
