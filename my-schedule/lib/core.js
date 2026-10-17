/**
 * 내 검사 일정 — Vercel 서버 (apps-script/Code.gs 를 옮긴 것)
 *
 * ▶ Vercel 환경 변수 (Project → Settings → Environment Variables)
 *   - KAKAO_REST_API_KEY : 카카오 REST API 키 (현장 위치 검색·자동차 길찾기)
 *   - KAKAO_JS_KEY       : 카카오 JavaScript 키 (화면 지도) — 카카오 디벨로퍼스 Web 도메인에 Vercel 주소 등록
 *   - TMAP_APP_KEY       : (선택) 티맵 앱키 — 구간 거리·시간을 티맵 추천경로로
 *   - DATA_GO_KR_KEY     : (선택) 공공데이터포털 인증키 — 검사접수정보·승강기 정보
 *   - 저장소: Vercel Storage의 Redis(REDIS_URL) 또는 Upstash(KV_REST_API_URL·TOKEN / UPSTASH_REDIS_REST_URL·TOKEN)
 * ▶ 키는 저장소에 올리지 않음. 위 환경 변수에만 넣기
 */
'use strict';

const CACHE_SEC = 21600; // 6시간
const REGION_KM = 50; // 지사에서 이 거리(km) 밖의 검색 결과는 버림
const SERVER_VER = 'v2.5';
const PAGE_VER = '3.5'; // index.html 의 PAGE_VER 와 같게 — 다르면 화면에 「새로고침」 안내 // 화면 아래에 표시 — 배포가 최신인지 확인용
const RAW = 'https://raw.githubusercontent.com/well8898/-/my-schedule/my-schedule/data/';
const ELV_URL = RAW + 'elv/'; // 건물별 승강기 고유번호
const BOOK_URL = RAW + 'bld/'; // 건물 주소록

const env_ = k => String(process.env[k] || '').trim();

