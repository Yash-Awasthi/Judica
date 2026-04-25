import {
  pgTable,
  serial,
  text,
  boolean,
  integer,
  timestamp,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { conversations } from "./conversations.js";

// ─── Room ────────────────────────────────────────────────────────────────────
// A collaborative AI session where multiple users can post messages and all
// see the AI responses in real-time. Different from conversation sharing
// (which is read-only). Any room participant can send messages.
export const rooms = pgTable(
  "Room",
  {
    id: text("id").primaryKey(),
    hostUserId: integer("hostUserId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    conversationId: text("conversationId")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    inviteCode: text("inviteCode").notNull().unique(),
    name: text("name").notNull().default("Untitled Room"),
    isActive: boolean("isActive").notNull().default(true),
    createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("Room_hostUserId_idx").on(table.hostUserId),
    index("Room_inviteCode_idx").on(table.inviteCode),
  ],
);

// ─── RoomParticipant ─────────────────────────────────────────────────────────
// Tracks who has joined a room. All participants can send messages.
export const roomParticipants = pgTable(
  "RoomParticipant",
  {
    roomId: text("roomId")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joinedAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.roomId, table.userId] }),
    index("RoomParticipant_userId_idx").on(table.userId),
  ],
);
