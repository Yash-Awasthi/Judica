/**
 * Conversation Branches DB Schema — Phase 1.7
 *
 * Loom (MIT, socketteer/loom) models conversations as trees.
 * Each branch is a fork from a parent conversation at a specific message.
 * The branch itself becomes a new conversation — referenced by ID.
 */

import { pgTable, uuid, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const conversationBranches = pgTable(
  "ConversationBranch",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The conversation being branched from */
    parentConversationId: text("parentConversationId").notNull(),
    /** The chat/message ID at which the branch starts (Loom node concept) */
    branchPointMessageId: text("branchPointMessageId"),
    /** User-defined label for this branch */
    title: text("title"),
    createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("ConversationBranch_userId_parentConvId_idx").on(table.userId, table.parentConversationId),
  ],
);
