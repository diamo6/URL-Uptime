// Test more formats — flow parses @string(variables('Body')) as AdaptiveCard JSON
// The key insight: flow stores HTTP body → converts to string → parses as AdaptiveCard
// So the HTTP body MUST serialize to {"type":"AdaptiveCard",...}

const webhookUrl = 'https://default45be8033beb74d4bab77608ee11e64.49.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/24/workflows/9735e49817a546909578cf7c0787205b/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=p8DW1-bQSzFx2sm2gcD1qvMGS_sqClPmGwsqahl_McQ';

const siteName = 'test-site.com';
const status = 'DOWN';
const timestamp = new Date().toISOString();

async function testFormat(num, name, payload) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  FORMAT ${num}: ${name}`);
  console.log(`${'═'.repeat(70)}`);
  console.log('\nRaw JSON that will be stored in variable("Body"):\n');
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

    const body = await res.text();
    if (body && body.trim()) {
      console.log(`Response: ${body}`);
    }

    const success = res.ok || res.status === 202;
    console.log(`\nResult: ${success ? '✅ Accepted by Flow' : '❌ Rejected'}`);

    return { num, name, success, runId };
  } catch (err) {
    console.log(`Error: ${err.message}`);
    return { num, name, success: false, error: err.message };
  }
}

async function main() {
  console.log('\n' + '█'.repeat(70));
  console.log('  TEST — CARD COULD NOT BE DISPLAYED FIX');
  console.log('█'.repeat(70));

  // Format A: Simplest valid AdaptiveCard
  const formatA = {
    type: 'AdaptiveCard',
    version: '1.0',
    body: [
      {
        type: 'TextBlock',
        text: `FORMAT A: Minimal\n\nSite: ${siteName}\nStatus: ${status}`,
        wrap: true
      }
    ],
    actions: []
  };

  // Format B: With $schema and version 1.6
  const formatB = {
    type: 'AdaptiveCard',
    version: '1.6',
    $schema: 'https://adaptivecards.io/schemas/adaptive-card.json',
    body: [
      {
        type: 'TextBlock',
        text: `FORMAT B: With schema\n\nSite: ${siteName}\nStatus: ${status}\nTime: ${timestamp}`,
        wrap: true
      }
    ],
    actions: []
  };

  // Format C: Just type and body (no version, no schema)
  const formatC = {
    type: 'AdaptiveCard',
    body: [
      {
        type: 'TextBlock',
        text: `FORMAT C: Bare minimum\n\nSite: ${siteName}\nStatus: ${status}`,
        wrap: true
      }
    ]
  };

  // Format D: With color on TextBlock
  const formatD = {
    type: 'AdaptiveCard',
    version: '1.2',
    body: [
      {
        type: 'TextBlock',
        text: `FORMAT D: With color\n\nSite: ${siteName}`,
        color: 'Attention',
        wrap: true
      },
      {
        type: 'TextBlock',
        text: status,
        color: 'Warning',
        weight: 'Bolder',
        wrap: true
      }
    ],
    actions: []
  };

  // Format E: Plain text in string field named "card"
  const formatE = {
    card: `{"type":"AdaptiveCard","version":"1.2","body":[{"type":"TextBlock","text":"FORMAT E: Card field\\nSite: ${siteName}\\nStatus: ${status}","wrap":true}],"actions":[]}`
  };

  // Format F: Plain text only (not a card — should FAIL)
  const formatF = {
    message: `FORMAT F: Plain Text\nSite: ${siteName}\nStatus: ${status}`
  };

  const tests = [
    { num: 'A', name: 'Minimal AdaptiveCard (v1.0)', payload: formatA },
    { num: 'B', name: 'Full with schema (v1.6)', payload: formatB },
    { num: 'C', name: 'Bare minimum (no version)', payload: formatC },
    { num: 'D', name: 'With color fields', payload: formatD },
    { num: 'E', name: 'Card field (stringified JSON)', payload: formatE },
    { num: 'F', name: 'Plain text (expected to FAIL)', payload: formatF }
  ];

  const results = [];

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
  console.log('Which format still shows "card couldn\'t be displayed"?');
  console.log('');
}

main();
