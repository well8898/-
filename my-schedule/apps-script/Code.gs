/**
 * 내 검사 일정 — 별도 Apps Script 웹앱 (여비 청구 웹앱과 무관한 새 프로젝트)
 *
 * ▶ 파일: Code.gs(이 파일) + Index(HTML). Index 파일이 없으면 화면을 GitHub에서 읽어 옴 (PAGE_URL)
 * ▶ 스크립트 속성 (프로젝트 설정 → 스크립트 속성)
 *   - KAKAO_REST_API_KEY : 카카오 REST API 키 (현장 위치 검색·자동차 길찾기)
 *   - KAKAO_JS_KEY       : 카카오 JavaScript 키 (화면 지도)
 *   - TMAP_APP_KEY       : (선택) SK open API 티맵 앱키 — 있으면 구간 거리·시간을 티맵 추천경로로
 *   - DATA_GO_KR_KEY     : (선택) 공공데이터포털 인증키 — 승강기검사접수정보로 현장 실주소 찾기
 *                          카카오 디벨로퍼스 → 앱 → 플랫폼 → Web 사이트 도메인에 웹앱 도메인 등록
 * ▶ 출발 지사는 화면에서 정함 (일정표 제목 → 지난번 선택 → 현장 동네로 추측 → 직접 선택)
 */

const CACHE_SEC = 21600;   // 6시간
const REGION_KM = 50;      // 지사에서 이 거리(km) 밖의 검색 결과는 버림 (관할 지역 안에서만 핀)

// 화면(HTML): 이 프로젝트에 Index 파일이 있으면 그것을 쓰고, 없으면 GitHub에서 읽어 옴
const PAGE_URL = 'https://raw.githubusercontent.com/well8898/-/'
  + 'my-schedule/my-schedule/apps-script/Index.html';
// 건물 주소록: 승강기 설치 현황(공공데이터) → 건물명별 주소, 128조각으로 나눈 JSON
const SERVER_VER = '10.16c'; // 화면 아래에 표시 — 배포가 최신인지 확인용
const ELV_URL = 'https://raw.githubusercontent.com/well8898/-/my-schedule/my-schedule/data/elv/'; // 건물별 승강기 고유번호
const BOOK_URL = 'https://raw.githubusercontent.com/well8898/-/'
  + 'my-schedule/my-schedule/data/bld/';

