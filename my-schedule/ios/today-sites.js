// 오늘 현장 위젯 — 아이폰 Scriptable 용 (무료 앱 「Scriptable」)
// 처음 한 번: Scriptable 에서 이 스크립트를 실행 → 내 위젯 주소(…/exec?w=키)를 붙여넣기
// 위젯: 홈 화면 길게 누르기 → + → Scriptable → 큰 크기(추천) 또는 중간 → 위젯 길게 눌러 편집 → Script: 이 스크립트
// 현장 줄을 누르면 웹앱 그날 일정, 「티맵·카카오·네이버」는 각 앱 길안내

const KEY = 'todaySitesUrl';
const C = { bg: '#12161E', row: '#222834', fg: '#FFFFFF', dim: '#8B95A5', tmap: '#4C8DFF', kakao: '#FEE500', naver: '#03C75A' };

async function getUrl(ask) {
  let u = (args.widgetParameter || '').trim();
  if (!u && Keychain.contains(KEY)) u = Keychain.get(KEY);
  if ((!u || ask) && config.runsInApp) {
    const a = new Alert();
    a.title = '내 위젯 주소';
    a.message = '웹앱 아래 「홈 화면 위젯 주소」의 주소(…/exec?w=…)를 붙여넣으세요.';
    a.addTextField('https://script.google.com/macros/s/…/exec?w=…', u || Pasteboard.paste() || '');
    a.addAction('저장');
    a.addCancelAction('취소');
    if ((await a.present()) === 0) {
      const v = a.textFieldValue(0).trim();
      const m = v.match(/https:\/\/script\.google\.com\/\S+?[?&]w=[a-z0-9]{12,32}/);
      if (m) {
        u = m[0].replace(/&view=1.*/, '');
        Keychain.set(KEY, u);
      }
    }
  }
  return u;
}

async function load(u) {
  const fm = FileManager.local();
  const cache = fm.joinPath(fm.documentsDirectory(), 'today-sites.json');
  try {
    const r = new Request(u);
    r.timeoutInterval = 25;
    const j = await r.loadJSON();
    fm.writeString(cache, JSON.stringify(j));
    return j;
  } catch (e) {
    if (fm.fileExists(cache)) {
      const j = JSON.parse(fm.readString(cache));
      j._stale = true;
      return j;
    }
    throw e;
  }
}

// 길안내 주소: 좌표가 있으면 앱을 바로 열고, 없으면 이름으로 검색
function navs(l) {
  const q = encodeURIComponent(((l.area || '') + ' ' + l.name).trim());
  const nav = l.nav || {};
  let lat = null, lng = null, name = l.name;
  const t = (nav.tmap || '').match(/[?&]lon=([\d.]+)&lat=([\d.]+)/) || (nav.tmap || '').match(/goalx=([\d.]+)&goaly=([\d.]+)/);
  if (t) { lng = t[1]; lat = t[2]; }
  const k = (nav.kakao || '').match(/\/link\/to\/([^,]*),([\d.]+),([\d.]+)/);
  if (k) { name = decodeURIComponent(k[1]); lat = k[2]; lng = k[3]; }
  const nm = encodeURIComponent(name);
  if (lat) {
    return {
      tmap: `tmap://route?goalname=${nm}&goalx=${lng}&goaly=${lat}`,
      kakao: `kakaomap://route?ep=${lat},${lng}&by=CAR`,
      naver: nav.naver || `nmap://route/car?dlat=${lat}&dlng=${lng}&dname=${nm}&appname=elevator.schedule`,
    };
  }
  return {
    tmap: `tmap://search?name=${q}`,
    kakao: `kakaomap://search?q=${q}`,
    naver: `nmap://search?query=${q}&appname=elevator.schedule`,
  };
}

function txt(st, s, size, color, bold) {
  const t = st.addText(String(s));
  t.font = bold ? Font.boldSystemFont(size) : Font.systemFont(size);
  t.textColor = new Color(color);
  t.lineLimit = 1;
  return t;
}

