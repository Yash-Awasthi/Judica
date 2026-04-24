const API_KEY = process.env.NVIDIA_API_KEY || "";

const COUNCIL = [
  { name: "Kimi K2.5",   model: "moonshotai/kimi-k2.5" },
  { name: "GLM-5",       model: "z-ai/glm5" },
  { name: "MiniMax M2.5",model: "minimaxai/minimax-m2.5" },
];

async function askModel(name: string, model: string, question: string) {
  const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: question }],
      max_tokens: 512,
    }),
  });
  const data = await res.json() as any;
  const raw = data.choices?.[0]?.message?.content ?? JSON.stringify(data);
  const answer = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  return { name, answer };
}

async function runCouncil(question: string) {
  console.log(`\n🏛️  Council question: "${question}"\n`);
  console.log("Asking all 3 models simultaneously...\n");

  const results = await Promise.all(
    COUNCIL.map(({ name, model }) => askModel(name, model, question))
  );

  results.forEach(({ name, answer }) => {
    console.log(`─── ${name} ───`);
    console.log(answer);
    console.log();
  });
}

const question = process.argv[2] || "What is the most important skill to learn in 2026?";
runCouncil(question);