function doGet(e) {
  if (e && e.parameter && e.parameter.w) return widgetOutput_(e); // 홈 화면 위젯
  let html = pageHtml_();
  // 위젯에서 현장을 눌러 열 때 ?d=2026-10-16 → 그날 하루 보기로 시작
  const day = e && e.parameter && String(e.parameter.d || '');
  // 설정을 화면에 바로 넣어 getConfig 왕복을 없앰 ('//'는 앱스 스크립트가 주석으로 잘라서 '\/'로)
  let inject = 'window.CFG=' + JSON.stringify(getConfig()).replace(/</g, '\\u003c').replace(/\//g, '\\/') + ';';
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) inject += 'window.START_DAY="' + day + '";';
  html = html.replace('<head>', '<head><script>' + inject + '</script>');
  return HtmlService.createHtmlOutput(html)
    .setTitle('내 검사 일정')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

function pageHtml_() {
  try {
    return HtmlService.createHtmlOutputFromFile('Index').getContent();
  } catch (e) { /* Index 파일 없음 → GitHub */ }
  const cache = CacheService.getScriptCache();
  // 서버 버전이 바뀌면(새로 배포하면) 저장해 둔 화면을 버리고 GitHub에서 새로 받음
  const pk = 'page:' + SERVER_VER;
  const hit = cache.get(pk);
  if (hit) return hit;
  const res = UrlFetchApp.fetch(PAGE_URL, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    throw new Error('Index 파일이 없고 GitHub에서도 화면을 읽지 못했습니다: ' + PAGE_URL);
  }
  const html = res.getContentText('UTF-8');
  try { cache.put(pk, html, 3600); } catch (e) { /* 너무 크면 캐시 생략 */ }
  return html;
}

// 화면 시작 시: 지도 키
function getConfig() {
  try {
    const props = PropertiesService.getScriptProperties();
    const key = props.getProperty('KAKAO_JS_KEY') || '';
    // 티맵 앱키는 '티맵 길안내' 버튼(티맵 앱 실행 링크)에도 씀
    let webUrl = '';
    try { webUrl = ScriptApp.getService().getUrl(); } catch (e) { /* 배포 전 */ }
    return { ok: true, kakaoJsKey: key.trim(), tmapKey: (props.getProperty('TMAP_APP_KEY') || '').trim(), webUrl: webUrl, ver: SERVER_VER };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

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

// 지사 이름·주소 → { ok, origin: { lat, lng, name } }  (좌표는 스크립트 속성에 영구 저장)
function getOrigin(name, address) {
  try {
    const p = branchPoint_(name, address);
    if (!p) throw new Error('지사 주소를 찾지 못했습니다: ' + address);
    return { ok: true, origin: { lat: p.lat, lng: p.lng, name: name }, juris: JURIS[name] || '' };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

// 지사 좌표는 스크립트 속성 BRANCH_POINTS 하나에 모아서 저장 ({ 지사이름: {lat,lng} })
function branchPoint_(name, address) {
  const props = PropertiesService.getScriptProperties();
  const all = JSON.parse(props.getProperty('BRANCH_POINTS') || '{}');
  if (all[name]) return all[name];
  const q = String(address || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  const ad = kakaoGet_('https://dapi.kakao.com/v2/local/search/address.json?size=1&query=' + encodeURIComponent(q));
  let d = (ad.documents || [])[0];
  if (!d) {
    const kw = kakaoGet_('https://dapi.kakao.com/v2/local/search/keyword.json?size=1&query='
      + encodeURIComponent('한국승강기안전공단 ' + name));
    d = (kw.documents || [])[0];
  }
  if (!d) return null;
  all[name] = { lat: Number(d.y), lng: Number(d.x) };
  props.setProperty('BRANCH_POINTS', JSON.stringify(all));
  return all[name];
}

// 예전 버전이 지사마다 만든 BR_… 속성을 BRANCH_POINTS 하나로 합치고 지움 (속성 50개 넘김 해결)
// 편집기에서 한 번 실행하세요
function cleanupProperties() {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperties();
  const all = JSON.parse(raw.BRANCH_POINTS || '{}');
  let n = 0;
  Object.keys(raw).forEach(k => {
    if (k.indexOf('BR_') !== 0) return;
    try { all[k.slice(3)] = JSON.parse(raw[k]); } catch (e) { /* 버림 */ }
    props.deleteProperty(k);
    n++;
  });
  props.setProperty('BRANCH_POINTS', JSON.stringify(all));
  Logger.log('정리한 속성 ' + n + '개 · 남은 속성 ' + Object.keys(props.getProperties()).length + '개');
}

// 아직 좌표가 없는 지사들의 주소를 한꺼번에(병렬) 검색해 BRANCH_POINTS에 저장
function prefetchBranches_(branches) {
  const props = PropertiesService.getScriptProperties();
  const all = JSON.parse(props.getProperty('BRANCH_POINTS') || '{}');
  const miss = (Array.isArray(branches) ? branches : []).filter(b => !all[b[0]]);
  if (!miss.length) return;
  const key = getKakaoKey_();
  const res = UrlFetchApp.fetchAll(miss.map(b => ({
    url: 'https://dapi.kakao.com/v2/local/search/address.json?size=1&query='
      + encodeURIComponent(String(b[1] || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()),
    headers: { Authorization: 'KakaoAK ' + key }, muteHttpExceptions: true,
  })));
  res.forEach((r, i) => {
    try {
      const d = (JSON.parse(r.getContentText()).documents || [])[0];
      if (d) all[miss[i][0]] = { lat: Number(d.y), lng: Number(d.x) };
    } catch (e) { /* 이 지사는 나중에 개별 검색 */ }
  });
  props.setProperty('BRANCH_POINTS', JSON.stringify(all));
}

// 현장이 많은 동·읍·면 이름들 → 그 동네들과 가장 잘 맞는 지사
// areas: ['북면', '삼계동', ...]  branches: [[이름, 주소], ...]  → { ok, branch, hits }
function guessBranch(areas, branches) {
  try {
    const list = (Array.isArray(areas) ? areas : []).slice(0, 10);
    // 동네 이름마다 전국의 같은 이름 후보 (주소, 좌표)
    const cands = list.map(a => cached_('area2:' + a, () => {
      const r = kakaoGet_('https://dapi.kakao.com/v2/local/search/address.json?size=30&query=' + encodeURIComponent(a));
      return (r.documents || [])
        .filter(d => (d.address_name || '').split(' ').pop() === a)
        .map(d => [Number(d.y), Number(d.x), d.address_name]);
    }) || []);
    prefetchBranches_(branches);
    // 1순위: 그 동네들이 관할구역 안에 가장 많이 드는 지사, 2순위: 지사에서 35km 안에 있는 동네 수, 3순위: 거리 합
    let best = null;
    (Array.isArray(branches) ? branches : []).forEach(b => {
      const J = juris_(b[0]);
      let p = null;
      try { p = branchPoint_(b[0], b[1]); } catch (e) { /* 건너뜀 */ }
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

// sites: [{ q: 검색어, region, area: '삼계동', name: '김해북부두산위브아파트' }]  origin: 지사 좌표
// → { ok, places: { 검색어: { lat, lng, name } } }   못 찾은 현장·관할 밖 결과는 빠짐
function geocodeSites(sites, origin, branch) {
  try {
    const places = {};
    const o = origin && origin.lat ? origin : null;
    const J = juris_(branch || (o && o.name));
    const list = (Array.isArray(sites) ? sites : []).slice(0, 60);
    const ckOf = s => 'site4:' + String((s && s.q) || '').trim() + '|' + (s.addr || '') + '@' + (J ? JSON.stringify(J) : o ? o.lat.toFixed(3) + ',' + o.lng.toFixed(3) : '');
    prefetchBook_(list.filter(s => !s.addr && !siteFix_(s.name || s.q, s.area)).map(ckOf), list);
    list.forEach(s => {
      const q = String((s && s.q) || '').trim();
      if (!q || q in places) return;
      // 누군가 직접 넣어 둔 주소가 있으면 그것을 먼저
      const fx = siteFix_(s.name || q, s.area);
      if (fx) { places[q] = fx; return; }
      let p = null;
      const ck = ckOf(s);
      try { p = cached_(ck, () => findSite_(s, o, J)); } catch (e) { /* 이 현장만 건너뜀 */ }
      if (p) places[q] = p;
    });
    return { ok: true, places: places };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

// ── 현장 주소 직접 지정 (주소를 못 찾거나 틀린 현장을 한 번 고치면 모두 함께 씀) ──
// 스크립트 속성 SITE_FIX_0 ~ SITE_FIX_7 에 { 건물키|동: { a: 주소, y: 위도, x: 경도, t: 날짜 } } 로 나눠 저장
const FIX_SHARDS = 8;
const FIX_MEMO = {};

function fixKey_(name, area) {
  return bookKey_(name) + '|' + String(area || '').trim();
}

function fixProp_(k) {
  let v = 5381;
  for (let i = 0; i < k.length; i++) v = (v * 33 + k.charCodeAt(i)) % 4294967296;
  return 'SITE_FIX_' + (v % FIX_SHARDS);
}

function fixShard_(prop) {
  if (!(prop in FIX_MEMO)) {
    try {
      FIX_MEMO[prop] = JSON.parse(PropertiesService.getScriptProperties().getProperty(prop) || '{}');
    } catch (e) {
      FIX_MEMO[prop] = {};
    }
  }
  return FIX_MEMO[prop];
}

function siteFix_(name, area) {
  const k = fixKey_(name, area);
  if (k.length < 3) return null;
  const f = fixShard_(fixProp_(k))[k];
  return f ? { lat: f.y, lng: f.x, name: String(name || ''), addr: f.a, fixed: true } : null;
}

// 화면에서 호출: 현장 주소를 직접 지정 (도로명·지번 주소 또는 건물·상호 이름)
// → { ok, place: { lat, lng, name, addr, fixed } }
function setSiteAddr(name, area, text, origin, branch) {
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
    const ad = kakaoGet_(base + 'address.json?size=5&query=' + encodeURIComponent(cleanAddr_(text)));
    const d = (ad.documents || []).find(near);
    if (d) {
      const road = d.road_address && d.road_address.address_name;
      hit = { y: Number(d.y), x: Number(d.x), a: road || d.address_name || text };
    } else {
      const nq = o ? '&x=' + o.lng + '&y=' + o.lat + '&sort=distance' : '';
      const kw = kakaoGet_(base + 'keyword.json?size=5&query=' + encodeURIComponent(text) + nq);
      const k = (kw.documents || []).find(near);
      if (k) hit = { y: Number(k.y), x: Number(k.x), a: k.road_address_name || k.address_name || text };
    }
    if (!hit) return { ok: false, message: J ? '관할구역(' + JURIS[branch || o.name] + ') 안에서 그 주소를 찾지 못했어요. 도로명·지번 주소로 다시 넣어 주세요.' : '그 주소를 지도에서 찾지 못했어요. 도로명·지번 주소로 다시 넣어 주세요.' };
    hit.t = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
    const k = fixKey_(name, area);
    const prop = fixProp_(k);
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      delete FIX_MEMO[prop];
      const m = fixShard_(prop);
      m[k] = hit;
      PropertiesService.getScriptProperties().setProperty(prop, JSON.stringify(m));
    } finally {
      lock.releaseLock();
    }
    return { ok: true, place: { lat: hit.y, lng: hit.x, name: name, addr: hit.a, fixed: true } };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

// 화면에서 호출: 직접 지정한 주소 지우기 (다시 자동으로 찾음)
function clearSiteAddr(name, area) {
  try {
    const k = fixKey_(name, area);
    const prop = fixProp_(k);
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      delete FIX_MEMO[prop];
      const m = fixShard_(prop);
      delete m[k];
      PropertiesService.getScriptProperties().setProperty(prop, JSON.stringify(m));
    } finally {
      lock.releaseLock();
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

// 화면에서 호출: 하루 보기에 필요한 것을 한 번에 — 현장 위치 찾기 + 방문 순서대로 구간 거리
// (예전엔 geocodeSites → routeLegs 를 따로 불러 왕복이 여러 번이었음)
// order: 방문 순서 [{ q, lat?, lng? }] (화면이 이미 아는 좌표는 같이 보냄)
// → { ok, places: { q: {lat,lng,…} }, legs: { '위도,경도>위도,경도': { km, min } }, src }
function dayBundle(need, origin, branch, order) {
  try {
    const g = geocodeSites(need || [], origin, branch);
    if (!g.ok) return g;
    const key = p => Number(p.lat).toFixed(5) + ',' + Number(p.lng).toFixed(5);
    const stops = [];
    (Array.isArray(order) ? order : []).forEach(x => {
      const p = x && x.lat != null ? x : g.places[x && x.q];
      if (!p || !p.lat) return;
      const last = stops[stops.length - 1];
      if (last && key(last) === key(p)) return; // 같은 건물 연속은 하나로
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
      const r = routeLegs(pairs);
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

// ── 현장 승강기 정보 (기계실 MR/MRL, 형식, 인승, 층수, 설치연도) ──
// list: [{ q, name, area, addr, nos: [검사접수에서 찾은 고유번호] }]  branch: 지사 이름(관할 확인용)
// 고유번호: 검사접수 번호 + 설치현황 CSV(data/elv)에서 건물명·주소로 찾은 번호
// → { ok, info: { q: { n, mr, mrl, forms, kinds, caps, floors, years, list: [{ no, ho, mr, form, cap, year }] } } }
function siteElevators(list, branch) {
  try {
    const key = (PropertiesService.getScriptProperties().getProperty('DATA_GO_KR_KEY') || '').trim();
    if (!key) return { ok: true, info: {}, note: 'DATA_GO_KR_KEY 없음' };
    const J = juris_(branch);
    list = (Array.isArray(list) ? list : []).slice(0, 25);
    // 1) 설치현황 조각 파일을 한꺼번에 받기
    const files = [];
    list.forEach(s => { const f = bookFile_(bookKey_(s.name || '')); if (f && files.indexOf(f) < 0) files.push(f); });
    const shards = {};
    const res = UrlFetchApp.fetchAll(files.map(f => ({ url: ELV_URL + f, muteHttpExceptions: true })));
    res.forEach((r, i) => { try { if (r.getResponseCode() === 200) shards[files[i]] = JSON.parse(r.getContentText('UTF-8')); } catch (e) {} });
    const norm = a => cleanAddr_(a).replace(/\s/g, '');
    const want = {}; // q → [번호]
    list.forEach(s => {
      const k = bookKey_(s.name || '');
      const m = (shards[bookFile_(k)] || {})[k] || {};
      let addrs = Object.keys(m).filter(a => inJuris_(a, J));
      if (s.addr) {
        const hit = addrs.filter(a => norm(a) === norm(s.addr) || norm(a).indexOf(norm(s.addr)) === 0 || norm(s.addr).indexOf(norm(a)) === 0);
        if (hit.length) addrs = hit;
        else if (s.area) addrs = addrs.filter(a => a.indexOf(s.area) >= 0);
      } else if (s.area) addrs = addrs.filter(a => a.indexOf(s.area) >= 0);
      // 같은 이름 건물이 여러 곳이면 틀릴 수 있어 한 곳일 때만
      const nos = (addrs.length === 1 ? m[addrs[0]] : []).concat(s.nos || []);
      want[s.q] = nos.filter((x, i) => x && nos.indexOf(x) === i).slice(0, 60);
    });
    // 2) 번호마다 승강기 정보 (6시간 캐시, 없는 것만 한꺼번에)
    const all = [];
    Object.keys(want).forEach(q => want[q].forEach(n => { if (all.indexOf(n) < 0) all.push(n); }));
    const cache = CacheService.getScriptCache();
    const hit = all.length ? cache.getAll(all.map(n => 'elv1:' + n)) : {};
    const info = {};
    const miss = all.filter(n => { const h = hit['elv1:' + n]; if (h) info[n] = JSON.parse(h); return !h; }).slice(0, 150);
    const base = 'https://apis.data.go.kr/B553664/ElevatorInformationService/getElevatorViewM?serviceKey=' + encodeURIComponent(key) + '&elevator_no=';
    const rs = miss.length ? UrlFetchApp.fetchAll(miss.map(n => ({ url: base + n, muteHttpExceptions: true }))) : [];
    const put = {};
    rs.forEach((r, i) => {
      const t = r.getContentText();
      if (!/<item>/.test(t)) return;
      const g = tag => ((t.match(new RegExp('<' + tag + '>([^<]*)</' + tag + '>')) || [])[1] || '').trim();
      const v = { no: miss[i], ho: g('elvtrAsignNo'), mr: g('mrYn'), form: g('elvtrFormNm'), kind: g('elvtrKindNm'),
        cap: g('ratedCap').replace(/\s+/g, ''), load: g('liveLoad').replace(/\s+/g, ''), floors: g('shuttleFloorCnt'),
        year: g('installationDe').slice(0, 4), model: g('elvtrModel'), stts: g('elvtrStts') };
      info[miss[i]] = v;
      put['elv1:' + miss[i]] = JSON.stringify(v);
    });
    try { if (Object.keys(put).length) cache.putAll(put, CACHE_SEC); } catch (e) {}
    // 3) 현장별로 묶기
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
          .sort((a, b) => (parseInt(a.ho, 10) || 999) - (parseInt(b.ho, 10) || 999))
      };
    });
    return { ok: true, info: out };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

// 상호 검색 결과 중 일정표의 동·읍·면에 있고, 지사 관할구역 안인 곳 (관할 정보가 없으면 REGION_KM 안)
function findSite_(s, o, J) {
  const base = 'https://dapi.kakao.com/v2/local/search/';
  const area = String(s.area || '').trim();
  const name = String(s.name || '').trim();
  const near = o ? '&x=' + o.lng + '&y=' + o.lat + '&sort=distance' : '';
  const ok = d => {
    const a = ' ' + (d.address_name || '') + ' ' + (d.road_address_name || '');
    if (area && a.indexOf(' ' + area) < 0) return false;
    return inArea_(d, o, J);
  };
  // 실주소: 검사접수정보(정밀·설치·수시)에서 찾은 것 → 없으면 건물 주소록(정기 포함 전체)
  if (!s.addr) {
    const all = bookCandidates_(name, area);
    const inj = all.filter(a => inJuris_(a, J));
    const cands = J ? inj : all;
    for (let i = 0; i < Math.min(cands.length, 5); i++) {
      const p = addrPoint_(cands[i], o, J);
      if (p) return { lat: p.lat, lng: p.lng, name: name, addr: cands[i] };
    }
  }
  if (s.addr) {
    const ad = kakaoGet_(base + 'address.json?size=3&query=' + encodeURIComponent(cleanAddr_(s.addr)));
    const d = (ad.documents || []).find(x => inArea_(x, o, J));
    if (d) return { lat: Number(d.y), lng: Number(d.x), name: name, addr: s.addr };
    const kw = kakaoGet_(base + 'keyword.json?size=5&query=' + encodeURIComponent(cleanAddr_(s.addr)) + near);
    const k = (kw.documents || []).find(x => inArea_(x, o, J));
    if (k) return { lat: Number(k.y), lng: Number(k.x), name: name, addr: s.addr };
  }
  const queries = [String(s.q || ''), area + ' ' + name, name].filter(Boolean);
  for (let i = 0; i < queries.length; i++) {
    const kw = kakaoGet_(base + 'keyword.json?size=15&query=' + encodeURIComponent(queries[i]) + near);
    const d = (kw.documents || []).find(ok);
    if (d) return { lat: Number(d.y), lng: Number(d.x), name: d.place_name || name };
  }
  // 이름이 지번·도로명 주소인 경우 (예: 덕은동746, 지축4로 37)
  if (/\d/.test(name)) {
    const q = [s.region, area, name.indexOf(area) === 0 ? name.slice(area.length) : name].filter(Boolean).join(' ');
    const ad = kakaoGet_(base + 'address.json?size=5&query=' + encodeURIComponent(q));
    const d = (ad.documents || []).find(ok);
    if (d) return { lat: Number(d.y), lng: Number(d.x), name: name };
  }
  return null;
}

// ── 승강기검사접수정보 (공공데이터포털 ElevatorRecptnService) ──
// 검사 예정일 기간의 접수 건 → 건물명·실주소 목록. 지사 이름을 주면 그 지사 건만
// → { ok, list: [{ d: 'yyyyMMdd', nm: 건물명, addr: 주소, kind: 정기/정밀/수시/설치 }] }
function recptnList(st, en, branch) {
  try {
    const key = (PropertiesService.getScriptProperties().getProperty('DATA_GO_KR_KEY') || '').trim();
    if (!key) return { ok: true, list: [], note: 'DATA_GO_KR_KEY 없음' };
    const list = cached_('recptn5:' + st + '-' + en + ':' + (branch || ''), () => {
      const out = [];
      for (let page = 1; page <= 10; page++) {
        const url = 'https://apis.data.go.kr/B553664/ElevatorRecptnService/getRecptnV1'
          + '?serviceKey=' + encodeURIComponent(key) + '&_type=json&numOfRows=1000&pageNo=' + page
          + '&inspct_st_de=' + st + '&inspct_en_de=' + en;
        const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
        if (res.getResponseCode() !== 200) throw new Error('검사접수정보 오류(' + res.getResponseCode() + ')');
        const body = (JSON.parse(res.getContentText('UTF-8')).response || {}).body || {};
        let items = (body.items && body.items.item) || [];
        if (!Array.isArray(items)) items = [items];
        items.forEach(it => {
          if (branch && String(it.inspctInsttNm || '') !== branch) return;
          out.push({ d: String(it.inspctDt), nm: String(it.buldNm || '').trim(),
            addr: String(it.address || '').trim(), kind: String(it.inspctKindNm || ''),
            inst: String(it.inspctInsttNm || '').trim(),
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

// 주소 → 좌표 (관할 안일 때만. 관할 정보가 없으면 지사에서 REGION_KM 안)
function addrPoint_(addr, o, J) {
  const base = 'https://dapi.kakao.com/v2/local/search/';
  const ad = kakaoGet_(base + 'address.json?size=3&query=' + encodeURIComponent(cleanAddr_(addr)));
  const d = (ad.documents || []).find(x => inArea_(x, o, J));
  return d ? { lat: Number(d.y), lng: Number(d.x) } : null;
}

const BOOK_SHARDS = {}; // 한 번 실행 동안 받은 주소록 조각

// 캐시에 없는 현장들이 쓸 주소록 조각을 한꺼번에(병렬) 받아 둠 — 하나씩 받으면 조각마다 0.3~0.5초
function prefetchBook_(cacheKeys, list) {
  try {
    const cache = CacheService.getScriptCache();
    const hashed = cacheKeys.map(k => Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, k, Utilities.Charset.UTF_8)));
    const hit = cache.getAll(hashed);
    const files = [];
    list.forEach((s, i) => {
      if (i >= hashed.length || hit[hashed[i]]) return;
      const f = bookFile_(bookKey_(s.name || ''));
      if (f && !BOOK_SHARDS[f] && files.indexOf(f) < 0) files.push(f);
    });
    if (!files.length) return;
    const res = UrlFetchApp.fetchAll(files.map(f => ({ url: BOOK_URL + f, muteHttpExceptions: true })));
    res.forEach((r, i) => {
      try {
        if (r.getResponseCode() === 200) BOOK_SHARDS[files[i]] = JSON.parse(r.getContentText('UTF-8'));
      } catch (e) { /* 그 조각은 나중에 하나씩 */ }
    });
  } catch (e) { /* 미리 받기 실패해도 하나씩 받으면 됨 */ }
}

// 주소록 키 → 조각 파일 이름 (data/bld/NNN.json)
function bookFile_(k) {
  if (!k || k.length < 2) return '';
  let v = 5381;
  for (let i = 0; i < k.length; i++) v = (v * 33 + k.charCodeAt(i)) % 4294967296;
  return ('00' + (v % 128)).slice(-3) + '.json';
}

// 건물 주소록에서 건물명으로 주소 후보 (일정표의 동이 들어간 주소를 앞으로)
function bookCandidates_(name, area) {
  const k = bookKey_(name);
  if (k.length < 2) return [];
  const file = bookFile_(k);
  let shard = BOOK_SHARDS[file];
  if (!shard) {
    try {
      const res = UrlFetchApp.fetch(BOOK_URL + file, { muteHttpExceptions: true });
      if (res.getResponseCode() !== 200) return [];
      shard = BOOK_SHARDS[file] = JSON.parse(res.getContentText('UTF-8'));
    } catch (e) {
      return [];
    }
  }
  const list = shard[k] || [];
  if (!area) return list;
  const hit = list.filter(a => a.indexOf(area) >= 0);
  return hit.length ? hit : list;
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

// pairs: [[출발 위도, 경도, 도착 위도, 경도], ...]
// → { ok, km: [구간 km(소수 1자리) | null], min: [구간 분 | null], src: 'TMAP' | '카카오' }  자동차 추천경로
// 스크립트 속성 TMAP_APP_KEY 가 있으면 티맵, 없거나 실패한 구간은 카카오내비. 캐시 없는 구간은 한꺼번에(병렬) 요청
function routeLegs(pairs) {
  try {
    const tmapKey = (PropertiesService.getScriptProperties().getProperty('TMAP_APP_KEY') || '').trim();
    const list = (Array.isArray(pairs) ? pairs : []).slice(0, 30);
    const cache = CacheService.getScriptCache();
    const ids = list.map(p => 'leg3:' + p.map(v => Number(v).toFixed(5)).join(','));
    const hit = cache.getAll(ids);
    const out = list.map((p, i) => (hit[ids[i]] ? JSON.parse(hit[ids[i]]) : null));
    let src = tmapKey ? 'TMAP' : '카카오';
    const todo = () => out.map((r, i) => (r ? -1 : i)).filter(i => i >= 0);
    todo().forEach(i => {
      const p = list[i];
      if (Math.abs(p[0] - p[2]) < 1e-5 && Math.abs(p[1] - p[3]) < 1e-5) out[i] = { km: 0, min: 0 };
    });
    if (tmapKey && todo().length) {
      const idx = todo();
      const res = UrlFetchApp.fetchAll(idx.map(i => ({
        url: 'https://apis.openapi.sk.com/tmap/routes?version=1&format=json',
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { appKey: tmapKey },
        payload: JSON.stringify({ startX: String(list[i][1]), startY: String(list[i][0]),
          endX: String(list[i][3]), endY: String(list[i][2]),
          reqCoordType: 'WGS84GEO', resCoordType: 'WGS84GEO', searchOption: '0' }),
      })));
      res.forEach((r, n) => {
        try {
          if (r.getResponseCode() !== 200) return;
          const f = (JSON.parse(r.getContentText()).features || [])[0];
          const pr = f && f.properties;
          if (pr && pr.totalDistance != null) {
            out[idx[n]] = { km: Math.round(pr.totalDistance / 100) / 10, min: Math.round((pr.totalTime || 0) / 60) };
          }
        } catch (e) { /* 이 구간은 카카오로 */ }
      });
    }
    if (todo().length) {
      const key = getKakaoKey_();
      const idx = todo();
      const res = UrlFetchApp.fetchAll(idx.map(i => ({
        url: 'https://apis-navi.kakaomobility.com/v1/directions?origin=' + list[i][1] + ',' + list[i][0]
          + '&destination=' + list[i][3] + ',' + list[i][2] + '&priority=RECOMMEND',
        headers: { Authorization: 'KakaoAK ' + key }, muteHttpExceptions: true,
      })));
      res.forEach((r, n) => {
        try {
          const route = (JSON.parse(r.getContentText()).routes || [])[0];
          if (!route) return;
          if (route.result_code === 104) out[idx[n]] = { km: 0, min: 0 };
          else if (route.result_code === 0) {
            out[idx[n]] = { km: Math.round(route.summary.distance / 100) / 10,
              min: Math.round(route.summary.duration / 60) };
          }
          if (tmapKey && out[idx[n]]) src = 'TMAP·카카오';
        } catch (e) { /* 계산 실패 구간 */ }
      });
    }
    const put = {};
    out.forEach((r, i) => { if (r && !hit[ids[i]]) put[ids[i]] = JSON.stringify(r); });
    if (Object.keys(put).length) {
      try { cache.putAll(put, CACHE_SEC); } catch (e) { /* 생략 */ }
    }
    return { ok: true, km: out.map(r => (r ? r.km : null)), min: out.map(r => (r ? r.min : null)), src: src };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

// 결과(값이 있을 때만)를 6시간 캐시
function cached_(key, fn) {
  const cache = CacheService.getScriptCache();
  const ck = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, key, Utilities.Charset.UTF_8));
  const hit = cache.get(ck);
  if (hit) return JSON.parse(hit);
  const v = fn();
  if (v !== null && v !== undefined) {
    try { cache.put(ck, JSON.stringify(v), CACHE_SEC); } catch (e) { /* 100KB 넘으면 캐시 생략 */ }
  }
  return v;
}

function getKakaoKey_() {
  const key = (PropertiesService.getScriptProperties().getProperty('KAKAO_REST_API_KEY') || '').trim();
  if (!key) throw new Error('스크립트 속성에 KAKAO_REST_API_KEY가 없습니다.');
  return key;
}

function kakaoGet_(url) {
  const key = getKakaoKey_();
  const res = UrlFetchApp.fetch(url, { headers: { Authorization: 'KakaoAK ' + key }, muteHttpExceptions: true });
  const code = res.getResponseCode();
  if (code === 401 || code === 403) throw new Error('카카오 API 권한 오류(' + code + '). REST API 키와 카카오맵·카카오모빌리티 API 사용 설정을 확인하세요.');
  if (code !== 200) throw new Error('카카오 API 오류(' + code + '): ' + res.getContentText().slice(0, 200));
  return JSON.parse(res.getContentText());
}

// ════════════════════════════════════════════════════
//  홈 화면 위젯: 웹앱이 저장한 '내 일정'을 개인 주소(?w=키)로 돌려줌
//  ?w=키            → JSON (KWGT 등 위젯 앱용)
//  ?w=키&fmt=text   → 줄글 (주소 내용을 그대로 띄우는 위젯 앱용)
// ════════════════════════════════════════════════════
const W_KEY_RE = /^[a-z0-9]{12,32}$/;

// 화면에서 호출: 내 일정 저장 (주 단위, 내 것만)
function saveWidget(key, data) {
  try {
    if (!W_KEY_RE.test(String(key || ''))) throw new Error('위젯 키가 올바르지 않습니다.');
    const json = JSON.stringify(Object.assign({}, data, { savedAt: Date.now() }));
    if (json.length > 8500) throw new Error('일정이 너무 커서 위젯에 저장하지 못했습니다.');
    PropertiesService.getScriptProperties().setProperty('W_' + key, json);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

// 화면에서 호출: 하루 이동거리(km) 계산이 끝나면 위젯 데이터에 더해 둠
function saveWidgetKm(key, iso, km) {
  try {
    if (!W_KEY_RE.test(String(key || ''))) return { ok: false };
    const props = PropertiesService.getScriptProperties();
    const raw = props.getProperty('W_' + key);
    if (!raw) return { ok: false };
    const data = JSON.parse(raw);
    (data.days || []).forEach(d => { if (d.iso === iso) d.km = Number(km) || null; });
    props.setProperty('W_' + key, JSON.stringify(data));
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

// 화면에서 호출: 위젯 키를 바꿀 때 예전 키 데이터 삭제
function deleteWidget(key) {
  if (W_KEY_RE.test(String(key || ''))) PropertiesService.getScriptProperties().deleteProperty('W_' + key);
  return { ok: true };
}

function widgetOutput_(e) {
  const key = String(e.parameter.w || '');
  const raw = W_KEY_RE.test(key) ? PropertiesService.getScriptProperties().getProperty('W_' + key) : null;
  const out = raw ? widgetView_(withCoords_(key, JSON.parse(raw))) : { ok: false, title: '위젯 주소가 올바르지 않아요', text: '웹앱에서 일정표를 올린 뒤 위젯 주소를 다시 복사하세요.' };
  if (e.parameter.view) {
    return HtmlService.createHtmlOutput(widgetHtml_(out))
      .setTitle('오늘 현장')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  if (e.parameter.fmt === 'text') {
    return ContentService.createTextOutput(out.text || out.title).setMimeType(ContentService.MimeType.TEXT);
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// 위젯에 보여 줄 날(오늘부터 남은 근무일)의 현장 좌표가 없으면 찾아서 저장 (길안내 링크용, 처음 한 번만)
function withCoords_(key, data) {
  try {
    const tz = 'Asia/Seoul', today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    const targets = (data.days || []).filter(d => d.iso >= today && d.stops && d.stops.length).slice(0, 7);
    const need = [];
    let changed = false;
    // 직접 지정한 주소가 있으면 그것으로 (나중에 고친 주소도 위젯에 반영)
    targets.forEach(d => d.stops.forEach(s => {
      const fx = s.name ? siteFix_(s.name, s.area) : null;
      if (fx && (s.lat !== fx.lat || s.lng !== fx.lng)) { s.lat = fx.lat; s.lng = fx.lng; s.addr = fx.addr; changed = true; }
    }));
    targets.forEach(d => d.stops.forEach(s => {
      if (s.lat == null && s.name && !need.some(x => x.q === s.name + '|' + (s.area || ''))) {
        need.push({ q: s.name + '|' + (s.area || ''), area: s.area || '', name: s.name, region: '' });
      }
    }));
    if (!need.length) {
      if (changed) PropertiesService.getScriptProperties().setProperty('W_' + key, JSON.stringify(data));
      return data;
    }
    let origin = null;
    if (data.branch && data.branch[0]) {
      const o = getOrigin(data.branch[0], data.branch[1] || '');
      if (o.ok) origin = o.origin;
    }
    if (origin) data.origin = origin;
    const r = geocodeSites(need, origin, data.branch && data.branch[0]);
    if (!r.ok) return data;
    targets.forEach(d => d.stops.forEach(s => {
      const p = r.places[s.name + '|' + (s.area || '')];
      if (p) { s.lat = p.lat; s.lng = p.lng; if (p.addr) s.addr = p.addr; } else if (s.lat == null) s.lat = false;
    }));
    PropertiesService.getScriptProperties().setProperty('W_' + key, JSON.stringify(data));
  } catch (e) { /* 좌표 없이 보여 줌 */ }
  return data;
}

// 길안내 링크: 카카오맵(앱/웹) · 티맵(앱 실행 링크, 앱키 있을 때) · 네이버지도 앱
function navLinks_(dest, lat, lng) {
  const de = encodeURIComponent(String(dest).replace(/[,/]/g, ' '));
  const tk = (PropertiesService.getScriptProperties().getProperty('TMAP_APP_KEY') || '').trim();
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
    return { iso: d.iso, title: v.title, sub: v.sub, lines: v.lines, rk: v.rk || '', rv: v.rv || '' };
  });
  if (!main) {
    const title = off ? '오늘은 휴가예요' : '이번 일정표에 남은 근무가 없어요';
    return { ok: true, name: data.name, title: title, sub: '새 일정표를 올려 주세요', lines: [], text: title, updated: updated, days: all, main: '' };
  }
  const v = dayView_(data, main, today, now);
  if (off) v.title = '오늘 휴가 · ' + v.title;
  return Object.assign(v.per, { all: v.rows.join(' / ') }, { ok: true, name: data.name, title: v.title, sub: v.sub, start: v.lines[0] ? v.lines[0].time : '',
    lines: v.lines, count: v.lines.length, text: v.text, rk: v.rk, rv: v.rv, updated: updated, days: all, main: main.iso });
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
    };
  });
  const units = main.stops.reduce((a, s) => a + (s.units || 0), 0);
  const places = new Set(main.stops.map(s => s.name)).size;
  const title = (when ? when + ' ' : '') + main.label + (main.team ? ' · ' + main.team : '');
  const sub = places + '곳 · ' + units + '대' + (main.km ? ' · ' + main.km + 'km' : '')
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
    per['s' + (i + 1)] = l ? [l.area, (l.kind + ' ' + l.units).trim()].filter(Boolean).join(' · ') : '';
    per['d' + (i + 1)] = l && when === '오늘' && l.time && l.time < nowHm ? '1' : '0';
    const q = l ? encodeURIComponent(((l.area || '') + ' ' + l.name).trim()) : '';
    per['k' + (i + 1)] = l ? (l.nav ? l.nav.kakao : 'https://map.kakao.com/?eName=' + q) : '';
    per['t' + (i + 1)] = l ? (l.nav ? l.nav.tmap : 'https://map.kakao.com/?eName=' + q) : '';
    per['v' + (i + 1)] = l ? (l.nav ? l.nav.naver : 'https://map.naver.com/p/search/' + q) : '';
  }
  if (rows.length > 8) per.l8 = '외 ' + (rows.length - 7) + '곳 더';
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
  return { title: title, sub: sub, lines: lines, rows: rows, text: text, per: per, rk: rk, rv: rv };
}

function tomorrow_(iso) {
  const d = new Date(iso + 'T12:00:00+09:00');
  d.setDate(d.getDate() + 1);
  return Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM-dd');
}

// 편집기에서 실행해 설정 확인
function testSetup() {
  const props = PropertiesService.getScriptProperties();
  ['KAKAO_REST_API_KEY', 'KAKAO_JS_KEY', 'TMAP_APP_KEY', 'DATA_GO_KR_KEY'].forEach(k =>
    Logger.log(k + ': ' + (props.getProperty(k) ? '있음' : '없음')));
  const o = getOrigin('고양파주지사', '경기 고양시 일산서구 킨텍스로 217-59');
  Logger.log('지사 좌표: ' + JSON.stringify(o));
  Logger.log('주소록: 일신2조합빌딩 → ' + bookCandidates_('일신2조합빌딩', '일산동'));
  if (o.ok) {
    const g = geocodeSites([{ q: '일신2조합빌딩', area: '일산동', name: '일신2조합빌딩' }], o.origin);
    Logger.log('현장 위치: ' + JSON.stringify(g));
    const p = g.places && g.places['일신2조합빌딩'];
    if (p) Logger.log('거리: ' + JSON.stringify(routeLegs([[o.origin.lat, o.origin.lng, p.lat, p.lng]])));
  }
}

// 우리 지사 검사접수 건 확인: 지사 이름·기간을 바꿔 실행 → 실행 로그를 보내 주세요
function testBranchRecptn() {
  const branch = '고양파주지사', st = '20261012', en = '20261016';
  const r = recptnList(st, en, branch);
  if (!r.ok) { Logger.log('오류: ' + r.message); return; }
  Logger.log(branch + ' ' + st + '~' + en + ' 접수 ' + r.list.length + '건');
  r.list.slice(0, 40).forEach(x => Logger.log(x.d + ' · ' + x.kind + ' · ' + x.nm + ' · ' + x.addr + ' · 보수: ' + x.mnt + ' ' + x.tel));
  const all = recptnList(st, en, '');
  const inst = {};
  (all.list || []).forEach(x => { if (/고양|파주/.test(x.addr)) inst[x.inst] = (inst[x.inst] || 0) + 1; });
  Logger.log('주소가 고양·파주인 전체 접수의 검사 지사별 건수: ' + JSON.stringify(inst));
}

// ── 시험용: 승강기 정보 서비스(ElevatorInformationService)에 어떤 항목이 있는지 확인 ──
// 편집기에서 testElevatorInfo 를 실행 → 보기 → 로그. MR/MRL(세부형식)·브레이크 같은 항목이 있는지 봄
// 오퍼레이션 이름을 몰라서 흔한 이름들을 한꺼번에 시도하고, 응답이 온 것의 항목을 전부 찍음
function testElevatorInfo() {
  const key = (PropertiesService.getScriptProperties().getProperty('DATA_GO_KR_KEY') || '').trim();
  if (!key) return Logger.log('스크립트 속성에 DATA_GO_KR_KEY 가 없습니다');
  // 시험할 승강기 고유번호: 이번 주 검사접수 건에서 몇 개 + 예전에 본 번호
  const nos = ['8019375', '2085183'];
  try {
    const tz = 'Asia/Seoul', d0 = new Date();
    const st = Utilities.formatDate(d0, tz, 'yyyyMMdd');
    const en = Utilities.formatDate(new Date(d0.getTime() + 7 * 864e5), tz, 'yyyyMMdd');
    const r = UrlFetchApp.fetch('https://apis.data.go.kr/B553664/ElevatorRecptnService/getRecptnV1?serviceKey=' + encodeURIComponent(key)
      + '&_type=json&numOfRows=5&pageNo=1&inspct_st_de=' + st + '&inspct_en_de=' + en, { muteHttpExceptions: true });
    const its = (((JSON.parse(r.getContentText()).response || {}).body || {}).items || {}).item || [];
    [].concat(its).forEach(x => { if (x.elvtrUniqueNo && nos.indexOf(String(x.elvtrUniqueNo)) < 0) nos.unshift(String(x.elvtrUniqueNo)); });
  } catch (e) { Logger.log('검사접수에서 번호 가져오기 실패: ' + e.message); }
  const no = nos[0];
  Logger.log('시험 번호: ' + nos.slice(0, 3).join(', '));
  const base = 'https://apis.data.go.kr/B553664/ElevatorInformationService/';
  const ops = ['getElevatorViewM', 'getElevatorView', 'getElevatorList', 'getElevatorInfo', 'getElevatorInfoList',
    'getElvtrInfo', 'getElvtrInfoList', 'getElevatorBasicInfo', 'getElevatorDetail', 'getElvtrDetail', 'getElevatorInformation'];
  const params = ['elevator_no', 'elvtrUniqueNo', 'elevatorNo', 'elvtr_unique_no'];
  const reqs = [];
  ops.forEach(op => params.forEach(pm => reqs.push({ op: op, pm: pm,
    url: base + op + '?serviceKey=' + encodeURIComponent(key) + '&numOfRows=3&pageNo=1&' + pm + '=' + no })));
  const res = UrlFetchApp.fetchAll(reqs.map(q => ({ url: q.url, muteHttpExceptions: true })));
  let found = 0;
  res.forEach((r, i) => {
    const t = r.getContentText();
    const code = (t.match(/<resultCode>([^<]*)/) || [])[1] || '';
    const msg = (t.match(/<resultMsg>([^<]*)/) || [])[1] || t.slice(0, 80).replace(/\s+/g, ' ');
    const hasItem = /<item>/.test(t);
    if (r.getResponseCode() === 404 || /API not found|Unexpected errors/i.test(t)) return; // 없는 오퍼레이션
    Logger.log(reqs[i].op + ' ? ' + reqs[i].pm + '= → HTTP ' + r.getResponseCode() + ' · ' + code + ' ' + msg + (hasItem ? ' · 결과 있음' : ''));
    if (hasItem && found < 2) {
      found++;
      const item = (t.match(/<item>([\s\S]*?)<\/item>/) || [])[1] || '';
      Logger.log('── 항목 전체 (' + reqs[i].op + ') ──');
      (item.match(/<([A-Za-z0-9_]+)>([^<]*)<\/\1>/g) || []).forEach(f => Logger.log('  ' + f.replace(/<\/[^>]+>$/, '').replace(/^<([^>]+)>/, '$1 = ')));
    }
  });
  if (!found) Logger.log('결과가 있는 응답이 없습니다. 공공데이터포털 이 API 페이지의 「상세기능」 목록(오퍼레이션 이름·요청 변수)을 복사해서 보내 주세요.');
}

// ── 시험용: 내 위젯 일정의 현장들로 승강기 정보(siteElevators)가 어떻게 찾아지는지 로그로 확인 ──
// 편집기에서 testSiteElevators 실행 → 실행 로그를 복사해서 보내 주세요
function testSiteElevators() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const keys = Object.keys(props).filter(k => k.indexOf('W_') === 0);
  if (!keys.length) return Logger.log('저장된 위젯 일정이 없습니다. 웹앱에서 일정표를 한 번 올려 주세요.');
  const data = JSON.parse(props[keys[0]]);
  const branch = data.branch && data.branch[0];
  Logger.log('지사: ' + branch + ' · 관할: ' + (JURIS[branch] || '없음') + ' · DATA_GO_KR_KEY: ' + (props.DATA_GO_KR_KEY ? '있음' : '없음'));
  const stops = [];
  (data.days || []).forEach(d => (d.stops || []).forEach(s => { if (stops.length < 8 && !stops.some(x => x.name === s.name)) stops.push(s); }));
  const J = juris_(branch);
  stops.forEach(s => {
    const k = bookKey_(s.name), f = bookFile_(k);
    let m = {};
    try {
      const r = UrlFetchApp.fetch(ELV_URL + f, { muteHttpExceptions: true });
      Logger.log('— ' + s.name + ' (' + (s.area || '동 없음') + ') · 키 ' + k + ' · 조각 ' + f + ' HTTP ' + r.getResponseCode());
      m = (JSON.parse(r.getContentText('UTF-8')) || {})[k] || {};
    } catch (e) { Logger.log('   조각 읽기 실패: ' + e.message); }
    const addrs = Object.keys(m);
    Logger.log('   설치현황 주소 ' + addrs.length + '곳' + addrs.slice(0, 4).map(a => '\n     · ' + a + ' (' + m[a].length + '대, 관할 ' + (inJuris_(a, J) ? 'O' : 'X') + ')').join(''));
  });
  const r = siteElevators(stops.map(s => ({ q: s.name, name: s.name, area: s.area || '', addr: s.addr || '', nos: [] })), branch);
  Logger.log('결과: ' + JSON.stringify(r).slice(0, 1500));
}
