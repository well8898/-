// 홈 화면 위젯: GET /?w=키 (vercel.json 이 이리로 보냄)  &fmt=text 줄글, &view=1 화면
const { widget, widgetByName, setAppUrl } = require('../lib/core.js');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    setAppUrl('https://' + req.headers.host + '/');
    const q = req.query || {};
    const fmt = q.view ? 'view' : q.fmt === 'text' ? 'text' : 'json';
    // 앱: /api/w?b=지사&n=이름  ·  예전 방식: /?w=키
    const out = q.b ? await widgetByName(String(q.b), String(q.n || ''), fmt) : await widget(String(q.w || ''), fmt);
    res.setHeader('Content-Type', out.type);
    res.status(200).send(out.body);
  } catch (e) {
    res.status(500).json({ ok: false, title: '서버 오류', text: e.message || String(e) });
  }
};
