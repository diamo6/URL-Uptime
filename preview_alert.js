// Preview: Exactly what the Teams card will look like
// This shows the card JSON and the rendered message text

// ===================== EXAMPLE 1: SITE GOES DOWN =====================
console.log('='.repeat(70));
console.log('EXAMPLE 1: 🔴 Site DOWN Alert');
console.log('='.repeat(70));

const cardDown = {
  type: 'AdaptiveCard',
  version: '1.6',
  $schema: 'https://adaptivecards.io/schemas/adaptive-card.json',
  body: [
    {
      type: 'TextBlock',
      text: '🔴 DOWN — Website Uptime Monitor',
      size: 'large',
      weight: 'bolder',
      color: 'danger',
      wrap: true,
    },
    {
      type: 'ColumnSet',
      columns: [
        {
          type: 'Column',
          width: 'auto',
          items: [
            { type: 'TextBlock', text: 'Status: DOWN', color: 'danger', weight: 'bolder', wrap: true },
          ],
        },
      ],
    },
    {
      type: 'TextBlock',
      text: `🔴 **DOWN** — **Example Site** (https://example.com)

• HTTP status: 503
• Error: Service Unavailable
• Response time: 250 ms
• Detected at: 2026-10-09T10:30:00Z

The website server is unreachable or returned a 5xx error.`,
      wrap: true,
    },
  ],
  actions: [],
};

console.log('\n--- Card JSON (will be stored in variable("Body") ---\n');
console.log(JSON.stringify(cardDown, null, 2));

console.log('\n--- Message Text (rendered in card body) ---\n');
console.log('🔴 DOWN — **Example Site** (https://example.com)\n');
console.log('• HTTP status: 503');
console.log('• Error: Service Unavailable');
console.log('• Response time: 250 ms');
console.log('• Detected at: 2026-10-09T10:30:00Z\n');
console.log('The website server is unreachable or returned a 5xx error.\n');

// ===================== EXAMPLE 2: SITE RECOVERS =====================
console.log('');
console.log('='.repeat(70));
console.log('EXAMPLE 2: 🟢 Site RECOVERY');
console.log('='.repeat(70));

const cardUp = {
  type: 'AdaptiveCard',
  version: '1.6',
  $schema: 'https://adaptivecards.io/schemas/adaptive-card.json',
  body: [
    {
      type: 'TextBlock',
      text: '🟢 Recovery — Website Uptime Monitor',
      size: 'large',
      weight: 'bolder',
      color: 'good',
      wrap: true,
    },
    {
      type: 'ColumnSet',
      columns: [
        {
          type: 'Column',
          width: 'auto',
          items: [
            { type: 'TextBlock', text: 'Status: UP', color: 'good', weight: 'bolder', wrap: true },
          ],
        },
      ],
    },
    {
      type: 'TextBlock',
      text: `✅ **RECOVERY** — **Example Site** (https://example.com) is back UP

• Previous state: **DOWN**
• Duration: 15m 30s
• HTTP status: 200
• Response time: 120 ms
• Resolved at: 2026-10-09T10:45:00Z`,
      wrap: true,
    },
  ],
  actions: [],
};

console.log('\n--- Card JSON ---\n');
console.log(JSON.stringify(cardUp, null, 2));

console.log('\n--- Message Text ---\n');
console.log('✅ **RECOVERY** — **Example Site** (https://example.com) is back UP\n');
console.log('• Previous state: **DOWN**');
console.log('• Duration: 15m 30s');
console.log('• HTTP status: 200');
console.log('• Response time: 120 ms');
console.log('• Resolved at: 2026-10-09T10:45:00Z\n');

// ===================== EXAMPLE 3: WARNING =====================
console.log('');
console.log('='.repeat(70));
console.log('EXAMPLE 3: 🟡 WARNING');
console.log('='.repeat(70));

const cardWarn = {
  type: 'AdaptiveCard',
  version: '1.6',
  $schema: 'https://adaptivecards.io/schemas/adaptive-card.json',
  body: [
    {
      type: 'TextBlock',
      text: '🟡 WARNING — Website Uptime Monitor',
      size: 'large',
      weight: 'bolder',
      color: 'warning',
      wrap: true,
    },
    {
      type: 'ColumnSet',
      columns: [
        {
          type: 'Column',
          width: 'auto',
          items: [
            { type: 'TextBlock', text: 'Status: WARNING', color: 'warning', weight: 'bolder', wrap: true },
          ],
        },
      ],
    },
    {
      type: 'TextBlock',
      text: `🟡 **WARNING** — **Example Site** (https://example.com)

• HTTP status: 404
• Error: Resource Not Found
• Response time: 180 ms
• Detected at: 2026-10-09T10:30:00Z

The website returned a 4xx error — resource issue, not necessarily server down.`,
      wrap: true,
    },
  ],
  actions: [],
};

console.log('\n--- Card JSON ---\n');
console.log(JSON.stringify(cardWarn, null, 2));

console.log('\n--- Message Text ---\n');
console.log('🟡 **WARNING** — **Example Site** (https://example.com)\n');
console.log('• HTTP status: 404');
console.log('• Error: Resource Not Found');
console.log('• Response time: 180 ms');
console.log('• Detected at: 2026-10-09T10:30:00Z\n');
console.log('The website returned a 4xx error — resource issue, not necessarily server down.\n');

console.log('='.repeat(70));
console.log('Card structure:');
console.log('  Title:  "🔴 DOWN — Website Uptime Monitor"  (colored, large, bolder)');
console.log('  Status: "Status: DOWN"  (in a column, colored)');
console.log('  Body:   The detailed message text');
console.log('='.repeat(70));
