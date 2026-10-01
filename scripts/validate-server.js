const http = require('http');
const { spawn } = require('child_process');

const PORT = 34567;
const base = 'http://127.0.0.1:' + PORT;

function request(pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(base + pathname, {
      method: options.method || 'GET',
      headers: options.headers || {},
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function main() {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let logs = '';
  child.stdout.on('data', b => { logs += b.toString(); });
  child.stderr.on('data', b => { logs += b.toString(); });

  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const health = await request('/health');
      if (health.status === 200) break;
    } catch (_) {}
    await new Promise(r => setTimeout(r, 100));
  }

  try {
    const tests = [
      ['/health', 200],
      ['/index.html', 200],
      ['/about.html', 200],
      ['/online.js', 200],
      ['/runtime.js', 200],
      ['/paint.js', 200],
      ['/server.js', 404],
      ['/package.json', 404],
      ['/data/accounts.json', 404],
      ['/sitemap.xml', 404],
      ['/%E0%A4%A', 400],
      ['/api/account/result', 410]
    ];

    for (const [pathname, expected] of tests) {
      const result = await request(pathname, pathname === '/api/account/result' ? { method:'POST', body:'{}', headers:{'Content-Type':'application/json'} } : {});
      if (result.status !== expected) {
        throw new Error(pathname + ': expected HTTP ' + expected + ', got ' + result.status);
      }
    }

    console.log('Server integration validation passed.');
  } finally {
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 1000).unref();
    if (child.exitCode !== null && child.exitCode !== 0) {
      throw new Error('server exited unexpectedly: ' + child.exitCode + '\n' + logs);
    }
  }
}

main().catch(err => {
  console.error(String(err && err.stack || err));
  process.exitCode = 1;
});