// ── 저장소 (Upstash Redis REST). 환경 변수가 없으면 메모리(시험용) ──
const MEM = new Map();
// 연결할 때 이름 앞에 다른 글자가 붙어도(예: STORAGE_KV_REST_API_URL) 찾음
function envEnd_(...ends) {
  for (const e of ends) {
    if (env_(e)) return env_(e);
    const k = Object.keys(process.env).find(x => x.endsWith('_' + e) && !/READ_ONLY/.test(x) && env_(x));
    if (k) return env_(k);
  }
  return '';
}
function redisConf_() {
  const url = envEnd_('KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL');
  const token = envEnd_('KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN');
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}
// Vercel 'Redis'(Redis Cloud)를 연결하면 REDIS_URL 하나만 생김 → 그때는 일반 Redis 연결(ioredis)
let IOREDIS = null;
function ioredis_() {
  const url = envEnd_('REDIS_URL', 'KV_URL');
  if (!url) return null;
  if (!IOREDIS) {
    const Redis = require('ioredis');
    IOREDIS = new Redis(url, { maxRetriesPerRequest: 2, connectTimeout: 8000, enableAutoPipelining: true });
    IOREDIS.on('error', () => {}); // 끊김은 다음 요청에서 다시 연결
  }
  return IOREDIS;
}
async function redis_(cmds) {
  const io = !redisConf_() && ioredis_();
  if (io) {
    const out = await io.pipeline(cmds.map(([op, ...a]) => [op.toLowerCase(), ...a.map(String)])).exec();
    return out.map(([err, r]) => { if (err) throw new Error('저장소 오류: ' + err.message); return r; });
  }
  const c = redisConf_();
  if (!c) {
    // 메모리 흉내: GET / SET (EX) / DEL / MGET
    const now = Date.now();
    const get = k => { const v = MEM.get(k); return v && (!v.exp || v.exp > now) ? v.val : null; };
    return cmds.map(([op, ...a]) => {
      op = op.toUpperCase();
      if (op === 'GET') return get(a[0]);
      if (op === 'MGET') return a.map(get);
      if (op === 'SET') { MEM.set(a[0], { val: a[1], exp: a[2] === 'EX' ? now + a[3] * 1000 : 0 }); return 'OK'; }
      if (op === 'DEL') { a.forEach(k => MEM.delete(k)); return a.length; }
      return null;
    });
  }
  const res = await fetch(c.url + '/pipeline', {
    method: 'POST', headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  if (!res.ok) throw new Error('저장소 오류(' + res.status + ')');
  const out = await res.json();
  return out.map(r => { if (r.error) throw new Error('저장소 오류: ' + r.error); return r.result; });
}
// 영구 저장 (예전 스크립트 속성)
const props = {
  get: async k => (await redis_([['GET', 'p:' + k]]))[0],
  set: async (k, v) => { await redis_([['SET', 'p:' + k, v]]); },
  del: async k => { await redis_([['DEL', 'p:' + k]]); },
};
// 6시간 캐시 (예전 CacheService)
const cache = {
  getAll: async keys => {
    if (!keys.length) return {};
    const r = (await redis_([['MGET', ...keys.map(k => 'c:' + k)]]))[0] || [];
    const out = {};
    keys.forEach((k, i) => { if (r[i] != null) out[k] = r[i]; });
    return out;
  },
  get: async k => (await redis_([['GET', 'c:' + k]]))[0],
  putAll: async (o, sec) => {
    const ks = Object.keys(o);
    if (ks.length) await redis_(ks.map(k => ['SET', 'c:' + k, o[k], 'EX', sec]));
  },
};

// 결과(값이 있을 때만)를 6시간 캐시
async function cached_(key, fn) {
  const hit = await cache.get(key);
  if (hit) return JSON.parse(hit);
  const v = await fn();
  if (v !== null && v !== undefined) {
    try { await cache.putAll({ [key]: JSON.stringify(v) }, CACHE_SEC); } catch (e) { /* 생략 */ }
  }
  return v;
}

// 날짜 (한국 시간) — Code.gs 의 Utilities.formatDate 대신
function seoul_(d) {
  const p = {};
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(d)).forEach(x => (p[x.type] = x.value));
  return p;
}
const Utilities = {
  formatDate(d, tz, f) {
    const p = seoul_(d);
    if (f === 'yyyy-MM-dd') return p.year + '-' + p.month + '-' + p.day;
    if (f === 'H') return String(Number(p.hour));
    if (f === 'HH:mm') return p.hour + ':' + p.minute;
    if (f === 'M/d HH:mm') return Number(p.month) + '/' + Number(p.day) + ' ' + p.hour + ':' + p.minute;
    throw new Error('지원하지 않는 날짜 형식: ' + f);
  },
};
// 웹앱 주소 (요청마다 정함) — 위젯 화면의 '웹앱 열기'용
let APP_URL = '';
const ScriptApp = { getService: () => ({ getUrl: () => APP_URL }) };

// 여러 주소를 한꺼번에 (동시에 최대 n개)
async function pool_(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}
async function getText_(url, opt) {
  try {
    const r = await fetch(url, opt);
    return { code: r.status, text: await r.text() };
  } catch (e) {
    return { code: 0, text: '' };
  }
}

// ════════ Code.gs 에서 그대로 옮긴 부분 (관할구역·주소록 키·위젯 화면) ════════
// ── 지사별 관할구역 (한국승강기안전공단 지사 안내 기준) ──
// '시도 시군구,시군구|시도 …'  시군구를 비우면 시도 전체. 창원시처럼 구까지 나뉜 곳은 '창원시 성산구'
const JURIS = {
  '서울남서지사': '서울 관악구,구로구,금천구,영등포구',
  '서울동부지사': '서울 중구,동대문구,성동구,중랑구',
  '서울서부지사': '서울 마포구,서대문구,은평구,용산구',
  '서울북부지사': '서울 종로구,강북구,노원구,도봉구,성북구',
  '서울강남지사': '서울 강남구',
  '서울강동지사': '서울 강동구,송파구,광진구',
  '서울서초지사': '서울 서초구,동작구',
  '서울강서지사': '서울 강서구,양천구',
  '부산서부지사': '부산 강서구,남구,동구,부산진구,사상구,사하구,서구,영도구,중구',
  '부산동부지사': '부산 기장군,연제구,수영구,해운대구',
  '부산북부지사': '부산 금정구,동래구,북구|경남 양산시',
  '울산지사': '울산',
  '경남동부지사': '경남 김해시,밀양시,창녕군,창원시 성산구,창원시 의창구,창원시 진해구',
  '경남서부지사': '경남 거제시,고성군,통영시,함안군,의령군,창원시 마산합포구,창원시 마산회원구',
  '진주출장소': '경남 거창군,남해군,사천시,산청군,진주시,하동군,함양군,합천군',
  '대구서부지사': '대구 달서구,북구,서구,달성군|경북 고령군',
  '대구동부지사': '대구 동구,수성구,중구,남구|경북 경산시,청도군',
  '경북동부지사': '경북 경주시,영덕군,영양군,영천시,울릉군,울진군,청송군,포항시',
  '경북서부지사': '경북 구미시,군위군,김천시,문경시,봉화군,성주군,안동시,상주시,영주시,예천군,의성군,칠곡군|대구 군위군',
  '인천남부지사': '인천 미추홀구,남동구,동구,연수구,옹진군,중구',
  '경기북부지사': '경기 가평군,구리시,남양주시,의정부시',
  '양주출장소': '경기 양주시,동두천시,포천시,연천군',
  '고양파주지사': '경기 고양시,파주시',
  '인천동부지사': '인천 부평구|경기 부천시',
  '안산지사': '경기 시흥시,안산시',
  '인천서부지사': '경기 김포시|인천 계양구,서구,강화군',
  '수원지사': '경기 수원시',
  '성남지사': '경기 성남시,광주시,양평군,하남시',
  '안양지사': '경기 과천시,광명시,군포시,안양시,의왕시',
  '용인지사': '경기 용인시,이천시',
  '평택안성지사': '경기 평택시,안성시',
  '화성오산지사': '경기 화성시,오산시',
  '강원지사': '강원 영월군,원주시,횡성군,정선군,태백시,평창군|경기 여주시|충북 단양군,제천시',
  '강릉출장소': '강원 강릉시,고성군,동해시,삼척시,속초시,양양군',
  '춘천출장소': '강원 양구군,인제군,철원군,춘천시,홍천군,화천군',
  '대전지사': '대전|충남 금산군|충북 영동군,옥천군',
  '세종지사': '세종|충남 계룡시,공주시,보령시,논산시,서천군,부여군,청양군',
  '충북지사': '충북 괴산군,보은군,음성군,증평군,진천군,청주시,충주시',
  '충남지사': '충남 당진시,서산시,아산시,예산군,태안군,홍성군',
  '천안지사': '충남 천안시',
  '광주지사': '광주 남구,동구,북구,서구|전남 담양군,화순군,장성군,곡성군',
  '전북동부지사': '전북 남원시,무주군,순창군,완주군,임실군,장수군,진안군,전주시',
  '전북서부지사': '전북 고창군,군산시,김제시,부안군,익산시,정읍시',
  '전남동부지사': '전남 고흥군,광양시,구례군,순천시,여수시,보성군,장흥군',
  '전남서부지사': '광주 광산구|전남 나주시,목포시,강진군,무안군,신안군,영광군,영암군,완도군,진도군,함평군,해남군',
  '제주지사': '제주',
};

const SIDO = {
  서울특별시: '서울', 부산광역시: '부산', 대구광역시: '대구', 인천광역시: '인천', 광주광역시: '광주',
  대전광역시: '대전', 울산광역시: '울산', 세종특별자치시: '세종', 경기도: '경기', 강원도: '강원',
  강원특별자치도: '강원', 충청북도: '충북', 충청남도: '충남', 전라북도: '전북', 전북특별자치도: '전북',
  전라남도: '전남', 경상북도: '경북', 경상남도: '경남', 제주특별자치도: '제주',
};

// 지사 이름 → [[시도, 시군구(없으면 '')], …]  (관할 정보가 없으면 null)
function juris_(branch) {
  const t = JURIS[String(branch || '')];
  if (!t) return null;
  const out = [];
  t.split('|').forEach(part => {
    const i = part.indexOf(' ');
    const sido = i < 0 ? part : part.slice(0, i);
    const rest = i < 0 ? '' : part.slice(i + 1);
    if (!rest) out.push([sido, '']);
    else rest.split(',').forEach(g => out.push([sido, g.trim()]));
  });
  return out;
}

// 주소가 관할구역 안인지 ('경기도 고양시 …', '경기 고양시 …' 모두)
function inJuris_(addr, J) {
  if (!J) return true;
  const w = String(addr || '').trim().split(/\s+/);
  if (!w.length) return false;
  const sido = SIDO[w[0]] || w[0].replace(/특별자치시|특별자치도|특별시|광역시|도$/, '');
  const a = ' ' + w.slice(1).join(' ') + ' ';
  return J.some(r => r[0] === sido && (!r[1] || a.indexOf(' ' + r[1] + ' ') >= 0));
}

// 검색 결과가 관할 안인지: 관할 정보가 있으면 관할로, 없으면 지사에서 REGION_KM 안
function inArea_(x, o, J) {
  if (J) return inJuris_(x.address_name, J) || inJuris_(x.road_address_name || (x.road_address && x.road_address.address_name), J);
  return !o || km_(o.lat, o.lng, Number(x.y), Number(x.x)) <= REGION_KM;
}

// 주소록 키 → 조각 파일 이름 (data/bld/NNN.json)
function bookFile_(k) {
  if (!k || k.length < 2) return '';
  let v = 5381;
  for (let i = 0; i < k.length; i++) v = (v * 33 + k.charCodeAt(i)) % 4294967296;
  return ('00' + (v % 128)).slice(-3) + '.json';
}

// 건물명 → 주소록 키 (data/bld 를 만든 규칙과 같아야 함)
function bookKey_(n) {
  let x = String(n || '').replace(/\(주\)|㈜/g, '').replace(/\([^)]*$/, '')
    .replace(/\s*[A-Z0-9,\s]+동(,\s*[A-Z0-9]+동)*\s*$/, '').replace(/\s+/g, ' ').trim() || String(n || '');
  return x.replace(/주식회사/g, '').replace(/[\s()·\-_.,#]/g, '').replace(/아파트$/, '');
}

// 접수 주소 → 카카오 주소 검색용 ('(장전동)', '일원', 쉼표 뒤 등 정리)
function cleanAddr_(a) {
  return String(a || '').replace(/\([^)]*\)?/g, ' ').split(',')[0]
    .replace(/일원|번지/g, ' ').replace(/\s+/g, ' ').trim();
}

// 두 좌표 사이 직선거리 (km)
function km_(a, b, c, d) {
  const r = Math.PI / 180;
  const x = (d - b) * r * Math.cos((a + c) / 2 * r), y = (c - a) * r;
  return Math.sqrt(x * x + y * y) * 6371;
}

// 길안내 링크: 카카오맵(앱/웹) · 티맵(앱 실행 링크, 앱키 있을 때) · 네이버지도 앱
function navLinks_(dest, lat, lng) {
  const de = encodeURIComponent(String(dest).replace(/[,/]/g, ' '));
  const tk = env_('TMAP_APP_KEY');
  return {
    kakao: 'https://map.kakao.com/link/to/' + de + ',' + lat + ',' + lng,
    tmap: tk ? 'https://apis.openapi.sk.com/tmap/app/routes?appKey=' + encodeURIComponent(tk)
      + '&name=' + de + '&lon=' + lng + '&lat=' + lat
      : 'tmap://route?goalname=' + de + '&goalx=' + lng + '&goaly=' + lat,
    naver: 'nmap://route/car?dlat=' + lat + '&dlng=' + lng + '&dname=' + de + '&appname=elevator.schedule',
  };
}

// 위젯 화면 (?w=키&view=1): A안 — 오늘 현장 목록, 줄마다 티맵 버튼, 하루 경로
function widgetHtml_(o) {
  const h = v => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let app = '';
  try { app = ScriptApp.getService().getUrl(); } catch (e) { /* 없음 */ }
  let rows = '';
  for (let i = 1; i <= 8; i++) {
    if (!o['n' + i]) continue;
    const link = o['t' + i] || o['k' + i];
    rows += '<div class="row' + (o['d' + i] === '1' ? ' done' : '') + '">'
      + '<span class="no">' + i + '</span><span class="t">' + h(o['h' + i]) + '</span>'
      + '<span class="n">' + h(o['n' + i]) + '<small>' + h(o['s' + i]) + '</small></span>'
      + (link ? '<a class="go" target="_blank" href="' + h(link) + '">티맵</a>' : '') + '</div>';
  }
  if (o.l8 && /^외 /.test(o.l8)) rows += '<div class="more">' + h(o.l8) + '</div>';
  return '<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><style>'
    + '*{box-sizing:border-box}html,body{margin:0;background:#121822;color:#eef3fb;'
    + 'font-family:"Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif}'
    + 'body{padding:12px 12px 10px}.top{display:flex;justify-content:space-between;align-items:baseline;gap:8px}'
    + '.top b{font-size:16px}.top span{font-size:11px;color:#9fb0c8;white-space:nowrap}'
    + '.sum{font-size:12.5px;color:#9fb0c8;margin:4px 0 10px}'
    + '.row{display:grid;grid-template-columns:22px 46px minmax(0,1fr) auto;gap:8px;align-items:center;'
    + 'background:rgba(255,255,255,.07);border-radius:14px;padding:8px 8px 8px 10px;margin-bottom:6px}'
    + '.no{width:20px;height:20px;border-radius:50%;background:#4b8df8;display:grid;place-items:center;font-size:11px;font-weight:800}'
    + '.t{font-weight:700;font-size:14px;font-variant-numeric:tabular-nums}'
    + '.n{font-size:14.5px;font-weight:700;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '.n small{display:block;font-size:11.5px;color:#9fb0c8;font-weight:400}'
    + '.go{background:#4b8df8;color:#fff;text-decoration:none;border-radius:11px;padding:9px 12px;font-size:13px;font-weight:800}'
    + '.done{opacity:.45}.more{font-size:12px;color:#9fb0c8;text-align:center;margin:2px 0 6px}'
    + '.bot{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:4px}'
    + '.bot a{display:block;text-align:center;color:#eef3fb;text-decoration:none;border:1px solid rgba(255,255,255,.2);'
    + 'border-radius:12px;padding:9px 0;font-size:13px;font-weight:700}.msg{color:#9fb0c8;font-size:13px;margin-top:8px}'
    + '</style></head><body>'
    + '<div class="top"><b>' + h(o.title) + '</b><span>' + h(o.updated ? o.updated + ' 저장' : '') + '</span></div>'
    + (o.sub ? '<div class="sum">' + h(o.sub) + '</div>' : '<div class="msg">' + h(o.text || '') + '</div>')
    + rows
    + '<div class="bot">' + (o.rk ? '<a target="_blank" href="' + h(o.rk) + '">하루 경로 · 카카오</a>' : '<span></span>')
    + (app ? '<a target="_blank" href="' + h(app) + '">웹앱 열기</a>' : '') + '</div>'
    + '</body></html>';
}

// 저장된 주간 일정 → 지금 보여 줄 하루 (오후 6시 이후거나 오늘 근무가 없으면 다음 근무일)
function widgetView_(data) {
  const tz = 'Asia/Seoul', now = new Date();
  const today = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  const hour = Number(Utilities.formatDate(now, tz, 'H'));
  const days = data.days || [];
  const t = days.find(d => d.iso === today);
  let main = t && t.stops && t.stops.length && hour < 18 ? t : null;
  if (!main) main = days.find(d => d.iso > today && d.stops && d.stops.length) || null;
  const off = t && t.off && hour < 18;
  const updated = Utilities.formatDate(new Date(data.savedAt || now), tz, 'M/d HH:mm');
  // 위젯 앱에서 ◀ ▶ 로 넘겨 볼 수 있게 일정표의 모든 근무일
  const all = days.filter(d => d.stops && d.stops.length).map(d => {
    const v = dayView_(data, d, today, now);
    return { iso: d.iso, title: v.title, sub: v.sub, lines: v.lines, rk: v.rk || '', rv: v.rv || '', total: v.total, back: v.back };
  });
  if (!main) {
    const title = off ? '오늘은 휴가예요' : '이번 일정표에 남은 근무가 없어요';
    return { ok: true, name: data.name, title: title, sub: '새 일정표를 올려 주세요', lines: [], text: title, updated: updated, days: all, main: '' };
  }
  const v = dayView_(data, main, today, now);
  if (off) v.title = '오늘 휴가 · ' + v.title;
  return Object.assign(v.per, { all: v.rows.join(' / ') }, { ok: true, name: data.name, title: v.title, sub: v.sub, start: v.lines[0] ? v.lines[0].time : '',
    lines: v.lines, count: v.lines.length, text: v.text, rk: v.rk, rv: v.rv, total: v.total, back: v.back, updated: updated, days: all, main: main.iso });
}

// 하루치 위젯 내용: 제목·요약·현장 줄·길안내 링크·하루 경로
function dayView_(data, main, today, now) {
  const tz = 'Asia/Seoul';
  const when = main.iso === today ? '오늘' : main.iso === tomorrow_(today) ? '내일' : '';
  const kindNm = { '정': '정기', '밀': '정밀', '수': '수시', '완': '설치', '설': '설치' };
  const lines = main.stops.map((s, i) => {
    const nav = s.lat ? navLinks_(s.addr ? s.addr.replace(/\([^)]*\)/g, ' ').trim() : s.name, s.lat, s.lng) : null;
    return {
      no: i + 1, time: s.time || '', name: s.name, area: s.area || '', addr: s.addr || '',
      kind: kindNm[s.kind] || s.kind || '', units: s.units == null ? '' : s.units, nav: nav,
      km: main.legs ? main.legs[i] : null, leg: legText_(main.legs ? main.legs[i] : null, i, data.origin)
        // 마지막 현장: 지사로 돌아가는 거리도
        + (i === main.stops.length - 1 && main.backKm != null ? (main.legs && main.legs[i] != null ? ' / ' : '') + '(복귀) ' + main.backKm + 'km→지사' : ''),
    };
  });
  const units = main.stops.reduce((a, s) => a + (s.units || 0), 0);
  const places = new Set(main.stops.map(s => s.name)).size;
  const title = (when ? when + ' ' : '') + main.label + (main.team ? ' · ' + main.team : '');
  const back = main.backKm != null ? ' (복귀 ' + main.backKm + ')' : '';
  const sub = places + '현장 ' + units + '대' + (main.legKm ? ' · 총 ' + main.legKm + 'km' + back : main.km ? ' · ' + main.km + 'km' : '')
    + (main.mates && main.mates.length ? ' · 동행 ' + main.mates.join(', ') : '');
  const text = [title, ...lines.map(l => l.no + '. ' + l.time + ' ' + l.name + (l.area ? ' (' + l.area + ')' : '')
    + ' ' + l.kind + ' ' + l.units), sub].join('\n');
  const nowHm = Utilities.formatDate(now, tz, 'HH:mm');
  // 위젯 앱에서 줄마다 따로 쓰기 쉽게 l1~l8 (현장 한 줄씩)
  const rows = text.split('\n').slice(1, -1);
  const per = {};
  // 줄마다 길안내 링크: k1~k8 카카오, t1~t8 티맵, v1~v8 네이버 (좌표를 못 찾은 현장은 카카오 검색)
  for (let i = 0; i < 8; i++) {
    per['l' + (i + 1)] = rows[i] || '';
    const l = lines[i];
    // 위젯 칸용: h 시간, n 현장명, s 동·종류·대수, d 지난 현장이면 1 (흐리게 표시용)
    per['h' + (i + 1)] = l ? l.time : '';
    per['n' + (i + 1)] = l ? l.name : '';
    per['s' + (i + 1)] = l ? [l.leg, l.area, (l.kind + ' ' + l.units).trim()].filter(Boolean).join(' · ') : '';
    per['d' + (i + 1)] = l && when === '오늘' && l.time && l.time < nowHm ? '1' : '0';
    const q = l ? encodeURIComponent(((l.area || '') + ' ' + l.name).trim()) : '';
    per['k' + (i + 1)] = l ? (l.nav ? l.nav.kakao : 'https://map.kakao.com/?eName=' + q) : '';
    per['t' + (i + 1)] = l ? (l.nav ? l.nav.tmap : 'https://map.kakao.com/?eName=' + q) : '';
    per['v' + (i + 1)] = l ? (l.nav ? l.nav.naver : 'https://map.naver.com/p/search/' + q) : '';
  }
  if (rows.length > 8) per.l8 = '외 ' + (rows.length - 7) + '현장 더';
  // 하루 경로 (지사 출발 → 현장들 → 마지막 현장): 카카오 rk, 네이버 rv
  let rk = '', rv = '';
  const pts = lines.filter(l => l.nav).map(l => ({ n: l.name, lat: main.stops[l.no - 1].lat, lng: main.stops[l.no - 1].lng }));
  if (pts.length) {
    const lab = x => encodeURIComponent(String(x).replace(/[,/]/g, ' '));
    const o = data.origin, end = pts[pts.length - 1], via = pts.slice(0, -1).slice(0, 5);
    const bn = data.branch && data.branch[0] ? data.branch[0] : '지사';
    rk = 'https://map.kakao.com/link/by/car/' + (o ? [{ n: bn, lat: o.lat, lng: o.lng }] : [])
      .concat(via, [end]).map(x => lab(x.n) + ',' + x.lat + ',' + x.lng).join('/');
    rv = 'nmap://route/car?dlat=' + end.lat + '&dlng=' + end.lng + '&dname=' + lab(end.n);
    if (o) rv += '&slat=' + o.lat + '&slng=' + o.lng + '&sname=' + lab(bn);
    via.forEach((x, i) => { rv += '&v' + (i + 1) + 'lat=' + x.lat + '&v' + (i + 1) + 'lng=' + x.lng + '&v' + (i + 1) + 'name=' + lab(x.n); });
    rv += '&appname=elevator.schedule';
  }
  return { title: title, sub: sub, lines: lines, rows: rows, text: text, per: per, rk: rk, rv: rv,
    total: main.legKm || main.km || null, back: main.backKm != null ? main.backKm : null };
}

// 줄에 붙일 구간 거리 글자: 첫 현장은 '지사→12.3km', 다음부터 '↑4.0km'(바로 위 현장에서), 같은 곳이면 '같은 곳'
function legText_(km, i, origin) {
  if (km == null) return '';
  if (km === 0) return '같은 현장';
  return (i === 0 && origin ? '지사→' : '→') + km + 'km';
}

function tomorrow_(iso) {
  const d = new Date(iso + 'T12:00:00+09:00');
  d.setDate(d.getDate() + 1);
  return Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM-dd');
}


// ════════ 카카오 ════════
function getKakaoKey_() {
  const key = env_('KAKAO_REST_API_KEY');
  if (!key) throw new Error('환경 변수에 KAKAO_REST_API_KEY가 없습니다.');
  return key;
}
async function kakaoGet_(url) {
  const r = await getText_(url, { headers: { Authorization: 'KakaoAK ' + getKakaoKey_() } });
  if (r.code === 401 || r.code === 403) throw new Error('카카오 API 권한 오류(' + r.code + '). REST API 키와 카카오맵·카카오모빌리티 API 사용 설정을 확인하세요.');
  if (r.code !== 200) throw new Error('카카오 API 오류(' + r.code + '): ' + r.text.slice(0, 200));
  return JSON.parse(r.text);
}

// 화면 시작 시: 지도 키
async function getConfig() {
  return { ok: true, kakaoJsKey: env_('KAKAO_JS_KEY'), tmapKey: env_('TMAP_APP_KEY'), webUrl: APP_URL,
    ver: SERVER_VER + (redisConf_() || envEnd_('REDIS_URL', 'KV_URL') ? '' : ' (저장소 연결 안 됨)') };
}

// 최신 버전 확인: 화면·서버·앱(깃허브 릴리스 설명의 versionName=)
let appVer_ = { at: 0, v: '' };
async function latestVer() {
  if (Date.now() - appVer_.at > 10 * 60 * 1000) {
    try {
      const r = await getText_('https://api.github.com/repos/well8898/-/releases/tags/widget-apk',
        { headers: { 'User-Agent': 'my-schedule', Accept: 'application/vnd.github+json' } });
      const m = r.code === 200 && /versionName=([\w.]+)/.exec(JSON.parse(r.text).body || '');
      appVer_ = { at: Date.now(), v: m ? m[1] : appVer_.v };
    } catch (e) { appVer_.at = Date.now(); }
  }
  return { page: PAGE_VER, server: SERVER_VER, app: appVer_.v };
}

// ════════ 지사 좌표 ════════
async function getOrigin(name, address) {
  try {
    const p = await branchPoint_(name, address);
    if (!p) throw new Error('지사 주소를 찾지 못했습니다: ' + address);
    return { ok: true, origin: { lat: p.lat, lng: p.lng, name: name }, juris: JURIS[name] || '' };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}
async function branchPoints_() { return JSON.parse((await props.get('BRANCH_POINTS')) || '{}'); }
async function branchPoint_(name, address) {
  const all = await branchPoints_();
  if (all[name]) return all[name];
  const q = String(address || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  const ad = await kakaoGet_('https://dapi.kakao.com/v2/local/search/address.json?size=1&query=' + encodeURIComponent(q));
  let d = (ad.documents || [])[0];
  if (!d) {
    const kw = await kakaoGet_('https://dapi.kakao.com/v2/local/search/keyword.json?size=1&query=' + encodeURIComponent('한국승강기안전공단 ' + name));
    d = (kw.documents || [])[0];
  }
  if (!d) return null;
  const fresh = await branchPoints_();
  fresh[name] = { lat: Number(d.y), lng: Number(d.x) };
  await props.set('BRANCH_POINTS', JSON.stringify(fresh));
  return fresh[name];
}
async function prefetchBranches_(branches) {
  const all = await branchPoints_();
  const miss = (Array.isArray(branches) ? branches : []).filter(b => !all[b[0]]);
  if (!miss.length) return all;
  const key = getKakaoKey_();
  await pool_(miss, 8, async b => {
    const r = await getText_('https://dapi.kakao.com/v2/local/search/address.json?size=1&query='
      + encodeURIComponent(String(b[1] || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()),
    { headers: { Authorization: 'KakaoAK ' + key } });
    try { const d = (JSON.parse(r.text).documents || [])[0]; if (d) all[b[0]] = { lat: Number(d.y), lng: Number(d.x) }; } catch (e) {}
  });
  await props.set('BRANCH_POINTS', JSON.stringify(all));
  return all;
}

// 현장이 많은 동네 이름들 → 그 동네들과 가장 잘 맞는 지사
async function guessBranch(areas, branches) {
  try {
    const list = (Array.isArray(areas) ? areas : []).slice(0, 10);
    const cands = await Promise.all(list.map(async a => (await cached_('area2:' + a, async () => {
      const r = await kakaoGet_('https://dapi.kakao.com/v2/local/search/address.json?size=30&query=' + encodeURIComponent(a));
      return (r.documents || []).filter(d => (d.address_name || '').split(' ').pop() === a)
        .map(d => [Number(d.y), Number(d.x), d.address_name]);
    })) || []));
    const pts = await prefetchBranches_(branches);
    let best = null;
    (Array.isArray(branches) ? branches : []).forEach(b => {
      const J = juris_(b[0]);
      const p = pts[b[0]] || null;
      if (!p && !J) return;
      let inj = 0, hits = 0, sum = 0;
      cands.forEach(c => {
        if (J && c.some(x => inJuris_(x[2], J))) inj++;
        const m = p && c.length ? Math.min.apply(null, c.map(x => km_(p.lat, p.lng, x[0], x[1]))) : 999;
        if (m <= 35) hits++;
        sum += Math.min(m, 200);
      });
      const better = !best || inj > best.inj || (inj === best.inj && (hits > best.hits || (hits === best.hits && sum < best.sum)));
      if (better) best = { branch: b[0], inj: inj, hits: hits, sum: sum };
    });
    if (!best || !(best.inj || best.hits)) return { ok: false, message: '추측할 수 없음' };
    return { ok: true, branch: best.branch, hits: Math.max(best.inj, best.hits) };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

// ════════ 현장 위치 ════════
// sites: [{ q, region, area, name, addr? }] → { ok, places: { q: { lat, lng, name, addr? } } }
async function geocodeSites(sites, origin, branch) {
  try {
    const places = {};
    const o = origin && origin.lat ? origin : null;
    const J = juris_(branch || (o && o.name));
    const list = (Array.isArray(sites) ? sites : []).slice(0, 60);
    const ckOf = s => 'site4:' + String((s && s.q) || '').trim() + '|' + (s.addr || '') + '@' + (J ? JSON.stringify(J) : o ? o.lat.toFixed(3) + ',' + o.lng.toFixed(3) : '');
    const fixes = await siteFixes_(list.map(s => [s.name || s.q, s.area]));
    const todo = [];
    list.forEach((s, i) => {
      const q = String((s && s.q) || '').trim();
      if (!q || q in places) return;
      if (fixes[i]) { places[q] = fixes[i]; return; } // 누군가 직접 넣어 둔 주소
      places[q] = null;
      todo.push(s);
    });
    const hit = await cache.getAll(todo.map(ckOf));
    const miss = todo.filter(s => !hit[ckOf(s)]);
    todo.forEach(s => { const h = hit[ckOf(s)]; if (h) places[String(s.q).trim()] = JSON.parse(h); });
    // 주소록 조각을 한꺼번에 받아 두고, 현장들을 동시에 찾기
    const book = {};
    await prefetchBook_(miss, book);
    const put = {};
    await pool_(miss, 6, async s => {
      let p = null;
      try { p = await findSite_(s, o, J, book); } catch (e) { /* 이 현장만 건너뜀 */ }
      if (p) { places[String(s.q).trim()] = p; put[ckOf(s)] = JSON.stringify(p); }
    });
    try { await cache.putAll(put, CACHE_SEC); } catch (e) {}
    Object.keys(places).forEach(q => { if (!places[q]) delete places[q]; });
    return { ok: true, places: places };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

// 상호 검색 결과 중 일정표의 동·읍·면에 있고, 지사 관할구역 안인 곳
async function findSite_(s, o, J, book) {
  const base = 'https://dapi.kakao.com/v2/local/search/';
  const area = String(s.area || '').trim();
  const name = String(s.name || '').trim();
  const near = o ? '&x=' + o.lng + '&y=' + o.lat + '&sort=distance' : '';
  const ok = d => {
    const a = ' ' + (d.address_name || '') + ' ' + (d.road_address_name || '');
    if (area && a.indexOf(' ' + area) < 0) return false;
    return inArea_(d, o, J);
  };
  if (!s.addr) {
    const all = await bookCandidates_(name, area, book);
    const cands = J ? all.filter(a => inJuris_(a, J)) : all;
    for (let i = 0; i < Math.min(cands.length, 5); i++) {
      const p = await addrPoint_(cands[i], o, J);
      if (p) return { lat: p.lat, lng: p.lng, name: name, addr: cands[i] };
    }
  }
  if (s.addr) {
    const ad = await kakaoGet_(base + 'address.json?size=3&query=' + encodeURIComponent(cleanAddr_(s.addr)));
    const d = (ad.documents || []).find(x => inArea_(x, o, J));
    if (d) return { lat: Number(d.y), lng: Number(d.x), name: name, addr: s.addr };
    const kw = await kakaoGet_(base + 'keyword.json?size=5&query=' + encodeURIComponent(cleanAddr_(s.addr)) + near);
    const k = (kw.documents || []).find(x => inArea_(x, o, J));
    if (k) return { lat: Number(k.y), lng: Number(k.x), name: name, addr: s.addr };
  }
  const queries = [String(s.q || ''), area + ' ' + name, name].filter(Boolean);
  for (let i = 0; i < queries.length; i++) {
    const kw = await kakaoGet_(base + 'keyword.json?size=15&query=' + encodeURIComponent(queries[i]) + near);
    const d = (kw.documents || []).find(ok);
    if (d) return { lat: Number(d.y), lng: Number(d.x), name: d.place_name || name };
  }
  if (/\d/.test(name)) {
    const q = [s.region, area, name.indexOf(area) === 0 ? name.slice(area.length) : name].filter(Boolean).join(' ');
    const ad = await kakaoGet_(base + 'address.json?size=5&query=' + encodeURIComponent(q));
    const d = (ad.documents || []).find(ok);
    if (d) return { lat: Number(d.y), lng: Number(d.x), name: name };
  }
  return null;
}

async function addrPoint_(addr, o, J) {
  const ad = await kakaoGet_('https://dapi.kakao.com/v2/local/search/address.json?size=3&query=' + encodeURIComponent(cleanAddr_(addr)));
  const d = (ad.documents || []).find(x => inArea_(x, o, J));
  return d ? { lat: Number(d.y), lng: Number(d.x) } : null;
}

// 주소록·설치현황 조각 (data/bld, data/elv) — 서버가 켜져 있는 동안 기억
const SHARD_MEMO = { bld: new Map(), elv: new Map() };
async function shard_(kind, file) {
  const m = SHARD_MEMO[kind];
  if (m.has(file)) return m.get(file);
  const r = await getText_((kind === 'bld' ? BOOK_URL : ELV_URL) + file);
  let v = null;
  try { if (r.code === 200) v = JSON.parse(r.text); } catch (e) {}
  if (v) { if (m.size > 60) m.delete(m.keys().next().value); m.set(file, v); }
  return v;
}
async function prefetchBook_(list, book) {
  const files = [];
  list.forEach(s => { const f = bookFile_(bookKey_(s.name || '')); if (f && files.indexOf(f) < 0) files.push(f); });
  await pool_(files, 8, async f => { book[f] = await shard_('bld', f); });
}
async function bookCandidates_(name, area, book) {
  const k = bookKey_(name);
  if (k.length < 2) return [];
  const file = bookFile_(k);
  const shard = (book && book[file]) || (await shard_('bld', file));
  const list = (shard && shard[k]) || [];
  if (!area) return list;
  const hit = list.filter(a => a.indexOf(area) >= 0);
  return hit.length ? hit : list;
}

// ════════ 현장 주소 직접 지정 (모두 함께 씀) ════════
const FIX_SHARDS = 8;
function fixKey_(name, area) { return bookKey_(name) + '|' + String(area || '').trim(); }
function fixProp_(k) {
  let v = 5381;
  for (let i = 0; i < k.length; i++) v = (v * 33 + k.charCodeAt(i)) % 4294967296;
  return 'SITE_FIX_' + (v % FIX_SHARDS);
}
// [[name, area], …] → [fix | null, …]
async function siteFixes_(pairs) {
  const keys = pairs.map(p => fixKey_(p[0], p[1]));
  const propsNeeded = [...new Set(keys.filter(k => k.length >= 3).map(fixProp_))];
  const vals = propsNeeded.length ? (await redis_([['MGET', ...propsNeeded.map(p => 'p:' + p)]]))[0] : [];
  const m = {};
  propsNeeded.forEach((p, i) => { try { m[p] = JSON.parse(vals[i] || '{}'); } catch (e) { m[p] = {}; } });
  return keys.map((k, i) => {
    if (k.length < 3) return null;
    const f = (m[fixProp_(k)] || {})[k];
    return f ? { lat: f.y, lng: f.x, name: String(pairs[i][0] || ''), addr: f.a, fixed: true } : null;
  });
}
async function setSiteAddr(name, area, text, origin, branch) {
  try {
    name = String(name || '').trim();
    text = String(text || '').trim().slice(0, 120);
    if (!name) return { ok: false, message: '현장 이름을 알 수 없어요. 일정표를 다시 올려 주세요.' };
    if (text.length < 2) return { ok: false, message: '주소를 입력해 주세요.' };
    const o = origin && origin.lat ? origin : null;
    const J = juris_(branch || (o && o.name));
    const base = 'https://dapi.kakao.com/v2/local/search/';
    const near = x => inArea_(x, o, J);
    let hit = null;
    const ad = await kakaoGet_(base + 'address.json?size=5&query=' + encodeURIComponent(cleanAddr_(text)));
    const d = (ad.documents || []).find(near);
    if (d) {
      const road = d.road_address && d.road_address.address_name;
      hit = { y: Number(d.y), x: Number(d.x), a: road || d.address_name || text };
    } else {
      const nq = o ? '&x=' + o.lng + '&y=' + o.lat + '&sort=distance' : '';
      const kw = await kakaoGet_(base + 'keyword.json?size=5&query=' + encodeURIComponent(text) + nq);
      const k = (kw.documents || []).find(near);
      if (k) hit = { y: Number(k.y), x: Number(k.x), a: k.road_address_name || k.address_name || text };
    }
    if (!hit) return { ok: false, message: J ? '관할구역(' + JURIS[branch || o.name] + ') 안에서 그 주소를 찾지 못했어요. 도로명·지번 주소로 다시 넣어 주세요.' : '그 주소를 지도에서 찾지 못했어요. 도로명·지번 주소로 다시 넣어 주세요.' };
    hit.t = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
    const k = fixKey_(name, area);
    const prop = fixProp_(k);
    const m = JSON.parse((await props.get(prop)) || '{}');
    m[k] = hit;
    await props.set(prop, JSON.stringify(m));
    return { ok: true, place: { lat: hit.y, lng: hit.x, name: name, addr: hit.a, fixed: true } };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}
async function clearSiteAddr(name, area) {
  try {
    const k = fixKey_(name, area);
    const prop = fixProp_(k);
    const m = JSON.parse((await props.get(prop)) || '{}');
    delete m[k];
    await props.set(prop, JSON.stringify(m));
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

// 하루 보기에 필요한 것을 한 번에 — 현장 위치 + 방문 순서대로 구간 거리
async function dayBundle(need, origin, branch, order) {
  try {
    const g = await geocodeSites(need || [], origin, branch);
    if (!g.ok) return g;
    const key = p => Number(p.lat).toFixed(5) + ',' + Number(p.lng).toFixed(5);
    const stops = [];
    (Array.isArray(order) ? order : []).forEach(x => {
      const p = x && x.lat != null ? x : g.places[x && x.q];
      if (!p || !p.lat) return;
      const last = stops[stops.length - 1];
      if (last && key(last) === key(p)) return;
      stops.push({ lat: Number(p.lat), lng: Number(p.lng) });
    });
    const o = origin && origin.lat ? { lat: Number(origin.lat), lng: Number(origin.lng) } : null;
    const pts = o ? [o].concat(stops, [o]) : stops;
    const keys = [], pairs = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const k = key(pts[i]) + '>' + key(pts[i + 1]);
      if (keys.indexOf(k) >= 0) continue;
      keys.push(k);
      pairs.push([pts[i].lat, pts[i].lng, pts[i + 1].lat, pts[i + 1].lng]);
    }
    const legs = {};
    let src = '';
    if (pairs.length) {
      const r = await routeLegs(pairs);
      if (r.ok) {
        keys.forEach((k, i) => (legs[k] = { km: r.km[i], min: r.min ? r.min[i] : null }));
        src = r.src;
      }
    }
    return { ok: true, places: g.places, legs: legs, src: src };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

// 자동차 구간 거리: 티맵(앱키 있으면) → 실패 구간은 카카오내비. 6시간 캐시
async function routeLegs(pairs) {
  try {
    const tmapKey = env_('TMAP_APP_KEY');
    const list = (Array.isArray(pairs) ? pairs : []).slice(0, 30);
    const ids = list.map(p => 'leg3:' + p.map(v => Number(v).toFixed(5)).join(','));
    const hit = await cache.getAll(ids);
    const out = list.map((p, i) => (hit[ids[i]] ? JSON.parse(hit[ids[i]]) : null));
    let src = tmapKey ? 'TMAP' : '카카오';
    const todo = () => out.map((r, i) => (r ? -1 : i)).filter(i => i >= 0);
    todo().forEach(i => {
      const p = list[i];
      if (Math.abs(p[0] - p[2]) < 1e-5 && Math.abs(p[1] - p[3]) < 1e-5) out[i] = { km: 0, min: 0 };
    });
    if (tmapKey && todo().length) {
      await pool_(todo(), 6, async i => {
        const r = await getText_('https://apis.openapi.sk.com/tmap/routes?version=1&format=json', {
          method: 'POST', headers: { appKey: tmapKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ startX: String(list[i][1]), startY: String(list[i][0]), endX: String(list[i][3]), endY: String(list[i][2]),
            reqCoordType: 'WGS84GEO', resCoordType: 'WGS84GEO', searchOption: '0' }),
        });
        try {
          if (r.code !== 200) return;
          const f = (JSON.parse(r.text).features || [])[0];
          const pr = f && f.properties;
          if (pr && pr.totalDistance != null) out[i] = { km: Math.round(pr.totalDistance / 100) / 10, min: Math.round((pr.totalTime || 0) / 60) };
        } catch (e) { /* 카카오로 */ }
      });
    }
    if (todo().length) {
      const key = getKakaoKey_();
      await pool_(todo(), 6, async i => {
        const r = await getText_('https://apis-navi.kakaomobility.com/v1/directions?origin=' + list[i][1] + ',' + list[i][0]
          + '&destination=' + list[i][3] + ',' + list[i][2] + '&priority=RECOMMEND', { headers: { Authorization: 'KakaoAK ' + key } });
        try {
          const route = (JSON.parse(r.text).routes || [])[0];
          if (!route) return;
          if (route.result_code === 104) out[i] = { km: 0, min: 0 };
          else if (route.result_code === 0) out[i] = { km: Math.round(route.summary.distance / 100) / 10, min: Math.round(route.summary.duration / 60) };
          if (tmapKey && out[i]) src = 'TMAP·카카오';
        } catch (e) { /* 계산 실패 구간 */ }
      });
    }
    const put = {};
    out.forEach((r, i) => { if (r && !hit[ids[i]]) put[ids[i]] = JSON.stringify(r); });
    try { await cache.putAll(put, CACHE_SEC); } catch (e) {}
    return { ok: true, km: out.map(r => (r ? r.km : null)), min: out.map(r => (r ? r.min : null)), src: src };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

// ════════ 공공데이터: 검사접수정보 · 승강기 정보 ════════
async function recptnList(st, en, branch) {
  try {
    const key = env_('DATA_GO_KR_KEY');
    if (!key) return { ok: true, list: [], note: 'DATA_GO_KR_KEY 없음' };
    if (!/^\d{8}$/.test(String(st)) || !/^\d{8}$/.test(String(en))) return { ok: false, message: '날짜 형식 오류' };
    const list = await cached_('recptn5:' + st + '-' + en + ':' + (branch || ''), async () => {
      const out = [];
      for (let page = 1; page <= 10; page++) {
        const r = await getText_('https://apis.data.go.kr/B553664/ElevatorRecptnService/getRecptnV1?serviceKey=' + encodeURIComponent(key)
          + '&_type=json&numOfRows=1000&pageNo=' + page + '&inspct_st_de=' + st + '&inspct_en_de=' + en);
        if (r.code !== 200) throw new Error('검사접수정보 오류(' + r.code + ')');
        const body = (JSON.parse(r.text).response || {}).body || {};
        let items = (body.items && body.items.item) || [];
        if (!Array.isArray(items)) items = [items];
        items.forEach(it => {
          if (branch && String(it.inspctInsttNm || '') !== branch) return;
          out.push({ d: String(it.inspctDt), nm: String(it.buldNm || '').trim(), addr: String(it.address || '').trim(),
            kind: String(it.inspctKindNm || ''), inst: String(it.inspctInsttNm || '').trim(),
            mnt: String(it.ledgMntCompanyNm || '').trim(), tel: String(it.ledgMntHedofcTelno || '').trim(),
            mfr: String(it.ledgMnfcturCompanyNm || '').trim(),
            mfrTel: String(it.ledgMnfcturHedofcTelno || it.reqstMnfcturCompanyTelno || '').trim(),
            form: [it.ledgElvtrDiv, it.ledgElvtrForm].map(x => String(x || '').trim()).filter(Boolean).join(' · '),
            no: String(it.elvtrUniqueNo || '') });
        });
        if (page * 1000 >= Number(body.totalCount || 0)) break;
      }
      return out;
    });
    return { ok: true, list: list || [] };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

async function siteElevators(list, branch) {
  try {
    const key = env_('DATA_GO_KR_KEY');
    if (!key) return { ok: true, info: {}, note: 'DATA_GO_KR_KEY 없음' };
    const J = juris_(branch);
    list = (Array.isArray(list) ? list : []).slice(0, 25);
    const files = [];
    list.forEach(s => { const f = bookFile_(bookKey_(s.name || '')); if (f && files.indexOf(f) < 0) files.push(f); });
    const shards = {};
    await pool_(files, 8, async f => { shards[f] = await shard_('elv', f); });
    const norm = a => cleanAddr_(a).replace(/\s/g, '');
    const want = {};
    list.forEach(s => {
      const k = bookKey_(s.name || '');
      const m = (shards[bookFile_(k)] || {})[k] || {};
      let addrs = Object.keys(m).filter(a => inJuris_(a, J));
      if (s.addr) {
        const hit = addrs.filter(a => norm(a) === norm(s.addr) || norm(a).indexOf(norm(s.addr)) === 0 || norm(s.addr).indexOf(norm(a)) === 0);
        if (hit.length) addrs = hit;
        else if (s.area) addrs = addrs.filter(a => a.indexOf(s.area) >= 0);
      } else if (s.area) addrs = addrs.filter(a => a.indexOf(s.area) >= 0);
      const nos = (addrs.length === 1 ? m[addrs[0]] : []).concat(s.nos || []);
      want[s.q] = nos.filter((x, i) => x && nos.indexOf(x) === i).slice(0, 60);
    });
    const all = [];
    Object.keys(want).forEach(q => want[q].forEach(n => { if (all.indexOf(n) < 0) all.push(n); }));
    const hit = await cache.getAll(all.map(n => 'elv1:' + n));
    const info = {};
    const miss = all.filter(n => { const h = hit['elv1:' + n]; if (h) info[n] = JSON.parse(h); return !h; }).slice(0, 150);
    const base = 'https://apis.data.go.kr/B553664/ElevatorInformationService/getElevatorViewM?serviceKey=' + encodeURIComponent(key) + '&elevator_no=';
    const put = {};
    await pool_(miss, 10, async n => {
      const t = (await getText_(base + n)).text;
      if (!/<item>/.test(t)) return;
      const g = tag => ((t.match(new RegExp('<' + tag + '>([^<]*)</' + tag + '>')) || [])[1] || '').trim();
      const v = { no: n, ho: g('elvtrAsignNo'), mr: g('mrYn'), form: g('elvtrFormNm'), kind: g('elvtrKindNm'),
        cap: g('ratedCap').replace(/\s+/g, ''), load: g('liveLoad').replace(/\s+/g, ''), floors: g('shuttleFloorCnt'),
        year: g('installationDe').slice(0, 4), model: g('elvtrModel'), stts: g('elvtrStts') };
      info[n] = v;
      put['elv1:' + n] = JSON.stringify(v);
    });
    try { await cache.putAll(put, CACHE_SEC); } catch (e) {}
    const out = {};
    Object.keys(want).forEach(q => {
      const L = want[q].map(n => info[n]).filter(Boolean).filter(v => v.stts !== '철거' && v.stts !== '말소');
      if (!L.length) return;
      const uniq = f => L.map(f).filter((x, i, a) => x && a.indexOf(x) === i);
      out[q] = {
        n: L.length, mr: L.filter(v => v.mr === 'Y').length, mrl: L.filter(v => v.mr === 'N').length,
        forms: uniq(v => v.form), kinds: uniq(v => v.kind), caps: uniq(v => v.cap),
        floors: uniq(v => v.floors), years: uniq(v => v.year).sort(),
        list: L.map(v => ({ no: v.no, ho: v.ho, mr: v.mr, form: v.form, cap: v.cap, year: v.year, model: v.model, floors: v.floors }))
          .sort((a, b) => (parseInt(a.ho, 10) || 999) - (parseInt(b.ho, 10) || 999)),
      };
    });
    return { ok: true, info: out };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

// ════════ 지사 공유 일정표 ════════
const BRANCH_RE = /^[가-힣]{2,12}(지사|출장소)$/;
async function shareWeek(branch, data, force) {
  try {
    branch = String(branch || '').trim();
    if (!BRANCH_RE.test(branch)) throw new Error('지사를 먼저 골라 주세요.');
    if (!data || !Array.isArray(data.days) || !data.days.length) throw new Error('일정표가 비어 있어요.');
    const k = 'WEEK:' + branch;
    const last = data.days.map(d => d.iso).sort().pop();
    const old = JSON.parse((await props.get(k + ':meta')) || 'null');
    if (old && old.last > last && !force) return { ok: false, older: true, message: '지사에 이미 더 최근 일정표(' + old.source + ')가 올라가 있어요.' };
    const json = JSON.stringify({ source: data.source || '', days: data.days });
    if (json.length > 400000) throw new Error('일정표가 너무 커서 공유하지 못했어요.');
    const at = Date.now();
    await redis_([['SET', 'p:' + k, json], ['SET', 'p:' + k + ':meta', JSON.stringify({ branch, at, source: data.source || '', last })]]);
    const all = JSON.parse((await props.get('WEEKS')) || '[]');
    if (all.indexOf(branch) < 0) { all.push(branch); await props.set('WEEKS', JSON.stringify(all)); }
    return { ok: true, at };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}
async function getWeek(branch) {
  try {
    branch = String(branch || '').trim();
    if (!BRANCH_RE.test(branch)) return { ok: false, message: '지사 이름이 올바르지 않아요.' };
    const [json, meta] = await redis_([['GET', 'p:WEEK:' + branch], ['GET', 'p:WEEK:' + branch + ':meta']]);
    if (!json) return { ok: false, message: branch + '에 공유된 일정표가 아직 없어요.' };
    const d = JSON.parse(json), m = JSON.parse(meta || '{}');
    return { ok: true, branch, source: d.source, days: d.days, at: m.at, last: m.last };
  } catch (e) {
    return { ok: false, message: '공유 일정표를 읽지 못했어요: ' + e.message };
  }
}

// ════════ 홈 화면 위젯 ════════
const W_KEY_RE = /^[a-z0-9]{12,32}$/;
async function saveWidget(key, data) {
  try {
    if (!W_KEY_RE.test(String(key || ''))) throw new Error('위젯 키가 올바르지 않습니다.');
    const json = JSON.stringify(Object.assign({}, data, { savedAt: Date.now() }));
    if (json.length > 60000) throw new Error('일정이 너무 커서 위젯에 저장하지 못했습니다.');
    await props.set('W_' + key, json);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}
async function saveWidgetKm(key, iso, km) {
  try {
    if (!W_KEY_RE.test(String(key || ''))) return { ok: false };
    const raw = await props.get('W_' + key);
    if (!raw) return { ok: false };
    const data = JSON.parse(raw);
    (data.days || []).forEach(d => { if (d.iso === iso) d.km = Number(km) || null; });
    await props.set('W_' + key, JSON.stringify(data));
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}
async function deleteWidget(key) {
  if (W_KEY_RE.test(String(key || ''))) await props.del('W_' + key);
  return { ok: true };
}

// 위젯에 보여 줄 날의 현장 좌표·구간 거리가 없으면 찾아서 저장 (처음 한 번만)
async function withCoords_(key, data) {
  try {
    const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
    const targets = (data.days || []).filter(d => d.iso >= today && d.stops && d.stops.length).slice(0, 7);
    const need = [];
    let changed = false;
    const all = [];
    targets.forEach(d => d.stops.forEach(s => all.push(s)));
    const fixes = await siteFixes_(all.map(s => [s.name, s.area]));
    all.forEach((s, i) => {
      const fx = s.name ? fixes[i] : null;
      if (fx && (s.lat !== fx.lat || s.lng !== fx.lng)) { s.lat = fx.lat; s.lng = fx.lng; s.addr = fx.addr; changed = true; }
    });
    all.forEach(s => {
      if (s.lat == null && s.name && !need.some(x => x.q === s.name + '|' + (s.area || ''))) {
        need.push({ q: s.name + '|' + (s.area || ''), area: s.area || '', name: s.name, region: '' });
      }
    });
    let origin = data.origin || null;
    if (data.branch && data.branch[0] && (need.length || !origin)) {
      const o = await getOrigin(data.branch[0], data.branch[1] || '');
      if (o.ok) { origin = o.origin; data.origin = origin; changed = true; }
    }
    if (need.length) {
      const r = await geocodeSites(need, origin, data.branch && data.branch[0]);
      if (r.ok) {
        all.forEach(s => {
          const p = r.places[s.name + '|' + (s.area || '')];
          if (p) { s.lat = p.lat; s.lng = p.lng; if (p.addr) s.addr = p.addr; } else if (s.lat == null) s.lat = false;
        });
        changed = true;
      }
    }
    if (await addLegs_(data, targets)) changed = true;
    if (changed) await props.set('W_' + key, JSON.stringify(data));
  } catch (e) { /* 좌표 없이 보여 줌 */ }
  return data;
}

// 구간 거리: 지사→1번, 1번→2번, …, 마지막→지사. 현장 좌표가 바뀌었을 때만 다시 계산
async function addLegs_(data, targets) {
  const o = data.origin && data.origin.lat ? { lat: +data.origin.lat, lng: +data.origin.lng } : null;
  const key = p => (+p.lat).toFixed(5) + ',' + (+p.lng).toFixed(5);
  let changed = false;
  for (const d of targets) {
    const sig = (o ? key(o) : '') + '|' + d.stops.map(s => (s.lat ? key(s) : 'x')).join(';');
    if (d.legSig === sig) continue;
    let prev = o;
    const pairs = [], map = [];
    d.stops.forEach((s, i) => {
      if (!s.lat) { map[i] = null; return; }
      const p = { lat: +s.lat, lng: +s.lng };
      if (prev && key(prev) === key(p)) { map[i] = 'same'; return; }
      if (!prev) { map[i] = null; prev = p; return; }
      map[i] = pairs.length; pairs.push([prev.lat, prev.lng, p.lat, p.lng]); prev = p;
    });
    let back = null;
    if (o && prev && prev !== o) { back = pairs.length; pairs.push([prev.lat, prev.lng, o.lat, o.lng]); }
    const r = pairs.length ? await routeLegs(pairs) : { ok: true, km: [] };
    if (!r.ok) continue;
    d.legs = map.map(m => (m === null ? null : m === 'same' ? 0 : r.km[m]));
    d.backKm = back != null ? r.km[back] : null;
    d.legKm = Math.round((d.legs.reduce((a, x) => a + (x || 0), 0) + (d.backKm || 0)) * 10) / 10 || null;
    d.legSig = sig;
    changed = true;
  }
  return changed;
}


// ════════ 앱용: 지사 목록 · 이름으로 위젯 데이터 ════════
// 지사 이름·주소 (index.html 의 BRANCHES 와 같게)
const BRANCHES = [
  ['서울남서지사', '서울 구로구 디지털로31길 53'],
  ['서울동부지사', '서울 성동구 천호대로 376'],
  ['서울서부지사', '서울 마포구 토정로 318'],
  ['서울북부지사', '서울 도봉구 삼양로 538-5'],
  ['서울강남지사', '서울 강남구 영동대로 316'],
  ['서울강동지사', '서울 강동구 양재대로 1473'],
  ['서울서초지사', '서울 서초구 서초대로 67'],
  ['서울강서지사', '서울 강서구 공항대로 287'],
  ['부산서부지사', '부산 부산진구 황령대로 24'],
  ['부산동부지사', '부산 해운대구 센텀중앙로 90'],
  ['부산북부지사', '부산 금정구 금정로 252'],
  ['울산지사', '울산 중구 종가로 362-11'],
  ['경남동부지사', '경남 창원시 성산구 원이대로 362'],
  ['경남서부지사', '경남 창원시 마산회원구 3·15대로 685'],
  ['진주출장소', '경남 진주시 신안로 94'],
  ['대구서부지사', '대구 달서구 계대동문로 124'],
  ['대구동부지사', '대구 동구 동대구로 471'],
  ['경북동부지사', '경북 포항시 북구 삼흥로 95'],
  ['경북서부지사', '경북 구미시 이계북로 7'],
  ['인천남부지사', '인천 남동구 논현로46번길 23'],
  ['경기북부지사', '경기 구리시 산마루로 19'],
  ['양주출장소', '경기 양주시 옥정동로7가길 30'],
  ['고양파주지사', '경기 고양시 일산서구 킨텍스로 217-59'],
  ['인천동부지사', '인천 부평구 무네미로 478'],
  ['안산지사', '경기 안산시 상록구 해안로 705'],
  ['인천서부지사', '인천 서구 원당대로 676'],
  ['수원지사', '경기 수원시 영통구 광교로 146'],
  ['성남지사', '경기 성남시 분당구 백현로 97'],
  ['안양지사', '경기 안양시 만안구 안양로 119'],
  ['용인지사', '경기 용인시 기흥구 관곡로64번길 18'],
  ['평택안성지사', '경기 평택시 경기대로 1377'],
  ['화성오산지사', '경기 화성시 병점2로 12'],
  ['강원지사', '강원 원주시 호저로 47'],
  ['강릉출장소', '강원 강릉시 강릉대로 317'],
  ['춘천출장소', '강원 춘천시 안마산로 99'],
  ['대전지사', '대전 유성구 도안북로 57'],
  ['세종지사', '세종특별자치시 한누리대로 169'],
  ['충북지사', '충북 청주시 상당구 중흥로 16'],
  ['충남지사', '충남 아산시 배방읍 희망로46번길 45-31'],
  ['천안지사', '충남 천안시 동남구 신촌2길 5-4'],
  ['광주지사', '광주 서구 죽봉대로 52'],
  ['전북동부지사', '전북특별자치도 전주시 덕진구 팔과정로 164'],
  ['전북서부지사', '전북 익산시 익산대로16길 39'],
  ['전남동부지사', '전남 순천시 중앙로 260'],
  ['전남서부지사', '광주 광산구 무진대로 282'],
  ['제주지사', '제주 제주시 연삼로 473']
];

// 일정이 공유된 지사들 → [{ branch, source, last, at }] (최신 순)
async function listWeeks() {
  try {
    const list = JSON.parse((await props.get('WEEKS')) || '[]');
    const metas = list.length ? (await redis_([['MGET', ...list.map(b => 'p:WEEK:' + b + ':meta')]]))[0] : [];
    const out = list.map((b, i) => Object.assign({ branch: b }, JSON.parse(metas[i] || '{}'))).filter(x => x.last);
    out.sort((a, b) => (b.at || 0) - (a.at || 0));
    return { ok: true, list: out };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

// 화면(index.html)의 mine()·mdow() 와 같은 규칙으로 한 사람의 주간 일정 → 위젯 저장 형식
const bare_ = s => String(s || '').replace(/\(.*?\)/g, '').trim();
const placeName_ = n => {
  n = String(n || '');
  return n.replace(/\(주\)|㈜/g, '').replace(/\([^)]*$/, '').replace(/\s*[A-Z0-9,\s]+동(,\s*[A-Z0-9]+동)*\s*$/, '')
    .replace(/\s+/g, ' ').trim() || n;
};
function personWeek_(week, branch, name) {
  const dows = '일월화수목금토';
  const b = BRANCHES.find(x => x[0] === branch) || [branch, ''];
  return {
    name, branch: [b[0], b[1]], src: 'week:' + (week.at || ''),
    days: (week.days || []).map(d => {
      const t = (d.teams || []).find(t => (t.members || []).some(m => bare_(m) === name));
      const [y, m, dd] = d.iso.split('-').map(Number);
      return {
        iso: d.iso, label: m + '/' + dd + '(' + dows[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()] + ')',
        off: (d.vacation || []).some(v => bare_(v) === name),
        team: t ? t.team : '', mates: t ? t.members.map(bare_).filter(x => x !== name) : [],
        stops: t ? t.stops.map(s => ({ time: s.time, kind: s.kind, area: s.area, name: placeName_(s.name), units: s.units })) : [],
      };
    }),
  };
}
function nameKey_(branch, name) {
  return 'n' + require('crypto').createHash('sha1').update(branch + '|' + name).digest('hex').slice(0, 24);
}
// GET /api/w?b=지사&n=이름 → 공유된 일정표에서 그 사람 일정으로 위젯 (좌표·거리는 처음 한 번 찾아 저장)
async function widgetByName(branch, name, fmt) {
  const wk = await getWeek(branch);
  name = String(name || '').trim().slice(0, 20);
  if (!wk.ok || !name) return { type: 'application/json; charset=utf-8', body: JSON.stringify({ ok: false, title: wk.ok ? '이름이 없어요' : '아직 공유된 일정표가 없어요', text: wk.ok ? '앱에서 이름을 다시 골라 주세요.' : '지사에서 누군가 일정표를 올리면 나와요.' }) };
  const key = nameKey_(branch, name);
  const raw = await props.get('W_' + key);
  const old = raw ? JSON.parse(raw) : null;
  const src = 'week:' + (wk.at || '');
  if (!old || old.src !== src) {
    const data = personWeek_(wk, branch, name);
    // 같은 현장 좌표는 예전 것을 그대로 써서 다시 찾지 않음
    if (old) {
      const memo = {};
      (old.days || []).forEach(d => (d.stops || []).forEach(s => { if (s.lat) memo[s.name + '|' + (s.area || '')] = s; }));
      data.days.forEach(d => d.stops.forEach(s => { const m = memo[s.name + '|' + (s.area || '')]; if (m) { s.lat = m.lat; s.lng = m.lng; s.addr = m.addr; } }));
      if (old.origin) data.origin = old.origin;
    }
    data.savedAt = wk.at || Date.now();
    await props.set('W_' + key, JSON.stringify(data));
  }
  return widget(key, fmt);
}

// GET /?w=키 → 위젯 JSON (fmt=text 줄글, view=1 화면)
async function widget(key, fmt) {
  const raw = W_KEY_RE.test(key) ? await props.get('W_' + key) : null;
  const out = raw ? widgetView_(await withCoords_(key, JSON.parse(raw)))
    : { ok: false, title: '위젯 주소가 올바르지 않아요', text: '웹앱에서 일정표를 올린 뒤 위젯 주소를 다시 복사하세요.' };
  if (fmt === 'view') return { type: 'text/html; charset=utf-8', body: widgetHtml_(out) };
  if (fmt === 'text') return { type: 'text/plain; charset=utf-8', body: out.text || out.title };
  return { type: 'application/json; charset=utf-8', body: JSON.stringify(out) };
}

// 화면이 부를 수 있는 함수 (google.script.run 대신 /api/rpc)
const RPC = { listWeeks, getConfig, latestVer, getOrigin, guessBranch, geocodeSites, setSiteAddr, clearSiteAddr, dayBundle, routeLegs,
  recptnList, siteElevators, shareWeek, getWeek, saveWidget, saveWidgetKm, deleteWidget };

// 웹앱 주소: 미리보기 주소로 열어도 위젯·공유 링크는 정식 주소로 (Vercel이 넣어 주는 VERCEL_PROJECT_PRODUCTION_URL)
function setAppUrl(u) {
  const prod = env_('APP_URL') || (env_('VERCEL_PROJECT_PRODUCTION_URL') ? 'https://' + env_('VERCEL_PROJECT_PRODUCTION_URL') + '/' : '');
  APP_URL = prod ? prod.replace(/\/?$/, '/') : u;
}

module.exports = { RPC, widget, widgetByName, setAppUrl, SERVER_VER,
  _t: { juris_, inJuris_, bookKey_, bookFile_, widgetView_, addLegs_, redis_, MEM } };
