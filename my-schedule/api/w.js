// 홈 화면 위젯: GET /?w=키 (vercel.json 이 이리로 보냄)  &fmt=text 줄글, &view=1 화면
const { widgetByName, setAppUrl } = require('../lib/core.js');
const auth = require('../lib/auth.js');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    setAppUrl('https://' + req.headers.host + '/');
    const q = req.query || {};
    const fmt = q.view ? 'view' : q.fmt === 'text' ? 'text' : 'json';
    // 이름으로 받는 위젯은 회사 메일 인증 열쇠(&t=)가 있어야 함 (예전 /?w=키 는 키 자체가 비밀이라 그대로)
    if (q.b && !(await auth.checkToken(q.t))) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(200).send(JSON.stringify({ ok: false, needAuth: true, title: '회사 메일 인증이 필요해요',
        text: '앱을 열어 회사 메일로 확인해 주세요. 그래도 이 글이 나오면 「최신 버전 확인」으로 앱을 업데이트해 주세요.', lines: [] }));
    }
    // 예전 방식(/?w=키)은 막음 — 키를 이름으로 계산할 수 있어 인증을 건너뛸 수 있음
    if (!q.b) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(200).send(JSON.stringify({ ok: false, title: '앱을 업데이트해 주세요',
        text: '「오늘 현장」 앱을 최신 버전으로 받은 뒤, 앱에서 지사와 이름을 다시 골라 주세요.', lines: [] }));
    }
    // 앱: /api/w?b=지사&n=이름
    const out = await widgetByName(String(q.b), String(q.n || ''), fmt);
    res.setHeader('Content-Type', out.type);
    res.status(200).send(out.body);
  } catch (e) {
    res.status(500).json({ ok: false, title: '서버 오류', text: e.message || String(e) });
  }
};
