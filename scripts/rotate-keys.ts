import prisma from "../src/lib/db.js";
import { decryptConfig, encryptConfig } from "../src/lib/crypto.js";

async function rotateKeys() {
  console.log("Starting Config API Key Rotation...");
  
  try {
    const configs = await prisma.councilConfig.findMany();

    // Use a transaction to ensure all or nothing
    await prisma.$transaction(
      configs.map((config) => {
        // 1. Decrypt using whatever version the key is currently locked to internally
        const decrypted = decryptConfig(config.config);
        
        // 2. Re-encrypt using the CURRENT_ENCRYPTION_VERSION env variable
        const reEncrypted = encryptConfig(decrypted);
        
        return prisma.councilConfig.update({
          where: { id: config.id },
          data: { config: reEncrypted }
        });
      })
    );

    console.log(`✅ Successfully rotated API keys for ${configs.length} configurations.`);
    console.log(`Current Encryption Target Version: ${process.env.CURRENT_ENCRYPTION_VERSION || "1"}`);
  } catch (error) {
    console.error("❌ Key rotation failed:", error);
  } finally {
    await prisma.$disconnect();
  }
}

rotateKeys();
