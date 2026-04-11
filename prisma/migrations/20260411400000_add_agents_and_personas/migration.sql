-- CreateTable
CREATE TABLE "SharedFact" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sourceAgent" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "confirmedBy" TEXT[],
    "disputedBy" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SharedFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomPersona" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "critiqueStyle" TEXT,
    "domain" TEXT,
    "aggressiveness" INTEGER NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomPersona_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptDNA" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "steeringRules" TEXT NOT NULL,
    "consensusBias" TEXT NOT NULL,
    "critiqueStyle" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptDNA_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SharedFact_conversationId_idx" ON "SharedFact"("conversationId");

-- CreateIndex
CREATE INDEX "CustomPersona_userId_idx" ON "CustomPersona"("userId");

-- CreateIndex
CREATE INDEX "PromptDNA_userId_idx" ON "PromptDNA"("userId");

-- AddForeignKey
ALTER TABLE "CustomPersona" ADD CONSTRAINT "CustomPersona_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptDNA" ADD CONSTRAINT "PromptDNA_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
