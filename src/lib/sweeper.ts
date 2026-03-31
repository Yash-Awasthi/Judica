import prisma from "./db.js";
import logger from "./logger.js";

export function startSweepers() {
  // Run every 6 hours
  const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

  const sweep = async () => {
    try {
      logger.info("Running automated database sweep...");

      // 1. Delete expired JWT blocklist entries
      const deletedTokens = await prisma.revokedToken.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      if (deletedTokens.count > 0) {
        logger.info({ count: deletedTokens.count }, "Swept expired revoked tokens");
      }

      // 2. Delete orphaned conversations (older than 24h, 0 chats)
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const orphans = await prisma.conversation.findMany({
        where: { createdAt: { lt: yesterday }, chats: { none: {} } },
        select: { id: true }
      });

      if (orphans.length > 0) {
        const ids = orphans.map((o: any) => o.id);
        const deletedConvos = await prisma.conversation.deleteMany({ where: { id: { in: ids } } });
        logger.info({ count: deletedConvos.count }, "Swept orphaned conversations");
      }

      // 3. Delete expired SemanticCache entries
      const deletedCache = await prisma.semanticCache.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      if (deletedCache.count > 0) {
        logger.info({ count: deletedCache.count }, "Swept expired semantic cache entries");
      }
    } catch (e: any) {
      logger.error({ error: e.message }, "Database sweeper job failed");
    }
  };

  // Run immediately on start, then every 6 hours
  void sweep();
  setInterval(sweep, REFRESH_INTERVAL_MS);
}
