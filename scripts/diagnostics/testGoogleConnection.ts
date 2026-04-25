import { env } from "../src/config/env.js";
import { GoogleProvider } from "../src/lib/providers/concrete/google.js";

console.log("Testing Google API Connection...");

const provider = new GoogleProvider({
  name: "Google Test",
  type: "api",
  apiKey: env.GOOGLE_API_KEY || "",
  model: "gemini-2.0-flash"
});

async function runTest() {
  try {
    console.log("Sending prompt: 'Hello, are you there?'");
    const response = await provider.call({
      messages: [
        { role: "user", content: "Hello, are you there? Please respond with 'OK' if you can hear me." }
      ]
    });
    console.log("Response received:", response.text);
    if (response) {
      console.log("✅ Google API Connection Successful!");
    } else {
      console.log("❌ Response was empty.");
    }
  } catch (error) {
    console.error("❌ Connection failed:", error);
    if (error instanceof Error) {
      console.error("Error Message:", error.message);
    }
  }
}

runTest();
