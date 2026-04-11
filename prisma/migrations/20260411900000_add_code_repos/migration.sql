-- CreateTable
CREATE TABLE "CodeRepository" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "repoUrl" TEXT,
    "name" TEXT NOT NULL,
    "indexed" BOOLEAN NOT NULL DEFAULT false,
    "fileCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CodeRepository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodeFile" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "language" TEXT,
    "content" TEXT NOT NULL,
    "embedding" vector(1536) NOT NULL,

    CONSTRAINT "CodeFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CodeRepository_userId_idx" ON "CodeRepository"("userId");

-- CreateIndex
CREATE INDEX "CodeFile_repoId_idx" ON "CodeFile"("repoId");

-- AddForeignKey
ALTER TABLE "CodeFile" ADD CONSTRAINT "CodeFile_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "CodeRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