function pill(st, label, url, bg, fg) {
  const p = st.addStack();
  p.backgroundColor = new Color(bg);
  p.cornerRadius = 7;
  p.setPadding(5, 7, 5, 7);
  p.url = url;
  const t = p.addText(label);
  t.font = Font.boldSystemFont(11);
  t.textColor = new Color(fg);
  t.lineLimit = 1;
  t.minimumScaleFactor = 0.7;
}

async function build() {
  const w = new ListWidget();
  w.backgroundColor = new Color(C.bg);
  w.setPadding(12, 12, 12, 12);
  w.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000);
  const u = await getUrl(false);
  if (!u) {
    txt(w, '오늘 현장', 16, C.fg, true);
    w.addSpacer(6);
    txt(w, 'Scriptable 앱에서 이 스크립트를 한 번 실행해 내 위젯 주소를 넣어 주세요.', 12, C.dim).lineLimit = 3;
    return w;
  }
  let o;
  try {
    o = await load(u);
  } catch (e) {
    txt(w, '오늘 현장', 16, C.fg, true);
    txt(w, '연결 실패 · 잠시 뒤 다시', 12, C.dim);
    return w;
  }
  const app = u.split('?')[0];
  const big = config.widgetFamily !== 'medium' && config.widgetFamily !== 'small';
  const max = big ? 6 : 2;
  // 머리글
  const h = w.addStack();
  h.centerAlignContent();
  txt(h, o.title || '오늘 현장', big ? 16 : 14, C.fg, true);
  h.addSpacer();
  txt(h, (o._stale ? '⚠ ' : '') + (o.updated || ''), 10, C.dim);
  txt(w, o.sub || '', 11, C.dim);
  w.addSpacer(8);
  const lines = o.lines || [];
  if (!lines.length) txt(w, '표시할 현장이 없어요', 12, C.dim);
  const nowHm = new Date().toTimeString().slice(0, 5);
  const today = (o.title || '').startsWith('오늘');
  lines.slice(0, max).forEach(l => {
    const r = w.addStack();
    r.backgroundColor = new Color(C.row);
    r.cornerRadius = 10;
    r.setPadding(6, 8, 6, 6);
    r.centerAlignContent();
    r.url = app + (o.main ? '?d=' + o.main : '');
    const done = today && l.time && l.time < nowHm;
    const fg = done ? '#66FFFFFF' : C.fg;
    const tm = r.addStack();
    tm.size = new Size(40, 0);
    txt(tm, l.time || '', 12, fg, true);
    const mid = r.addStack();
    mid.layoutVertically();
    txt(mid, l.name, 13, fg, true);
    txt(mid, [l.area, ((l.kind || '') + ' ' + (l.units || '')).trim()].filter(Boolean).join(' · '), 10, C.dim);
    r.addSpacer();
    const n = navs(l);
    pill(r, '티맵', n.tmap, C.tmap, '#FFFFFF');
    r.addSpacer(4);
    pill(r, '카카오', n.kakao, C.kakao, '#191919');
    r.addSpacer(4);
    pill(r, '네이버', n.naver, C.naver, '#FFFFFF');
    w.addSpacer(5);
  });
  if (lines.length > max) txt(w, `외 ${lines.length - max}곳 더 · 줄을 누르면 웹앱`, 10, C.dim);
  if (big) {
    w.addSpacer();
    const f = w.addStack();
    if (o.rk) { pill(f, '하루경로 카카오', o.rk, C.kakao, '#191919'); f.addSpacer(6); }
    if (o.rv) { pill(f, '하루경로 네이버', o.rv, C.naver, '#FFFFFF'); f.addSpacer(6); }
    pill(f, '웹앱 열기', app, C.row, '#FFFFFF');
  }
  return w;
}

if (config.runsInApp) await getUrl(!Keychain.contains(KEY) && !args.widgetParameter);
const widget = await build();
if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentLarge();
Script.complete();
