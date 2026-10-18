// 화면 → 서버 함수 호출: POST /api/rpc  { fn: '함수 이름', args: [...] }  (회사 메일 인증 열쇠는 x-auth 헤더)
const { RPC, setAppUrl } = require('../lib/core.js');
const auth = require('../lib/auth.js');

const CTX_AT = { shareWeek: 4, restoreWeek: 2 };
const ALL = Object.assign({}, RPC, { authStart: auth.authStart, authVerify: auth.authVerify, authCheck: () => null });

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'POST만 돼요.' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const name = String(body.fn || '');
    const fn = Object.prototype.hasOwnProperty.call(ALL, name) ? ALL[name] : null;
    if (!fn) return res.status(404).json({ ok: false, message: '없는 기능: ' + name });
    if (!auth.OPEN.has(name) && !(await auth.checkToken(req.headers['x-auth'])))
      return res.status(401).json({ ok: false, needAuth: true, message: '회사 메일 인증이 필요해요.' });
    // 이 휴대폰의 열쇠가 아직 유효한가 (앱을 열 때 한 번)
    if (name === 'authCheck') return res.status(200).json({ ok: await auth.checkToken(req.headers['x-auth']), auth: auth.authOn() });
    setAppUrl('https://' + req.headers.host + '/');
    let args = Array.isArray(body.args) ? body.args : [];
    // 올리기·되돌리기: 누가 했는지(인증한 회사 메일)를 맨 뒤에 붙임
    if (CTX_AT[name] != null) {
      const who = await auth.whoIs(req.headers['x-auth']);
      args = args.slice(0, CTX_AT[name]);
      while (args.length < CTX_AT[name]) args.push(undefined);
      args.push({ email: who || '' });
    }
    let out = await fn(...args);
    if (name === 'getConfig' && out) out = Object.assign({}, out, { auth: auth.authOn(), authDomain: auth.DOMAIN() });
    res.status(200).json(out === undefined ? null : out);
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message || String(e) });
  }
};
