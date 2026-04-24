import { eq } from "drizzle-orm";
import { db } from "../src/lib/drizzle.js";
import { councilConfigs } from "../src/db/schema/auth.js";
import { decrypt, encrypt } from "../src/lib/crypto.js";
import { pool } from "../src/lib/db.js";

async function rotateKeys() {
  console.log("Starting Config API Key Rotation...");

  try {
    const configs = await db.select().from(councilConfigs);

    // Use a transaction to ensure all or nothing
    await db.transaction(async (tx) => {
      for (const config of configs) {
        // 1. Decrypt using whatever version the key is currently locked to internally
        const decrypted = decrypt(config.config);

        // 2. Re-encrypt using the CURRENT_ENCRYPTION_VERSION env variable
        const reEncrypted = encrypt(decrypted);

        await tx
          .update(councilConfigs)
          .set({ config: reEncrypted })
          .where(eq(councilConfigs.id, config.id));
      }
    });

    console.log(`Successfully rotated API keys for ${configs.length} configurations.`);
    console.log(`Current Encryption Target Version: ${process.env.CURRENT_ENCRYPTION_VERSION || "1"}`);
  } catch (error) {
    console.error("Key rotation failed:", error);
  } finally {
    await pool.end();
  }
}

rotateKeys();
