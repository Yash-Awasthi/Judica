-- CreateTable
CREATE TABLE "SemanticCache" (
    "id" SERIAL NOT NULL,
    "keyHash" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "opinions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SemanticCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SemanticCache_keyHash_key" ON "SemanticCache"("keyHash");
