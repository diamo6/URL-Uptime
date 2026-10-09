// Test formats that match the actual flow behavior
// Flow stores HTTP body → variable('Body') → messageBody → Teams parse as AdaptiveCard
// Therefore, the root of the HTTP body MUST be { "type": "AdaptiveCard", ... }

const webhookUrl = 'https://default45be8033beb74d4bab77608ee11e64.49.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/24/workflows/9735e49817a546909578cf7c0787205b/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=p8DW1-bQSzFx2sm2gcD1qvMGS_sqClPmGwsqahl_McQ';

const siteName = 'test-site.com';
const status = 'DOWN';
const timestamp = new Date().toISOString();

async function testFormat(num, name, payload) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  FORMAT ${num}: ${name}`);
  console.log(`${'═'.repeat(70)}`);
  console.log('\nPayload (will be stored in variable("Body") → messageBody):\n');
  console.log(JSON.stringify(payload, null, 2));
  console.log('\n' + '─'.repeat(70));

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });

    const runId = res.headers.get('x-ms-workflow-run-id');
    console.log(`\nHTTP Status: ${res.status}`);
    console.log(`Flow Run ID: ${runId || 'N/A'}`);

    const contentType = res.headers.get('content-type');
    if (contentType) console.log(`Content-Type: ${contentType}`);

    const body = await res.text();
    if (body && body.trim()) {
      console.log(`Response: ${body}`);
    }

    const success = res.ok || res.status === 202;
    console.log(`\nResult: ${success ? '✅ Accepted by Flow' : '❌ Rejected'}`);
    console.log(`   Check Teams channel for card with "${name}" header`);

    return { num, name, success, runId };
  } catch (err) {
    console.log(`\nError: ${err.message}`);
    return { num, name, success: false, error: err.message };
  }
}

async function main() {
  console.log('\n' + '█'.repeat(70));
  console.log('  TESTING FORMATS MATCHING ACTUAL POWER AUTOMATE FLOW');
  console.log('  Flow: HTTP → variable("Body") → messageBody → Teams parse as AdaptiveCard');
  console.log('█'.repeat(70));

  // Format 1: Minimal Adaptive Card (must have type, body at minimum)
  const format1 = {
    type: 'AdaptiveCard',
    version: '1.6',
    body: [
      {
        type: 'TextBlock',
        text: `🚨 FORMAT 1: Minimal AdaptiveCard\nSite: ${siteName}\nStatus: ${status}`,
        wrap: true
      }
    ],
    actions: []
  };

  // Format 2: Full featured Adaptive Card with color and column layout
  const format2 = {
    type: 'AdaptiveCard',
    version: '1.6',
    $schema: 'https://adaptivecards.io/schemas/adaptive-card.json',
    body: [
      {
        type: 'TextBlock',
        text: `🚨 FORMAT 2: Full AdaptiveCard`,
        size: 'large',
        weight: 'bolder',
        color: 'danger',
        wrap: true
      },
      {
        type: 'ColumnSet',
        columns: [
          {
            type: 'Column',
            width: 'auto',
            items: [
              { type: 'TextBlock', text: 'Site:', weight: 'bold' }
            ]
          },
          {
            type: 'Column',
            width: 'stretch',
            items: [
              { type: 'TextBlock', text: siteName, wrap: true }
            ]
          }
        ]
      },
      {
        type: 'ColumnSet',
        columns: [
          {
            type: 'Column',
            width: 'auto',
            items: [
              { type: 'TextBlock', text: 'Status:', weight: 'bold' }
            ]
          },
          {
            type: 'Column',
            width: 'stretch',
            items: [
              { type: 'TextBlock', text: status, color: 'danger', weight: 'bolder', wrap: true }
            ]
          }
        ]
      },
      {
        type: 'TextBlock',
        text: `Time: ${timestamp}`,
        isSubtle: true,
        wrap: true
      },
      {
        type: 'TextBlock',
        text: `⚠️ Please check immediately.`,
        wrap: true
      }
    ],
    actions: []
  };

  // Format 3: AdaptiveCard with FactSet (cleaner for status updates)
  const format3 = {
    type: 'AdaptiveCard',
    version: '1.6',
    $schema: 'https://adaptivecards.io/schemas/adaptive-card.json',
    body: [
      {
        type: 'TextBlock',
        text: '🚨 FORMAT 3: FactSet Style',
        size: 'medium',
        weight: 'bolder',
        color: 'good',
        wrap: true
      },
      {
        type: 'FactSet',
        facts: [
          {
            title: '📍 Site',
            value: siteName
          },
          {
            title: '📊 Status',
            value: status
          },
          {
            title: '⏰ Time',
            value: timestamp
          }
        ]
      },
      {
        type: 'TextBlock',
        text: '⚠️ Please check immediately.',
        wrap: true
      }
    ],
    actions: []
  };

  // Format 4: Text-only in body (plain text — will fail card parsing)
  // This is what the current teams.js sends
  const format4 = {
    body: `🚨 FORMAT 4: Plain Text\n\nSite: ${siteName}\nStatus: ${status}\nTime: ${timestamp}`
  };

  const results = [];
  const tests = [
    { num: 1, name: 'Minimal AdaptiveCard', payload: format1 },
    { num: 2, name: 'Full AdaptiveCard', payload: format2 },
    { num: 3, name: 'FactSet AdaptiveCard', payload: format3 },
    { num: 4, name: 'Plain Text (will FAIL)', payload: format4 }
  ];

  for (let i = 0; i < tests.length; i++) {
    const result = await testFormat(tests[i].num, tests[i].name, tests[i].payload);
    results.push(result);

    if (i < tests.length - 1) {
      console.log(`\n⏱ Waiting 5 seconds...\n`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  // Summary
  console.log('\n' + '█'.repeat(70));
  console.log('  SUMMARY');
  console.log('█'.repeat(70));
  results.forEach(r => {
    const icon = r.success ? '✅' : '❌';
    console.log(`${icon} Format ${r.num}: ${r.name} — ${r.success ? 'ACCEPTED' : 'FAILED'}`);
    if (r.runId) console.log(`   Run ID: ${r.runId}`);
  });

  console.log('\n' + '─'.repeat(70));
  console.log('📋 CHECK YOUR TEAMS CHANNEL:');
  console.log('─'.repeat(70));
  console.log('Which format card appeared?');
  console.log('• If card appeared: The format works');
  console.log('• If "card couldn\'t be displayed": The format has wrong structure');
  console.log('• If nothing appeared: Flow rejected the format');
  console.log('');
}

main();
