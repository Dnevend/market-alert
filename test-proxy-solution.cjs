#!/usr/bin/env node

// 测试代理解决方案
const testUrl = 'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=5m&limit=2';

const proxyConfigs = [
  { name: 'Direct', url: testUrl },
  { name: 'CORS Proxy IO', url: `https://corsproxy.io/?${encodeURIComponent(testUrl)}` },
  { name: 'AllOrigins', url: `https://api.allorigins.win/raw?url=${encodeURIComponent(testUrl)}` }
];

async function testProxy(config) {
  console.log(`\n🔍 Testing ${config.name}...`);
  console.log(`   URL: ${config.url.slice(0, 80)}${config.url.length > 80 ? '...' : ''}`);

  try {
    const response = await fetch(config.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; market-alert/1.0)'
      }
    });

    console.log(`   Status: ${response.status} ${response.statusText}`);

    if (response.ok) {
      const data = await response.json();

      // 对于代理响应，可能需要额外解析
      let klines;
      if (config.name.includes('CORS') || config.name.includes('AllOrigins')) {
        // 代理返回的是字符串，需要解析
        if (typeof data === 'string') {
          klines = JSON.parse(data);
        } else {
          klines = data;
        }
      } else {
        klines = data;
      }

      if (Array.isArray(klines)) {
        console.log(`   ✅ Success! Received ${klines.length} klines`);
        console.log(`   📊 Sample data:`, JSON.stringify(klines[0]).slice(0, 100) + '...');
        return { success: true, config: config.name, klines };
      } else {
        console.log(`   ❌ Invalid response format`);
        return { success: false, config: config.name, error: 'Invalid format' };
      }
    } else {
      console.log(`   ❌ Failed with status ${response.status}`);
      return { success: false, config: config.name, error: `HTTP ${response.status}` };
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    return { success: false, config: config.name, error: error.message };
  }
}

async function main() {
  console.log('🚀 Testing proxy solutions for Binance API...');

  const results = [];

  for (const config of proxyConfigs) {
    const result = await testProxy(config);
    results.push(result);

    // 避免请求过于频繁
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log('\n📋 Results Summary:');
  console.log('==================');

  const workingSolutions = results.filter(r => r.success);
  const failedSolutions = results.filter(r => !r.success);

  if (workingSolutions.length > 0) {
    console.log('✅ Working solutions:');
    workingSolutions.forEach(r => console.log(`   - ${r.config}`));

    // 推荐最佳解决方案
    const best = workingSolutions[0];
    console.log(`\n💡 Recommended solution: ${best.config}`);

    if (best.config.includes('CORS')) {
      console.log('\n🔧 Implementation: Update .dev.vars to use a proxy-friendly approach');
      console.log('   and modify the CCXT adapter to always use the proxy.');
    }
  } else {
    console.log('❌ All solutions failed. Network restrictions may be too strict.');
    console.log('\n🔧 Alternative approaches:');
    console.log('   1. Deploy to production Cloudflare Workers (different network policies)');
    console.log('   2. Use a different data source (CoinGecko, etc.)');
    console.log('   3. Set up a custom proxy server');
    console.log('   4. Use mock data for development');
  }
}

main().catch(console.error);