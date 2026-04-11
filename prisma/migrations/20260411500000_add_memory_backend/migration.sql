-- AlterTable: add sessionSummary to Conversation
ALTER TABLE "Conversation" ADD COLUMN "sessionSummary" TEXT;

-- CreateTable: MemoryBackend
CREATE TABLE "MemoryBackend" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "config" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemoryBackend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MemoryBackend_userId_key" ON "MemoryBackend"("userId");

-- AddForeignKey
ALTER TABLE "MemoryBackend" ADD CONSTRAINT "MemoryBackend_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
