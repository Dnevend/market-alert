#!/usr/bin/env node

// 测试不同的 Binance API 端点
const endpoints = [
  'https://api.binance.com',
  'https://api1.binance.com',
  'https://api2.binance.com',
  'https://api3.binance.com'
];

async function testEndpoint(endpoint) {
  const url = `${endpoint}/api/v3/klines?symbol=BTCUSDT&interval=5m&limit=2`;

  console.log(`\n🔍 Testing ${endpoint}...`);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; market-alert/1.0)'
      }
    });

    console.log(`   Status: ${response.status} ${response.statusText}`);

    if (response.ok) {
      const data = await response.json();
      console.log(`   ✅ Success! Received ${data.length} klines`);
      console.log(`   📊 Sample data:`, JSON.stringify(data[0]).slice(0, 100) + '...');
      return true;
    } else {
      console.log(`   ❌ Failed with status ${response.status}`);
      return false;
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('🚀 Testing Binance API endpoints...');

  const results = [];

  for (const endpoint of endpoints) {
    const success = await testEndpoint(endpoint);
    results.push({ endpoint, success });

    // 避免请求过于频繁
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('\n📋 Results Summary:');
  console.log('==================');

  const workingEndpoints = results.filter(r => r.success);
  const failedEndpoints = results.filter(r => !r.success);

  if (workingEndpoints.length > 0) {
    console.log('✅ Working endpoints:');
    workingEndpoints.forEach(r => console.log(`   - ${r.endpoint}`));
    console.log(`\n💡 Recommendation: Use ${workingEndpoints[0].endpoint} in your .dev.vars`);
  } else {
    console.log('❌ All endpoints failed. This might be a network restriction issue.');
    console.log('\n🔧 Alternative solutions:');
    console.log('   1. Use a CORS proxy service');
    console.log('   2. Deploy to a different environment');
    console.log('   3. Use a different data source');
  }
}

main().catch(console.error);