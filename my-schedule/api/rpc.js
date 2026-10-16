// 화면 → 서버 함수 호출: POST /api/rpc  { fn: '함수 이름', args: [...] }
const { RPC, setAppUrl } = require('../lib/core.js');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'POST만 돼요.' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const fn = RPC[String(body.fn || '')];
    if (!fn || !Object.prototype.hasOwnProperty.call(RPC, body.fn)) return res.status(404).json({ ok: false, message: '없는 기능: ' + body.fn });
    setAppUrl('https://' + req.headers.host + '/');
    const out = await fn(...(Array.isArray(body.args) ? body.args : []));
    res.status(200).json(out === undefined ? null : out);
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message || String(e) });
  }
};
