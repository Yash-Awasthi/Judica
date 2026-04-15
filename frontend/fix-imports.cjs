const fs = require('fs');

const files = [
  'src/views/MarketplaceView.tsx',
  'src/views/AnalyticsView.tsx',
  'src/components/StatsHUD.tsx',
  'src/components/Settings.tsx',
  'src/components/ProviderManager.tsx',
  'src/components/MessageList.tsx',
  'src/components/EnhancedSearch.tsx',
  'src/components/CostTracker.tsx',
  'src/components/CommandPalette.tsx',
  'src/components/AuditLogs.tsx'
];

files.forEach(f => {
  if (!fs.existsSync(f)) {
      console.log('Skipping', f);
      return;
  }
  let d = fs.readFileSync(f, 'utf8');
  // Handle `import React, { ... }`
  d = d.replace(/import React, \{([^}]+)\} from ["']react["'];?/g, "import * as React from 'react';\nimport {$1} from 'react';");
  // Handle `import React from "react"`
  d = d.replace(/import React from ["']react["'];?/g, "import * as React from 'react';");
  
  fs.writeFileSync(f, d);
  console.log('Fixed', f);
});
