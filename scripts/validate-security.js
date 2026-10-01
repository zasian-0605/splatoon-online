const fs=require('fs');

function read(p){return fs.readFileSync(p,'utf8');}
function must(condition,message){if(!condition)throw new Error('[SECURITY VALIDATE] '+message);}

const server=read('server.js');
const index=read('index.html');
const pkg=read('package.json');

must(server.includes('const PUBLIC_FILES = new Set(['),'server.js: PUBLIC_FILES whitelist missing');
must(server.includes("const PUBLIC_THREE_FILE = 'node_modules/three/build/three.min.js';"),'server.js: three whitelist missing');
must(server.includes("if (!PUBLIC_FILES.has(relativeFile) && relativeFile !== PUBLIC_THREE_FILE)"),'server.js: static whitelist gate missing');
must(!server.includes("replace('</body>'"),'server.js: HTML runtime injection still present');
must(index.includes('<script src="/online.js"></script>'),'index.html: consolidated online.js missing');
must(index.includes('<script src="/ai.js"></script>'),'index.html: ai.js missing');
must(index.includes('<script src="/specials.js"></script>'),'index.html: specials.js missing');
must(index.includes('<script src="/runtime.js"></script>'),'index.html: runtime.js missing');
must(index.includes('<script src="/paint.js"></script>'),'index.html: paint.js missing');

for(const old of ['online-v93.js','online-v95.js','online-v96.js','canonical-runtime-v108.js','specials-v102.js','paint-sync-v110.js']){
  must(!index.includes(old),'index.html still references '+old);
  must(!server.includes("'"+old+"'"),'server.js still whitelists '+old);
  must(!fs.existsSync(old),old+' still exists');
}
must(!fs.existsSync('sitemap.xml'),'sitemap.xml still exists');
must(fs.existsSync('scripts/validate-html-js.js'),'scripts/validate-html-js.js missing');
must(pkg.includes('"validate": "node scripts/validate-html-js.js && node scripts/validate-security.js"'),'package.json validate path mismatch');

const readBody=server.slice(server.indexOf('async function readBody'),server.indexOf('function sessionForToken'));
must(readBody.includes('Buffer.isBuffer(chunk)'), 'readBody: byte-buffer accumulation missing');
must(readBody.includes('total > 64 * 1024'),'readBody: byte-size limit missing');

must(/const server = http\.createServer\(async \(req, res\) => \{\s*let p;\s*try\s*\{\s*p = decodeURIComponent/.test(server),
  'server.js: decodeURIComponent is not protected');
must(server.includes("return json(res, 400, { ok:false, error:'不正なURLです。' });"),'server.js: malformed URL 400 handler missing');
must(server.includes("process.on('uncaughtException'"),'server.js: uncaughtException handler missing');
must(server.includes("process.on('unhandledRejection'"),'server.js: unhandledRejection handler missing');

const resultIdx=server.indexOf("p === '/api/account/result'");
must(resultIdx>=0,'server.js: /api/account/result route missing for explicit 410 rejection');
const resultBlock=server.slice(resultIdx,server.indexOf("p === '/api/feedback'",resultIdx));
must(resultBlock.includes('json(res, 410, { ok:false'),'server.js: /api/account/result is not disabled');
must(server.includes('function finishServerMatch')||server.includes('finishServerMatch('),
  'server.js: finishServerMatch missing; result authority cannot be server-side');
must((server.match(/updateAccountResult\(/g)||[]).length>=2,
  'server.js: updateAccountResult does not appear to have a server-side caller');

for(const p of ['online.js','ai.js','specials.js','runtime.js','paint.js','about.html']){
  must(fs.existsSync(p),p+' missing');
}
console.log('Security/runtime consolidation validation passed.');
