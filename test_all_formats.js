// Test 3 formats for Power Automate flow with clear numbering
// Format 1: Plain text in "body" field (for "Post message" action)
// Format 2: JSON Adaptive Card in "body" field (for "Post card" action)
// Format 3: Adaptive Card with @type wrapper (MessageCard format)

const webhookUrl = 'https://default45be8033beb74d4bab77608ee11e64.49.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/24/workflows/9735e49817a546909578cf7c0787205b/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=p8DW1-bQSzFx2sm2gcD1qvMGS_sqClPmGwsqahl_McQ';

// Common text content
const siteName = 'test-site.com';
const status = 'DOWN';
const timestamp = new Date().toISOString();

async function sendFormat(formatNum, payload) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`FORMAT ${formatNum}`);
  console.log(`${'='.repeat(70)}`);
  console.log('Payload:', JSON.stringify(payload, null, 2));
  console.log('');

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });

    const runId = res.headers.get('x-ms-workflow-run-id');
    console.log(`Status: ${res.status}`);
    console.log(`Run ID: ${runId || 'N/A'}`);

    const text = await res.text();
    if (text && text.length > 0 && text.length < 500) {
      console.log(`Response: ${text}`);
    }

    const success = res.ok || res.status === 202;
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`RESULT: ${success ? '✅ ACCEPTED (Flow ran)' : '❌ REJECTED'}`);
    console.log(`${'─'.repeat(70)}\n`);

    return { success, runId, status: res.status };
  } catch (err) {
    console.log(`Error: ${err.message}`);
    console.log(`${'─'.repeat(70)}
RESULT: ❌ ERROR
${'─'.repeat(70)}\n`);
    return { success: false, error: err.message };
  }
}

// ===================== FORMAT 1 =====================
// Plain text in "body" field
// Use with: "Post message in a chat or channel" action (Outlook/Teams connector)
// NOT compatible with "Post card" action (expects Adaptive Card)
const format1Payload = {
  body: `🚨 FORMAT 1: Plain Text Alert\n\nSite: ${siteName}\nStatus: ${status}\nTime: ${timestamp}\n\n⚠️ Please check immediately.`
};

// ===================== FORMAT 2 =====================
// Raw Adaptive Card JSON as root object
// Use with: "Post card in a chat or channel" action
// Must have "type": "AdaptiveCard" at root level
const format2Payload = {
  type: 'AdaptiveCard',
  version: '1.6',
  $schema: 'https://adaptivecards.io/schemas/adaptive-card.json',
  body: [
    {
      type: 'TextBlock',
      text: `🚨 FORMAT 2: Adaptive Card Alert`,
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
            {
              type: 'TextBlock',
              text: `Site: ${siteName}`,
              weight: 'bold'
            }
          ]
        },
        {
          type: 'Column',
          width: 'auto',
          items: [
            {
              type: 'TextBlock',
              text: `Status: ${status}`,
              color: 'danger',
              weight: 'bolder'
            }
          ]
        }
      ]
    },
    {
      type: 'TextBlock',
      text: `Time: ${timestamp}\n\n⚠️ Please check immediately.`,
      wrap: true
    }
  ],
  actions: []
};

// ===================== FORMAT 3 =====================
// JSON string of Adaptive Card inside "body" field
// Some Power Automate versions need the card serialized as string
const format3Payload = {
  body: JSON.stringify({
    type: 'AdaptiveCard',
    version: '1.6',
    $schema: 'https://adaptivecards.io/schemas/adaptive-card.json',
    body: [
      {
        type: 'TextBlock',
        text: `🚨 FORMAT 3: Card (Stringified)`,
        size: 'large',
        weight: 'bolder',
        color: 'good',
        wrap: true
      },
      {
        type: 'FactSet',
        facts: [
          { title: 'Site', value: siteName },
          { title: 'Status', value: status },
          { title: 'Time', value: timestamp }
        ]
      },
      {
        type: 'TextBlock',
        text: '⚠️ Please check immediately.',
        wrap: true
      }
    ],
    actions: [
      {
        type: 'Action.ShowCard',
        title: 'View Details',
        card: {
          type: 'AdaptiveCard',
          body: [
            {
              type: 'TextBlock',
              text: 'Full alert details would go here.',
              wrap: true
            }
          ]
        }
      }
    ]
  })
};

// ===================== RUN TESTS =====================
async function main() {
  console.log('\n' + '█'.repeat(70));
  console.log('  TESTING 3 FORMAT OPTIONS FOR POWER AUTOMATE FLOW');
  console.log('█'.repeat(70));
  console.log('\n⏱ Each test waits 10 seconds to allow flow completion\n');

  const results = [];

  // Test Format 1
  console.log('\n>>> STARTING FORMAT 1 (Plain Text Body)...\n');
  const r1 = await sendFormat(1, format1Payload);
  results.push({ num: 1, ...r1 });

  console.log('⏱ Waiting 10 seconds before next test...\n');
  await new Promise(r => setTimeout(r, 10000));

  // Test Format 2
  console.log('\n>>> STARTING FORMAT 2 (Raw Adaptive Card)...\n');
  const r2 = await sendFormat(2, format2Payload);
  results.push({ num: 2, ...r2 });

  console.log('⏱ Waiting 10 seconds before next test...\n');
  await new Promise(r => setTimeout(r, 10000));

  // Test Format 3
  console.log('\n>>> STARTING FORMAT 3 (Stringified Card)...\n');
  const r3 = await sendFormat(3, format3Payload);
  results.push({ num: 3, ...r3 });

  // ===================== SUMMARY =====================
  console.log('\n' + '█'.repeat(70));
  console.log('  RESULTS SUMMARY');
  console.log('█'.repeat(70));

  results.forEach(r => {
    const status = r.success ? '✅' : '❌';
    console.log(`\n${status} Format ${r.num}: ${r.success ? 'ACCEPTED' : 'FAILED'} (Status: ${r.status || 'N/A'})`);
    if (r.runId) console.log(`   Run ID: ${r.runId}`);
    if (r.error) console.log(`   Error: ${r.error}`);
  });

  console.log('\n' + '─'.repeat(70));
  console.log('📋 NEXT STEPS:');
  console.log('─'.repeat(70));
  console.log('1. Check your Teams channel — which format appeared?');
  console.log('2. If no card appeared, check Power Automate flow history for errors');
  console.log('3. The ACCEPTED format is the one that works with your flow');
  console.log('');
}

main();
