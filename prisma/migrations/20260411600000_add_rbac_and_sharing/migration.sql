-- AlterTable: add email column to User
ALTER TABLE "User" ADD COLUMN "email" TEXT;
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- AlterTable: change default role from 'user' to 'member'
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'member';

-- CreateTable: UserGroup
CREATE TABLE "UserGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable: GroupMembership
CREATE TABLE "GroupMembership" (
    "userId" INTEGER NOT NULL,
    "groupId" TEXT NOT NULL,

    CONSTRAINT "GroupMembership_pkey" PRIMARY KEY ("userId","groupId")
);

-- CreateTable: SharedConversation
CREATE TABLE "SharedConversation" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "shareToken" TEXT NOT NULL,
    "access" TEXT NOT NULL DEFAULT 'read',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SharedConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable: SharedWorkflow
CREATE TABLE "SharedWorkflow" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "shareToken" TEXT NOT NULL,
    "access" TEXT NOT NULL DEFAULT 'read',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SharedWorkflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable: SharedPrompt
CREATE TABLE "SharedPrompt" (
    "id" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "shareToken" TEXT NOT NULL,
    "access" TEXT NOT NULL DEFAULT 'read',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SharedPrompt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SharedConversation_conversationId_key" ON "SharedConversation"("conversationId");
CREATE UNIQUE INDEX "SharedConversation_shareToken_key" ON "SharedConversation"("shareToken");

CREATE UNIQUE INDEX "SharedWorkflow_workflowId_key" ON "SharedWorkflow"("workflowId");
CREATE UNIQUE INDEX "SharedWorkflow_shareToken_key" ON "SharedWorkflow"("shareToken");

CREATE UNIQUE INDEX "SharedPrompt_promptId_key" ON "SharedPrompt"("promptId");
CREATE UNIQUE INDEX "SharedPrompt_shareToken_key" ON "SharedPrompt"("shareToken");

-- AddForeignKey
ALTER TABLE "GroupMembership" ADD CONSTRAINT "GroupMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GroupMembership" ADD CONSTRAINT "GroupMembership_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "UserGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
