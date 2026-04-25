-- Migration: collaborative AI rooms
CREATE TABLE "Room" (
  "id" text PRIMARY KEY NOT NULL,
  "hostUserId" integer NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "conversationId" text NOT NULL REFERENCES "Conversation"("id") ON DELETE CASCADE,
  "inviteCode" text NOT NULL UNIQUE,
  "name" text NOT NULL DEFAULT 'Untitled Room',
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "RoomParticipant" (
  "roomId" text NOT NULL REFERENCES "Room"("id") ON DELETE CASCADE,
  "userId" integer NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "joinedAt" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("roomId", "userId")
);

CREATE INDEX "Room_hostUserId_idx" ON "Room"("hostUserId");
CREATE INDEX "Room_inviteCode_idx" ON "Room"("inviteCode");
CREATE INDEX "RoomParticipant_userId_idx" ON "RoomParticipant"("userId");
