import fs from 'fs';

function replaceInFile(path, replacements) {
    try {
        let content = fs.readFileSync(path, 'utf8');
        for (let r of replacements) {
            content = content.replace(r.search, r.replace);
        }
        fs.writeFileSync(path, content);
    } catch(e) { console.error("Skip: ", path); }
}

replaceInFile('src/lib/crypto.ts', [
    { search: /throw new Error\("Decryption failed"\);/g, replace: 'throw new Error("Decryption failed", { cause: err });' },
    { search: /throw new Error\("Encryption failed"\);/g, replace: 'throw new Error("Encryption failed", { cause: err });' }
]);

replaceInFile('src/lib/metrics.ts', [
    { search: /throw new Error\("ML Consensus Engine Failure"\);/g, replace: 'throw new Error("ML Consensus Engine Failure", { cause: err });' }
]);

replaceInFile('src/lib/providers/concrete/rpa.ts', [
    { search: /reject\(new Error\(`RPA Agent Error: \${err\.message}`\)\);/g, replace: 'reject(new Error(`RPA Agent Error: ${err.message}`, { cause: err }));' },
    { search: /reject\(new Error\(`RPA Agent Error: \${err}`\)\);/g, replace: 'reject(new Error(`RPA Agent Error: ${err}`, { cause: err }));' }
]);

replaceInFile('src/lib/scoring.ts', [
    { search: /throw new Error\("ML Scoring Engine Failure"\);/g, replace: 'throw new Error("ML Scoring Engine Failure", { cause: err });' }
]);

replaceInFile('src/lib/strategies/anthropic.ts', [
    { search: /} catch \(e\) {}/g, replace: '} catch (e) { /* ignored */ }' }
]);

replaceInFile('src/lib/strategies/google.ts', [
    { search: /} catch \(e\) {}/g, replace: '} catch (e) { /* ignored */ }' }
]);

replaceInFile('src/lib/strategies/openai.ts', [
    { search: /} catch \(e\) {}/g, replace: '} catch (e) { /* ignored */ }' }
]);

replaceInFile('src/lib/tools/skillExecutor.ts', [
    { search: /throw new Error\(`Skill execution failed: \${err instanceof Error \? err\.message : String\(err\)}`\);/g, replace: 'throw new Error(`Skill execution failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });' }
]);

replaceInFile('src/middleware/limiter.ts', [
    { search: /\.catch\(\(\) => {}\);/g, replace: '.catch(() => { /* ignored */ });' }
]);

replaceInFile('src/routes/workflows.ts', [
    { search: /triggerWebhook\(workflow, execResult\);/g, replace: 'void triggerWebhook(workflow, execResult);' }
]);

replaceInFile('src/sandbox/jsSandbox.ts', [
    { search: /\.catch\(\(\) => {}\);/g, replace: '.catch(() => { /* ignored */ });' }
]);

replaceInFile('src/sandbox/pythonSandbox.ts', [
    { search: /\.catch\(\(\) => {}\);/g, replace: '.catch(() => { /* ignored */ });' }
]);

console.log("Lint fixes applied");
