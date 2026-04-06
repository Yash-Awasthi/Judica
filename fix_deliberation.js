const fs = require('fs');

let file = fs.readFileSync('src/lib/deliberationPhases.ts', 'utf8');

// The original gatherOpinions was likely catching errors and swallowing them, let's look at it
