const https = require('https');
const http = require('http');
const PORT = process.env.PORT || 3000;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function post(hostname, path, body, extraHeaders={}) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname, path, method: 'POST', timeout: 8000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...extraHeaders }
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.write(data); req.end();
  });
}

function extractName(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const KEYS = ['accountName','ownerName','name','fullName','holderName',
    'creditAccountName','beneficiaryName','receiverName','customerName'];
  const q = [obj];
  while (q.length) {
    const n = q.shift();
    if (!n || typeof n !== 'object') continue;
    for (const k of Object.keys(n)) {
      if (KEYS.some(nk => k.toLowerCase() === nk.toLowerCase())) {
        const v = n[k];
        if (v && typeof v === 'string' && v.trim().length > 1 && !/^\d+$/.test(v.trim()))
          return v.trim().toUpperCase();
      }
      if (n[k] && typeof n[k] === 'object') q.push(n[k]);
    }
  }
  return null;
}

async function tryVietQR(bin, acc) {
  const d = await post('api.vietqr.io', '/v2/lookup', { bin, accountNumber: acc });
  const name = extractName(d);
  if (name && d?.code === '00') return { name, source: 'VietQR' };
  return null;
}

async function tryMBBank(bin, acc) {
  const d = await post('api.mbbank.com.vn',
    '/api/retail-web-internetbankingms/v2.0/transfer/inquiryAccountName',
    { creditAccount: acc, creditBankId: bin });
  const name = extractName(d);
  if (name) return { name, source: 'MBBank' };
  return null;
}

async function tryTPBank(bin, acc) {
  const d = await post('ebank.tpb.vn',
    '/retail-web-internetbankingms/v1.0/transfer/inquiryAccountName',
    { creditAccount: acc, creditBankId: bin });
  const name = extractName(d);
  if (name) return { name, source: 'TPBank' };
  return null;
}

async function tryVCB(bin, acc) {
  const d = await post('www.vietcombank.com.vn', '/api/bank/getAccountName',
    { accountNumber: acc, bankBin: bin });
  const name = extractName(d);
  if (name) return { name, source: 'VCB' };
  return null;
}

async function tryPayOS(bin, acc) {
  const d = await post('api.payos.vn', '/v2/byid/bank-account',
    { bin, accountNumber: acc });
  const name = extractName(d);
  if (name) return { name, source: 'PayOS' };
  return null;
}

async function lookup(bins, acc) {
  const fns = [tryVietQR, tryMBBank, tryTPBank, tryVCB, tryPayOS];
  return new Promise(resolve => {
    let done = false, rem = bins.length * fns.length;
    if (!rem) return resolve(null);
    for (const bin of bins) for (const fn of fns) {
      fn(bin, acc).then(r => {
        rem--;
        if (!done && r) { done = true; resolve(r); }
        else if (!rem && !done) resolve(null);
      });
    }
  });
}

http.createServer(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.url === '/' ) { res.writeHead(200); res.end('NAPAS Proxy OK'); return; }
  if (req.url === '/lookup' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { bins, accountNumber } = JSON.parse(body);
        const r = await lookup(bins, accountNumber);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r ? { found: true, accountName: r.name, source: r.source } : { found: false }));
      } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }
  res.writeHead(404); res.end();
}).listen(PORT, () => console.log('NAPAS Proxy :' + PORT));
