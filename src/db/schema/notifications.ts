/**
 * Notifications DB Schema — server-side notifications for deliberation events.
 */

import {
  pgTable,
  serial,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const notifications = pgTable(
  "Notification",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Notification type for filtering/grouping. */
    type: text("type", {
      enum: [
        "deliberation_update",
        "consensus_reached",
        "claim_challenged",
        "new_argument",
        "research_complete",
        "mention",
        "system",
        "release_note",
      ],
    }).notNull(),
    /** Short title. */
    title: text("title").notNull(),
    /** Full message body. */
    message: text("message").notNull(),
    /** Whether user has dismissed this notification. */
    dismissed: boolean("dismissed").default(false).notNull(),
    /** Whether user has read this notification. */
    read: boolean("read").default(false).notNull(),
    /** Optional link to navigate to. */
    actionUrl: text("actionUrl"),
    /** Extra metadata (deliberationId, messageId, etc.). */
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("Notification_userId_idx").on(table.userId),
    index("Notification_userId_dismissed_idx").on(table.userId, table.dismissed),
    index("Notification_type_idx").on(table.type),
  ],
);
