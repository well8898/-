/**
 * ════════════════════════════════════════════════════
 *  노조 여비 청구 미니 ERP — 서버 스크립트 (Code.gs)
 * ════════════════════════════════════════════════════
 *
 * ▶ 시트 구성 (헤더 이름으로 열을 찾으므로 열 순서는 상관없음)
 *   - 여비 청구 데이터 : 출장 1건당 1인 1행 (여러 구간은 줄바꿈으로 합쳐 기록, 금액·km는 합계)
 *                        마감여부를 '마감'으로 바꾸면 그 사람은 더 이상 수정 불가
 *   - 출장 관리        : 출장ID | 출장목적 | 기본도착지 | 출장시작일 | 출장종료일 | 유류대 | 마감여부
 *   - 대상자 명단      : 출장ID | 사번 | 성명 | 소속(= 지사별 주소의 지사 이름)
 *   - 지사별 주소      : 지사 | 주소 | 좌표   (주소·좌표는 비워두면 카카오 검색으로 자동 채움)
 *
 * ▶ 스크립트 속성 (프로젝트 설정 → 스크립트 속성)
 *   - KAKAO_REST_API_KEY : 카카오 REST API 키 (필수 — 장소 검색·길찾기)
 *   - KAKAO_JS_KEY       : 카카오 JavaScript 키 (화면에 카카오 지도 표시용, 없으면 기본 지도로 표시)
 *                          카카오 디벨로퍼스 → 플랫폼 → Web 사이트 도메인에 웹앱 도메인 등록 필요
 *   - DRIVE_FOLDER_ID    : 저장 폴더 ID (없으면 자동 생성)
 *
 * ▶ 최초 1회: 함수 선택 → setup → ▶ 실행 (권한 승인)
 *   이후 testDistance / testPdf / testHolidays 로 동작 확인
 *
 * ▶ 제출 시 생성물 (드라이브 / 여비청구_첨부 / 출장ID 폴더)
 *   - 사번_성명_날짜_여비청구및영수증.pdf  ← 이것 하나 (서식 + 서명 + 영수증 이미지 + 경로 지도)
 *   - _수정용데이터 / _상세_사번.json      ← 수정할 때 입력값·영수증을 다시 불러오는 데이터 (지우지 마세요)
 *   수정 제출하면 이전 PDF는 휴지통으로 이동
 */

const CONFIG = {
  SPREADSHEET_ID: '1fH_EhDUjcTW50ulYCZLRSGL0HzTNLGOcfGAIPVbzb4s',
  SHEET_CLAIM:  '여비 청구 데이터',
  SHEET_TRIP:   '출장 관리',
  SHEET_MEMBER: '대상자 명단',
  SHEET_BRANCH: '지사별 주소',
  ORG_NAME:     '한국승강기안전공단',   // 지사 이름 검색 시 앞에 붙임 (예: 한국승강기안전공단 대전지사)
  HOLIDAY_CALENDAR: 'ko.south_korea#holiday@group.v.calendar.google.com',

  // 금액 기준
  DEFAULT_FUEL_RATE: 307,               // 출장 관리 '유류대'가 비었을 때 단가 (원/km)
  DAILY_BASE:   25000,                  // 일비 (1일)
  DAILY_LONG:   30000,                  // 전체 이동거리가 DAILY_LONG_KM 초과 시 일비
  DAILY_LONG_KM: 300,
  UNION_CAR_DAILY_CUT: 10000,           // 조합차량(법인차량) 이용 시 1일 일비 감액
  MEAL_PRICE:   8000,                   // 식비 1끼
  MAX_MEALS:    3,

  OPEN_STATUS:  '진행중',
  CLOSED_STATUS: '마감',
  TRANSPORTS:   ['자차', '동승', 'KTX', '버스', '도보'],
  CAR:          '자차',                 // 유류비 자동 계산 대상
  CATEGORIES:   ['근무지내', '근무지외', '국외', '기타'],
  MAX_ROWS:     31,
  MAX_WAYPOINTS: 5,                     // 카카오 길찾기 경유지 최대 5개
  DRIVE_FOLDER_NAME: '여비청구_첨부',
  DATA_FOLDER_NAME:  '_수정용데이터',
  MAX_IMAGE_BYTES: 5 * 1024 * 1024,     // 이미지 1장당 5MB
  MAX_FILES: 20,                        // 영수증 이미지 (PDF 영수증은 페이지별 이미지로 변환됨)
  FORM_MIN_ROWS: 7,                     // 서식 표 최소 줄 수
  PATH_POINTS: 400,                     // 화면 지도용 경로 점 개수 상한
};

// 여비 청구 데이터 표준 헤더 (없는 열은 이 순서 기준 위치에 자동 삽입)
const CLAIM_HEADERS = [
  '마감여부', '제출일시', '출장ID', '출장목적', '사번', '성명', '소속', '출장시작일', '출장종료일',
  '출발지', '경과지', '도착지', '교통편', '이동거리(km)', '운임_유류비', '일비', '숙박비', '식비', '기타비용',
  '총청구금액', '운임청구사유', '입금은행', '계좌번호', '예금주', '여비 청구 및 영수증',
];

// 숫자로 바뀌면 앞자리 0이 사라지는 열 → 텍스트 서식으로 저장
const CLAIM_TEXT_COLS = ['출장ID', '사번', '계좌번호'];


// ════════════════════════════════════════════════════
//  웹앱 진입점
// ════════════════════════════════════════════════════
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('노조 여비 청구')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}


// ════════════════════════════════════════════════════
//  1. 로그인 + 출장 목록
// ════════════════════════════════════════════════════
function loginAndGetTrips(employeeId, name) {
  try {
    const auth = authenticate_(employeeId, name);
    return {
      ok: true,
      user: auth.user,
      trips: getOpenTrips_(auth.tripIds, auth.user.사번, true),
      branches: getBranchNames_(),
      transports: CONFIG.TRANSPORTS,
      kakaoJsKey: PropertiesService.getScriptProperties().getProperty('KAKAO_JS_KEY') || '',
      rules: {
        dailyBase: CONFIG.DAILY_BASE, dailyLong: CONFIG.DAILY_LONG, dailyLongKm: CONFIG.DAILY_LONG_KM,
        unionCarDailyCut: CONFIG.UNION_CAR_DAILY_CUT,
        mealPrice: CONFIG.MEAL_PRICE, maxMeals: CONFIG.MAX_MEALS, maxFiles: CONFIG.MAX_FILES,
      },
    };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

// 사번 + 성명 검증 → { user, tripIds }
function authenticate_(employeeId, name) {
  const empId = normalizeEmpId_(employeeId);
  const nm = normalizeName_(name);
  if (!empId) throw new Error('사번을 입력하세요.');
  if (!nm) throw new Error('성명을 입력하세요.');

  const t = readTable_(CONFIG.SHEET_MEMBER);
  const c = requireCols_(t, ['출장ID', '사번', '성명', '소속']);

  let user = null;
  const tripIds = [];
  t.rows.forEach(row => {
    if (!sameEmpId_(row[c.사번], empId)) return;
    if (normalizeName_(row[c.성명]) !== nm) return;
    if (!user) {
      user = {
        사번: String(row[c.사번]).trim(),
        성명: String(row[c.성명]).trim(),
        소속: String(row[c.소속]).trim(),
      };
    }
    const tripId = String(row[c.출장ID]).trim();
    if (tripId && tripIds.indexOf(tripId) < 0) tripIds.push(tripId);
  });

  if (!user) throw new Error('사번 또는 성명이 일치하지 않습니다.');
  return { user, tripIds };
}

// 본인에게 배정된 출장 중 '진행중'인 것만 (withWorkDays: 중간 근무일 목록 포함)
function getOpenTrips_(tripIds, empId, withWorkDays) {
  const t = readTable_(CONFIG.SHEET_TRIP);
  const c = requireCols_(t, ['출장ID', '출장목적', '기본도착지', '출장시작일', '출장종료일', '마감여부']);
  const rateCol = t.idx('유류대');
  const mine = findMyClaims_(empId);

  const trips = [];
  t.rows.forEach(row => {
    const id = String(row[c.출장ID]).trim();
    if (!id || tripIds.indexOf(id) < 0) return;
    if (String(row[c.마감여부]).trim() !== CONFIG.OPEN_STATUS) return;
    const rate = rateCol >= 0 ? toWon_(row[rateCol]) : 0;
    const trip = {
      출장ID:     id,
      출장목적:   String(row[c.출장목적]).trim(),
      기본도착지: String(row[c.기본도착지]).trim(),
      출장시작일: fmtDate_(row[c.출장시작일]),
      출장종료일: fmtDate_(row[c.출장종료일]),
      유류대:     rate > 0 ? rate : CONFIG.DEFAULT_FUEL_RATE,
      청구상태:   mine[id] ? (mine[id].locked ? '마감' : '제출') : '미제출',
    };
    if (withWorkDays) trip.근무일 = middleWorkDays_(trip.출장시작일, trip.출장종료일);
    trips.push(trip);
  });
  return trips;
}

// 출장ID → { rowNo, locked }  (본인 제출 행)
function findMyClaims_(empId) {
  const out = {};
  const sheet = getSS_().getSheetByName(CONFIG.SHEET_CLAIM);
  if (!sheet || sheet.getLastRow() < 2) return out;
  const t = readTable_(CONFIG.SHEET_CLAIM);
  const idCol = t.idx('출장ID'), empCol = t.idx('사번'), stCol = t.idx('마감여부');
  if (idCol < 0 || empCol < 0) return out;
  t.rows.forEach((row, i) => {
    if (!sameEmpId_(row[empCol], empId)) return;
    const id = String(row[idCol]).trim();
    if (!id) return;
    const locked = stCol >= 0 && String(row[stCol]).trim() === CONFIG.CLOSED_STATUS;
    // 같은 출장에 행이 여러 개면 마지막 행 기준, 하나라도 마감이면 마감
    out[id] = { rowNo: i + 2, locked: locked || (out[id] ? out[id].locked : false) };
  });
  return out;
}

// 시작일·종료일 사이(양 끝 제외)에서 주말·공휴일을 뺀 날짜 목록
function middleWorkDays_(start, end) {
  if (!isDateStr_(start) || !isDateStr_(end) || end <= start) return [];
  const tz = getTz_();
  const holidays = getHolidaySet_(start, end);
  const days = [];
  let d = Utilities.parseDate(start, tz, 'yyyy-MM-dd');
  for (let n = 0; n < 60; n++) {
    d = new Date(d.getTime() + 24 * 3600 * 1000);
    const s = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
    if (s >= end) break;
    const dow = Number(Utilities.formatDate(d, tz, 'u')); // 1=월 … 7=일
    if (dow >= 6 || holidays[s]) continue;
    days.push(s);
  }
  return days;
}

// 구글 캘린더 '대한민국 공휴일' → { 'yyyy-MM-dd': 이름 }  (기념일은 제외)
function getHolidaySet_(start, end) {
  const set = {};
  try {
    const cal = CalendarApp.getCalendarById(CONFIG.HOLIDAY_CALENDAR);
    if (!cal) return set;
    const tz = getTz_();
    const from = Utilities.parseDate(start, tz, 'yyyy-MM-dd');
    const to = new Date(Utilities.parseDate(end, tz, 'yyyy-MM-dd').getTime() + 24 * 3600 * 1000);
    cal.getEvents(from, to).forEach(ev => {
      if (!ev.isAllDayEvent()) return;
      if (/기념일|observance/i.test(String(ev.getDescription() || ''))) return;
      let d = ev.getAllDayStartDate();
      const last = ev.getAllDayEndDate();
      while (d < last) {
        set[Utilities.formatDate(d, tz, 'yyyy-MM-dd')] = ev.getTitle();
        d = new Date(d.getTime() + 24 * 3600 * 1000);
      }
    });
  } catch (e) {
    Logger.log('공휴일 캘린더 조회 실패(주말만 제외): ' + e.message);
  }
  return set;
}

function getBranchNames_() {
  const sheet = getSS_().getSheetByName(CONFIG.SHEET_BRANCH);
  if (!sheet) return [];
  const t = readTable_(CONFIG.SHEET_BRANCH);
  const col = t.idx('지사');
  if (col < 0) return [];
  return t.rows.map(r => String(r[col]).trim()).filter(Boolean);
}


// ════════════════════════════════════════════════════
//  2. 기존 제출 내역 불러오기 (수정용)
// ════════════════════════════════════════════════════
function getMyClaim(employeeId, name, tripId) {
  try {
    const auth = authenticate_(employeeId, name);
    tripId = String(tripId || '').trim();
    if (auth.tripIds.indexOf(tripId) < 0) throw new Error('해당 출장의 청구 대상자가 아닙니다.');
    const mine = findMyClaims_(auth.user.사번)[tripId];
    if (!mine) return { ok: true, claim: null };
    if (mine.locked) throw new Error('마감된 청구는 수정할 수 없습니다.');

    const detail = loadDetail_(getTripFolder_(tripId), auth.user.사번);
    if (!detail) return { ok: true, claim: null, legacy: true };
    return {
      ok: true,
      claim: {
        rows: detail.rows,
        category: detail.category, categoryEtc: detail.categoryEtc,
        unionCar: detail.unionCar, fareReason: detail.fareReason,
        bank: detail.bank, account: detail.account, holder: detail.holder,
        receipts: (detail.receipts || []).map(r => ({ id: r.id, name: r.name })),
        routeImages: (detail.routeImages || []).map(r => ({ id: r.id, name: r.name })),
        submittedAt: detail.submittedAt,
      },
    };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

function detailFileName_(empId) {
  return '_상세_' + safeName_(empId) + '.json';
}

function getDataFolder_(tripFolder) {
  const it = tripFolder.getFoldersByName(CONFIG.DATA_FOLDER_NAME);
  return it.hasNext() ? it.next() : tripFolder.createFolder(CONFIG.DATA_FOLDER_NAME);
}

// _수정용데이터 폴더 → (예전 버전) 출장 폴더 순으로 찾음
function loadDetail_(tripFolder, empId) {
  const name = detailFileName_(empId);
  const dataIt = tripFolder.getFoldersByName(CONFIG.DATA_FOLDER_NAME);
  const folders = (dataIt.hasNext() ? [dataIt.next()] : []).concat([tripFolder]);
  for (let i = 0; i < folders.length; i++) {
    // 휴지통 파일도 검색되므로 제외하고, 여러 개면 가장 최근 것
    const it = folders[i].getFilesByName(name);
    let file = null;
    while (it.hasNext()) {
      const f = it.next();
      if (f.isTrashed()) continue;
      if (!file || f.getLastUpdated() > file.getLastUpdated()) file = f;
    }
    if (!file) continue;
    try {
      const d = JSON.parse(file.getBlob().getDataAsString('UTF-8'));
      d._fileId = file.getId();
      return d;
    } catch (e) {
      return null;
    }
  }
  return null;
}


// ════════════════════════════════════════════════════
//  3. 이동거리 일괄 계산 (화면 지도용 경로 포함)
//     items: [{ origin, waypoint, destination }]  (지사 이름 · 주소 · 상호명 모두 가능)
// ════════════════════════════════════════════════════
function calculateDistances(items) {
  try {
    const key = getKakaoKey_();
    const list = Array.isArray(items) ? items.slice(0, CONFIG.MAX_ROWS) : [];
    return {
      ok: true,
      results: list.map(it => {
        try {
          const route = computeRoute_(it.origin, it.waypoint, it.destination, key);
          // 카카오 지도를 못 쓰는 환경을 위한 예비 지도 이미지
          let mapImage = null;
          try { mapImage = Utilities.base64Encode(buildRouteMap_(route).getBytes()); } catch (e) { /* 없음 */ }
          return {
            ok: true,
            km: route.km,
            places: route.places.map(p => ({ name: p.name, address: p.address, x: Number(p.x), y: Number(p.y) })),
            path: thinPath_(route.path, CONFIG.PATH_POINTS),
            mapImage: mapImage,
          };
        } catch (e) {
          return { ok: false, message: e.message };
        }
      }),
    };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

// 장소 검색 + 카카오 길찾기 → { km, places: [출발, 경유..., 도착], path: [[lat,lng], ...] }
function computeRoute_(origin, waypoints, destination, key) {
  const wps = splitWaypoints_(waypoints);
  if (wps.length > CONFIG.MAX_WAYPOINTS) throw new Error('경과지는 최대 ' + CONFIG.MAX_WAYPOINTS + '곳까지 입력할 수 있습니다.');

  const o = resolvePlace_(origin, key);
  const w = wps.map(q => resolvePlace_(q, key));
  const d = resolvePlace_(destination, key);

  let url = 'https://apis-navi.kakaomobility.com/v1/directions'
    + '?origin=' + o.x + ',' + o.y
    + '&destination=' + d.x + ',' + d.y
    + '&priority=RECOMMEND';
  if (w.length) url += '&waypoints=' + encodeURIComponent(w.map(p => p.x + ',' + p.y).join('|'));

  const json = kakaoGet_(url, key);
  const route = json.routes && json.routes[0];
  if (!route) throw new Error('경로를 찾지 못했습니다.');

  const places = [o].concat(w, [d]);
  if (route.result_code === 104) return { km: 0, places: places, path: [] }; // 출발지 = 도착지 (5m 이내)
  if (route.result_code !== 0) throw new Error('경로 탐색 실패: ' + route.result_msg);

  const path = [];
  (route.sections || []).forEach(sec => (sec.roads || []).forEach(road => {
    const v = road.vertexes || [];
    for (let i = 0; i + 1 < v.length; i += 2) path.push([v[i + 1], v[i]]); // [lat, lng]
  }));

  return {
    km: Math.round(route.summary.distance / 100) / 10, // m → km, 소수 1자리
    places: places,
    path: path,
  };
}

// 장소 이름들 → { 이름: 세부주소 }  (화면 표·PDF 표에 주소 표시용, 못 찾으면 '')
function lookupAddresses(names) {
  try {
    const key = getKakaoKey_();
    const out = {};
    (Array.isArray(names) ? names : []).slice(0, 100).forEach(n => {
      const q = String(n || '').trim();
      if (!q || q in out) return;
      try { out[q] = resolvePlace_(q, key).address || ''; } catch (e) { out[q] = ''; }
    });
    return { ok: true, addresses: out };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

// 청구 줄의 출발지·경과지·도착지 → { 이름: 세부주소 }
function placeAddresses_(rows) {
  const names = [];
  rows.forEach(r => [r.origin, r.destination].concat(splitWaypoints_(r.waypoint)).forEach(n => {
    if (n && names.indexOf(n) < 0) names.push(n);
  }));
  const res = lookupAddresses(names);
  return res.ok ? res.addresses : {};
}

// 경로 점 개수 줄이기 (시작·끝점 유지)
function thinPath_(path, max) {
  if (path.length <= max) return path;
  const step = Math.ceil(path.length / max);
  return path.filter((p, i) => i % step === 0 || i === path.length - 1);
}

function splitWaypoints_(s) {
  return String(s || '').split(/[,，;]/).map(v => v.trim()).filter(Boolean);
}

// 이동이 있는 줄인지 (출발지 = 도착지 이고 경과지 없으면 이동 없음)
function isMove_(r) {
  const o = String(r.origin || '').replace(/\s/g, '');
  const d = String(r.destination || '').replace(/\s/g, '');
  return !(o === d && !splitWaypoints_(r.waypoint).length);
}

// 예비 경로 지도 PNG (GAS 내장 정적 지도 + 카카오 경로선)
function buildRouteMap_(route) {
  const map = Maps.newStaticMap().setSize(640, 420).setLanguage('ko');
  try { map.setPathStyle(5, '0x1D4ED8', null); } catch (e) { /* 기본 스타일 사용 */ }

  if (route.path.length > 1) {
    const pts = [];
    thinPath_(route.path, 250).forEach(p => pts.push(p[0], p[1])); // URL 길이 제한
    map.addPath(Maps.encodePolyline(pts));
  }

  const last = route.places.length - 1;
  route.places.forEach((p, i) => {
    const isStart = i === 0, isEnd = i === last;
    map.setMarkerStyle(
      Maps.StaticMap.MarkerSize.MID,
      isStart ? Maps.StaticMap.Color.GREEN : isEnd ? Maps.StaticMap.Color.RED : Maps.StaticMap.Color.ORANGE,
      isStart ? 'S' : isEnd ? 'E' : String(i)
    );
    map.addMarker(Number(p.y), Number(p.x));
  });

  return map.getBlob().setName('route.png');
}

// 검색어 → { x(경도), y(위도), name, address }
function resolvePlace_(query, key) {
  const q = String(query || '').trim();
  if (!q) throw new Error('출발지와 도착지를 모두 입력하세요.');

  const branch = resolveBranch_(q, key);
  if (branch) return branch;

  // 'OO지사', 'OO지역본부'는 다른 회사 지사가 잡히지 않게 공단 이름을 붙여서 먼저 검색
  let place = null;
  if (isOrgBranchName_(q)) place = searchKakao_(CONFIG.ORG_NAME + ' ' + q, key);
  if (!place) place = searchKakao_(q, key);
  if (!place) throw new Error("'" + q + "' 위치를 찾지 못했습니다. 주소나 정확한 상호명으로 입력하세요.");
  return place;
}

// 공단 지사·지역본부 이름인지 (이미 공단 이름이 들어 있으면 제외)
function isOrgBranchName_(q) {
  const s = String(q || '').replace(/\s/g, '');
  return /(지사|지역본부)$/.test(s) && s.indexOf(CONFIG.ORG_NAME.replace(/\s/g, '')) < 0;
}

// 지사별 주소 탭에 있는 지사면 좌표 사용 (없으면 검색 후 시트에 저장)
function resolveBranch_(q, key) {
  const sheet = getSS_().getSheetByName(CONFIG.SHEET_BRANCH);
  if (!sheet) return null;
  const t = readTable_(CONFIG.SHEET_BRANCH);
  const nameCol = t.idx('지사'), addrCol = t.idx('주소'), coordCol = t.idx('좌표');
  if (nameCol < 0) return null;

  const target = q.replace(/\s/g, '');
  const i = t.rows.findIndex(r => String(r[nameCol]).replace(/\s/g, '') === target);
  if (i < 0) return null;

  const row = t.rows[i];
  const name = CONFIG.ORG_NAME + ' ' + String(row[nameCol]).trim();
  const addr = addrCol >= 0 ? String(row[addrCol]).trim() : '';

  // 좌표 "위도,경도" 가 이미 있으면 API 호출 없이 사용
  const coord = coordCol >= 0 ? String(row[coordCol]).trim() : '';
  const m = coord.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (m) return { x: m[2], y: m[1], name: name, address: addr };

  const place = (addr && searchKakao_(searchableAddress_(addr), key)) || searchKakao_(name, key);
  if (!place) throw new Error("'" + name + "' 위치를 찾지 못했습니다. 지사별 주소 탭에 주소를 입력하세요.");

  // 다음부터는 시트 값 재사용
  const rowNo = i + 2;
  if (coordCol >= 0) sheet.getRange(rowNo, coordCol + 1).setValue(place.y + ',' + place.x);
  if (addrCol >= 0 && !addr) sheet.getRange(rowNo, addrCol + 1).setValue(place.address);

  return { x: place.x, y: place.y, name: name, address: addr || place.address };
}

// 시트 주소 → 카카오 주소 검색용 (우편번호·괄호·층수·건물명 제거)
// '(08375) 서울 구로구 디지털로 31길 41, 13층 (구로동, ...)' → '서울 구로구 디지털로 31길 41'
function searchableAddress_(addr) {
  const s = String(addr || '').replace(/^\s*\(\d{5}\)\s*/, '').replace(/\([^)]*\)?/g, ' ').replace(/\s+/g, ' ').trim();
  const m = s.match(/^(.*?(?:로|길)\s*(?:\d+(?:번)?(?:길|가길)\s*)?\d+(?:-\d+)?)/);
  return m ? m[1] : s.split(',')[0].trim();
}

// 카카오 주소 검색 → 실패 시 키워드(상호) 검색
function searchKakao_(q, key) {
  const base = 'https://dapi.kakao.com/v2/local/search/';

  const addr = kakaoGet_(base + 'address.json?size=1&query=' + encodeURIComponent(q), key);
  if (addr.documents && addr.documents.length) {
    const d = addr.documents[0];
    return {
      x: d.x, y: d.y, name: q,
      address: (d.road_address && d.road_address.address_name) || d.address_name,
    };
  }

  const kw = kakaoGet_(base + 'keyword.json?size=1&query=' + encodeURIComponent(q), key);
  if (kw.documents && kw.documents.length) {
    const d = kw.documents[0];
    return { x: d.x, y: d.y, name: d.place_name, address: d.road_address_name || d.address_name };
  }
  return null;
}

function kakaoGet_(url, key) {
  const res = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'KakaoAK ' + key },
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code === 401 || code === 403) {
    throw new Error('카카오 API 권한 오류(' + code + '). REST API 키와 카카오맵/길찾기 API 사용 설정을 확인하세요.');
  }
  if (code !== 200) {
    throw new Error('카카오 API 오류(' + code + '): ' + res.getContentText().slice(0, 200));
  }
  return JSON.parse(res.getContentText());
}

function getKakaoKey_() {
  const key = PropertiesService.getScriptProperties().getProperty('KAKAO_REST_API_KEY');
  if (!key) throw new Error('스크립트 속성에 KAKAO_REST_API_KEY가 없습니다. 관리자에게 문의하세요.');
  return key;
}


// ════════════════════════════════════════════════════
//  4. 제출 / 수정 제출 → PDF 1개 생성
// ════════════════════════════════════════════════════
function saveClaimData(formData) {
  const created = []; // 실패 시 정리할 새 파일
  try {
    const f = formData || {};

    // 인증·권한은 서버에서 다시 확인 (화면 값은 믿지 않음)
    const auth = authenticate_(f.employeeId, f.name);
    const user = auth.user;
    const tripId = String(f.tripId || '').trim();
    if (auth.tripIds.indexOf(tripId) < 0) throw new Error('해당 출장의 청구 대상자가 아닙니다.');
    const trip = getOpenTrips_([tripId], user.사번, false)[0];
    if (!trip) throw new Error('마감되었거나 존재하지 않는 출장입니다.');
    if (trip.청구상태 === '마감') throw new Error('마감된 청구는 수정할 수 없습니다.');

    const unionCar = f.unionCar === '유' ? '유' : '무';
    const rows = validateRows_(f.rows, trip, unionCar === '유');
    const sum = k => rows.reduce((a, r) => a + r[k], 0);
    const totals = {
      km: Math.round(sum('km') * 10) / 10,
      fare: sum('fare'), daily: sum('daily'), lodging: sum('lodging'), meal: sum('meal'), etc: sum('etc'),
    };
    totals.total = totals.fare + totals.daily + totals.lodging + totals.meal + totals.etc;
    if (totals.total <= 0) throw new Error('청구 금액이 0원입니다.');

    const category = CONFIG.CATEGORIES.indexOf(f.category) >= 0 ? f.category : '근무지외';
    const categoryEtc = category === '기타' ? String(f.categoryEtc || '').trim() : '';
    if (category === '기타' && !categoryEtc) throw new Error('구분이 기타이면 내용을 입력하세요.');
    const fareReason = String(f.fareReason || '').trim();

    const bank = String(f.bank || '').trim();
    const account = String(f.account || '').trim();
    const holder = String(f.holder || '').trim();
    if (!bank || !account || !holder) throw new Error('입금 계좌 정보를 모두 입력하세요.');
    if (!/^[\d-]+$/.test(account)) throw new Error('계좌번호는 숫자와 - 만 입력하세요.');

    const sig = cleanImage_(f.signature);
    if (!sig) throw new Error('서명을 입력하세요.');

    const folder = getTripFolder_(tripId);
    const prev = loadDetail_(folder, user.사번);

    // 영수증·경로 증빙 사진: 이전 제출분 중 유지할 것 + 새로 올린 것 (모두 이미지, 파일로 따로 저장하지 않음)
    const keepIds = Array.isArray(f.keepReceiptIds) ? f.keepReceiptIds.map(String) : [];
    const receipts = mergeImages_(prev && prev.receipts, keepIds, f.receipts, 'r', '영수증');
    const routeImages = mergeImages_(prev && prev.routeImages, f.keepRouteIds, f.routeImages, 'p', '경로 증빙');

    const dates = rows.map(r => r.date).sort();
    const startDate = dates[0], endDate = dates[dates.length - 1];
    const prefix = safeName_(user.사번 + '_' + user.성명 + '_' + startDate);

    // 구간별 경로 지도 (km는 서버에서 다시 길찾기로 확인)
    const maps = buildRouteEvidence_(rows);
    const addresses = placeAddresses_(rows);

    // 서식 PDF (이것 하나만 드라이브에 남김)
    const pdfHtml = buildClaimHtml_({
      user: user, trip: trip, rows: rows, totals: totals,
      category: category, categoryEtc: categoryEtc, unionCar: unionCar, fareReason: fareReason,
      submitDate: Utilities.formatDate(new Date(), getTz_(), 'yyyy년 MM월 dd일'),
      signature: sig.b64, receipts: receipts, maps: maps, routeImages: routeImages, addresses: addresses,
    });
    const pdfFile = folder.createFile(
      Utilities.newBlob(pdfHtml, 'text/html', 'claim.html').getAs('application/pdf')
        .setName(prefix + '_여비청구및영수증.pdf'));
    created.push(pdfFile.getId());

    // 수정용 상세 데이터 (_수정용데이터 폴더)
    const detail = {
      version: 2,
      submittedAt: Utilities.formatDate(new Date(), getTz_(), 'yyyy-MM-dd HH:mm'),
      rows: rows.map(r => ({
        date: r.date, origin: r.origin, waypoint: r.waypoint, destination: r.destination,
        transport: r.transport, km: r.km, fare: r.transport === CONFIG.CAR ? 0 : r.fare,
        meals: r.meals, lodging: r.lodging, etc: r.etc,
        daily: r.dailyManual == null ? '' : r.dailyManual, // '' = 자동
      })),
      category: category, categoryEtc: categoryEtc, unionCar: unionCar, fareReason: fareReason,
      bank: bank, account: account, holder: holder,
      receipts: receipts,
      routeImages: routeImages,
      pdfId: pdfFile.getId(),
    };
    const detailFile = getDataFolder_(folder).createFile(
      Utilities.newBlob(JSON.stringify(detail), 'application/json', detailFileName_(user.사번)));
    created.push(detailFile.getId());

    // 시트 저장 (1인 1행: 이미 있으면 덮어쓰기)
    const join = k => rows.map(r => r[k]).join('\n');
    const values = {
      마감여부: CONFIG.OPEN_STATUS,
      제출일시: new Date(),
      출장ID: tripId,
      출장목적: trip.출장목적,
      사번: user.사번,
      성명: user.성명,
      소속: user.소속,
      출장시작일: startDate,
      출장종료일: endDate,
      출발지: join('origin'),
      경과지: rows.some(r => r.waypoint) ? join('waypoint') : '',
      도착지: join('destination'),
      교통편: join('transport'),
      '이동거리(km)': totals.km,
      운임_유류비: totals.fare,
      일비: totals.daily,
      숙박비: totals.lodging,
      식비: totals.meal,
      기타비용: totals.etc,
      총청구금액: totals.total,
      운임청구사유: fareReason,
      입금은행: bank,
      계좌번호: account,
      예금주: holder,
      '여비 청구 및 영수증': pdfFile.getUrl(),
    };

    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      const sheet = getSS_().getSheetByName(CONFIG.SHEET_CLAIM);
      if (!sheet) throw new Error("'" + CONFIG.SHEET_CLAIM + "' 시트를 찾을 수 없습니다.");
      const headers = ensureClaimHeaders_(sheet);
      const mine = findMyClaims_(user.사번)[tripId];
      if (mine && mine.locked) throw new Error('마감된 청구는 수정할 수 없습니다.');
      const rowNo = mine ? mine.rowNo : sheet.getLastRow() + 1;

      CLAIM_TEXT_COLS.forEach(name => {
        const i = headers.indexOf(name);
        if (i >= 0) sheet.getRange(rowNo, i + 1).setNumberFormat('@');
      });
      // 표준 헤더에 없는 열(예: 예전 영수증링크 열)은 비워 둠
      const row = headers.map(h => (h in values ? values[h] : ''));
      sheet.getRange(rowNo, 1, 1, row.length).setValues([row]);
      SpreadsheetApp.flush();
    } finally {
      lock.releaseLock();
    }

    // 이전 제출물 정리 (휴지통으로 이동) — 예전 버전의 영수증·지도 개별 파일 포함
    if (prev) {
      let old = [prev._fileId, prev.pdfId].concat(prev.mapIds || []);
      if ((prev.version || 1) < 2) old = old.concat((prev.receipts || []).map(r => r.id));
      trashFiles_(old);
    }

    return { ok: true, total: totals.total, pdfUrl: pdfFile.getUrl(), updated: !!prev };
  } catch (e) {
    trashFiles_(created);
    return { ok: false, message: e.message };
  }
}

// 입력 줄 검증 + 금액 계산 (유류비·일비·식비는 서버에서 다시 계산)
function validateRows_(input, trip, unionCar) {
  // 출발지만 채워진 줄(화면에서 줄 추가 후 비워둔 줄)은 빈 줄로 보고 제외 (식비만 고른 줄은 판단에서 제외)
  const list = (Array.isArray(input) ? input : []).filter(r => r && (
    String(r.destination || '').trim() || String(r.waypoint || '').trim() || Number(r.km) ||
    Number(r.fare) || Number(r.lodging) || Number(r.etc)
  ));
  if (!list.length) throw new Error('청구 내역을 1줄 이상 입력하세요.');
  if (list.length > CONFIG.MAX_ROWS) throw new Error('청구 내역은 최대 ' + CONFIG.MAX_ROWS + '줄까지 입력할 수 있습니다.');

  const rows = list.map((r, i) => {
    // 화면이 보낸 줄 번호(no)를 써서 화면의 같은 줄을 가리키게 함 (빈 줄이 중간에 있어도 어긋나지 않음)
    const no = Math.floor(Number(r.no));
    const n = (no > 0 ? no : i + 1) + '번째 줄: ';
    const date = String(r.date || '').trim();
    if (!isDateStr_(date)) throw new Error(n + '일자를 입력하세요.');
    if (isDateStr_(trip.출장시작일) && date < trip.출장시작일) throw new Error(n + '일자가 출장 기간보다 이릅니다.');
    if (isDateStr_(trip.출장종료일) && date > trip.출장종료일) throw new Error(n + '일자가 출장 기간을 지났습니다.');

    const origin = String(r.origin || '').trim();
    const destination = String(r.destination || '').trim();
    const waypoint = splitWaypoints_(r.waypoint).join(', ');
    if (!origin || !destination) throw new Error(n + '출발지와 도착지를 모두 입력하세요.');
    if (splitWaypoints_(waypoint).length > CONFIG.MAX_WAYPOINTS) throw new Error(n + '경과지는 최대 ' + CONFIG.MAX_WAYPOINTS + '곳입니다.');

    const move = isMove_({ origin: origin, waypoint: waypoint, destination: destination });
    const transport = String(r.transport || '').trim();
    if (transport && CONFIG.TRANSPORTS.indexOf(transport) < 0) throw new Error(n + '교통편이 올바르지 않습니다.');
    if (move && !transport) throw new Error(n + '교통편을 선택하세요.');

    const km = move ? Math.max(0, Math.round((Number(r.km) || 0) * 10) / 10) : 0;
    if (transport === CONFIG.CAR && move && km <= 0) throw new Error(n + '자차는 이동거리를 계산해야 합니다.');

    const meals = Math.min(CONFIG.MAX_MEALS, Math.max(0, Math.floor(Number(r.meals) || 0)));
    return {
      date: date, origin: origin, waypoint: waypoint, destination: destination, transport: transport, km: km,
      fare: transport === CONFIG.CAR ? Math.round(km * trip.유류대) : toWon_(r.fare),
      meals: meals, meal: meals * CONFIG.MEAL_PRICE,
      lodging: toWon_(r.lodging), etc: toWon_(r.etc), daily: 0,
      dailyManual: String(r.daily == null ? '' : r.daily).trim() === '' ? null : toWon_(r.daily), // 직접 입력한 일비
      mapImage: move ? cleanImage_(r.mapImage) : null, // 화면에서 캡처한 지도 (거리 표시 포함)
    };
  });

  // 일비: 날짜별 1회, 전체 이동거리 기준으로 단가 결정
  const totalKm = rows.reduce((a, r) => a + r.km, 0);
  // 조합차량(법인차량)을 이용했으면 1일 일비에서 감액
  const full = totalKm > CONFIG.DAILY_LONG_KM ? CONFIG.DAILY_LONG : CONFIG.DAILY_BASE;
  const rate = Math.max(0, full - (unionCar ? CONFIG.UNION_CAR_DAILY_CUT : 0));
  const seen = {};
  rows.forEach(r => {
    if (seen[r.date]) return;
    seen[r.date] = true;
    r.daily = rate;
  });
  // 직접 입력한 일비가 있으면 자동값 대신 사용
  rows.forEach(r => { if (r.dailyManual != null) r.daily = r.dailyManual; });
  return rows;
}

// 이동거리가 있는 줄마다 PDF용 경로 지도 → [{ caption, mime, b64, error }]
// 화면 캡처 이미지가 있으면 그것을, 없으면 예비 지도 생성. km는 서버 길찾기로 다시 확인.
function buildRouteEvidence_(rows) {
  const out = [];
  let key = null;
  rows.forEach((r, i) => {
    if (!(r.km > 0 && isMove_(r))) return;
    const label = (i + 1) + '. ' + r.date + '  ' + [r.origin].concat(splitWaypoints_(r.waypoint), [r.destination]).join(' → ');
    try {
      key = key || getKakaoKey_();
      const route = computeRoute_(r.origin, r.waypoint, r.destination, key);
      const img = r.mapImage || { mime: 'image/png', b64: Utilities.base64Encode(buildRouteMap_(route).getBytes()) };
      out.push({
        caption: label + '  |  카카오 길찾기 ' + route.km + 'km (청구 ' + r.km + 'km)',
        mime: img.mime, b64: img.b64,
      });
    } catch (e) {
      out.push({
        caption: label + '  |  청구 ' + r.km + 'km',
        mime: r.mapImage ? r.mapImage.mime : '', b64: r.mapImage ? r.mapImage.b64 : '',
        error: '경로 확인 실패: ' + e.message,
      });
    }
  });
  return out;
}

// 표준 헤더 중 없는 열을 제자리에 삽입 → 최종 헤더 배열 반환
function ensureClaimHeaders_(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());

  if (headers.every(h => !h)) {
    sheet.getRange(1, 1, 1, CLAIM_HEADERS.length).setValues([CLAIM_HEADERS]);
    return CLAIM_HEADERS.slice();
  }

  CLAIM_HEADERS.forEach((name, i) => {
    if (headers.indexOf(name) >= 0) return;
    // 바로 앞 표준 헤더 뒤에 삽입
    let after = -1;
    for (let j = i - 1; j >= 0 && after < 0; j--) after = headers.indexOf(CLAIM_HEADERS[j]);
    if (after < 0) {
      sheet.insertColumnBefore(1);
      sheet.getRange(1, 1).setValue(name);
      headers.unshift(name);
    } else {
      sheet.insertColumnAfter(after + 1);
      sheet.getRange(1, after + 2).setValue(name);
      headers.splice(after + 1, 0, name);
    }
  });
  return headers;
}


// ════════════════════════════════════════════════════
//  [별지 서식 제1호] 여비 청구 및 영수증 — PDF용 HTML
// ════════════════════════════════════════════════════
function buildClaimHtml_(d) {
  const e = escHtml_;
  const w = n => (n ? Number(n).toLocaleString('ko-KR') : '0');
  const md = s => { const p = s.split('-'); return Number(p[1]) + '/' + Number(p[2]); };
  // 장소 이름 아래 세부주소 (작은 글씨)
  const addr = d.addresses || {};
  const place = n => e(n) + (addr[n] ? '<div class="addr">' + e(addr[n]) + '</div>' : '');
  const places = s => splitWaypoints_(s).map(place).join('');

  const cat = CONFIG.CATEGORIES.map(c => {
    const mark = d.category === c ? 'O' : '&nbsp;&nbsp;';
    return c === '기타'
      ? '기타(' + (d.category === '기타' ? e(d.categoryEtc) : '직접 작성 요망') + ')'
      : c + '(' + mark + ')';
  });

  const bodyRows = d.rows.map(r => '<tr>'
    + '<td class="c">' + md(r.date) + '</td>'
    + '<td>' + place(r.origin) + '</td>'
    + '<td>' + places(r.waypoint) + '</td>'
    + '<td>' + place(r.destination) + '</td>'
    + '<td class="c">' + e(r.transport) + '</td>'
    + '<td class="r">' + (r.km || '') + '</td>'
    + '<td class="r">' + w(r.fare) + '</td>'
    + '<td class="r">' + w(r.daily) + '</td>'
    + '<td class="r">' + (r.lodging ? w(r.lodging) : '') + '</td>'
    + '<td class="r">' + (r.meal ? w(r.meal) : '') + '</td>'
    + '<td class="r">' + (r.etc ? w(r.etc) : '') + '</td>'
    + '</tr>');
  for (let i = d.rows.length; i < CONFIG.FORM_MIN_ROWS; i++) {
    bodyRows.push('<tr>' + '<td>&nbsp;</td>'.repeat(11) + '</tr>');
  }

  const t = d.totals;

  let html = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>'
    + '@page { size: A4; margin: 12mm 12mm; }'
    + 'body { font-family: "Noto Sans KR", "Malgun Gothic", sans-serif; font-size: 10pt; color: #000; }'
    + '.form-no { font-size: 9pt; margin-bottom: 4px; }'
    + 'h1 { text-align: center; font-size: 20pt; letter-spacing: 6px; margin: 8px 0 14px; }'
    + 'h2 { font-size: 13pt; margin: 0 0 10px; border-bottom: 2px solid #000; padding-bottom: 4px; }'
    + 'table { width: 100%; border-collapse: collapse; }'
    + 'td, th { border: 1px solid #000; padding: 4px 5px; height: 18px; font-weight: normal; }'
    + '.lbl { background: #ffff66; text-align: center; font-weight: bold; white-space: nowrap; }'
    + '.hl { background: #ffff66; text-align: center; }'
    + '.c { text-align: center; } .r { text-align: right; } .b { font-weight: bold; }'
    + '.detail td, .detail th { font-size: 9pt; }'
    + '.addr { font-size: 7pt; color: #444; line-height: 1.25; margin-top: 1px; }'
    + '.gap { height: 10px; }'
    + '.plain td { border: 0; }'
    + '.sig { position: relative; display: inline-block; width: 110px; text-align: center; }'
    + '.sig img { position: absolute; left: 5px; top: -22px; width: 100px; height: 50px; }'
    + '.page { page-break-before: always; }'
    + '.evi { margin-bottom: 14px; page-break-inside: avoid; }'
    + '.evi img { max-width: 100%; max-height: 230mm; border: 1px solid #999; }'
    + '.cap { font-size: 9pt; margin: 4px 0 6px; }'
    + '</style></head><body>'

    + '<div class="form-no">[별지 서식 제1호]</div>'
    + '<h1>여비 청구 및 영수증</h1>'

    + '<table>'
    + '<colgroup><col style="width:12%"><col style="width:13%"><col style="width:15%"><col style="width:12%"><col style="width:15%"><col style="width:14%"><col style="width:19%"></colgroup>'
    + '<tr><td class="lbl">소 &nbsp; 속</td><td colspan="4">' + e(d.user.소속) + '</td><td class="lbl">성 &nbsp; 명</td><td>' + e(d.user.성명) + '</td></tr>'
    + '<tr><td class="lbl">출 장 지</td><td colspan="6">' + e(d.trip.기본도착지) + '</td></tr>'
    + '<tr><td class="lbl">출장목적</td><td colspan="6">' + e(d.trip.출장목적) + '</td></tr>'
    + '<tr><td class="lbl">여 &nbsp; 비</td><td class="c">계산액</td><td class="r">' + w(t.total) + '</td>'
    + '<td class="c">정산액</td><td class="r">' + w(t.total) + '</td>'
    + '<td class="c">청구(반납)액</td><td class="r">' + w(t.total) + '</td></tr>'
    + '<tr><td class="lbl">구 &nbsp; 분</td><td colspan="4" class="hl">' + cat.slice(0, 3).join(', ') + ',<br>' + cat[3] + '</td>'
    + '<td class="c">조합차량<br>(법인차량)<br>이용여부</td><td class="c">' + d.unionCar + '</td></tr>'
    + '</table>'

    + '<table class="detail" style="border-top:0">'
    + '<colgroup><col style="width:6%"><col style="width:12%"><col style="width:10%"><col style="width:12%"><col style="width:8%"><col style="width:7%">'
    + '<col style="width:9%"><col style="width:8%"><col style="width:9%"><col style="width:10%"><col style="width:9%"></colgroup>'
    + '<tr><th class="hl" rowspan="2">일자</th><th class="hl" colspan="5">구간</th>'
    + '<th class="hl" rowspan="2">운임</th><th class="hl" rowspan="2">일비</th><th class="hl" rowspan="2">숙박비</th>'
    + '<th class="hl" rowspan="2">식비</th><th class="hl" rowspan="2">기타</th></tr>'
    + '<tr><th class="hl">출발지</th><th class="hl">경과지</th><th class="hl">도착지</th><th class="hl">교통편</th><th class="hl">km</th></tr>'
    + bodyRows.join('')
    + '<tr><td colspan="6" class="c b">합계</td>'
    + '<td class="r b">' + w(t.fare) + '</td><td class="r b">' + w(t.daily) + '</td><td class="r b">' + w(t.lodging) + '</td>'
    + '<td class="r b">' + w(t.meal) + '</td><td class="r b">' + w(t.etc) + '</td></tr>'
    + '</table>'

    + '<div class="gap"></div>'
    + '<table><colgroup><col style="width:16%"><col></colgroup>'
    + '<tr><td class="lbl">운임청구사유</td><td>' + e(d.fareReason) + '</td></tr></table>'

    + '<p style="margin-top:18px">「사무규칙」 제11조제1항에 의하여 관계서류를 첨부하여 위와 같이 여비의 정산을 신청합니다.</p>'
    + '<p>첨 부 : 여비 증빙 관련서류(증빙이 필요한 경우)</p>'
    + '<p class="c" style="margin:18px 0 26px">' + d.submitDate + '</p>'

    + '<table class="plain"><tr>'
    + '<td style="width:20%">신청인</td>'
    + '<td class="r" style="width:40%">성 &nbsp; 명 &nbsp;&nbsp; ' + e(d.user.성명) + '</td>'
    + '<td style="width:40%"><span class="sig">(서 &nbsp; 명)'
    + (d.signature ? '<img src="data:image/png;base64,' + d.signature + '">' : '') + '</span></td>'
    + '</tr></table>';

  // 증빙 영수증
  if (d.receipts.length) {
    html += '<div class="page"><h2>증빙 영수증</h2>';
    d.receipts.forEach((r, i) => {
      html += '<div class="evi"><div class="cap">영수증 ' + (i + 1) + ' · ' + e(r.name) + '</div>'
        + '<img src="data:' + r.mimeType + ';base64,' + r.data + '"></div>';
    });
    html += '</div>';
  }

  // 경로 지도 + 직접 첨부한 경로 증빙 사진
  const extra = d.routeImages || [];
  if (d.maps.length || extra.length) {
    html += '<div class="page"><h2>이동 경로 증빙</h2>';
    d.maps.forEach(m => {
      html += '<div class="evi"><div class="cap b">' + e(m.caption) + '</div>'
        + (m.b64 ? '<img src="data:' + m.mime + ';base64,' + m.b64 + '">' : '')
        + (m.error ? '<div class="cap">' + e(m.error) + '</div>' : '')
        + '</div>';
    });
    extra.forEach((r, i) => {
      html += '<div class="evi"><div class="cap b">첨부 경로 증빙 ' + (i + 1) + ' · ' + e(r.name) + '</div>'
        + '<img src="data:' + r.mimeType + ';base64,' + r.data + '"></div>';
    });
    html += '</div>';
  }

  return html + '</body></html>';
}


// ════════════════════════════════════════════════════
//  드라이브
//  (링크 공유는 하지 않음 — 스크립트 소유자 드라이브에 비공개 저장)
// ════════════════════════════════════════════════════

// base64 이미지 확인 → { mime, b64 } (JPEG/PNG만, 크기 제한)
function cleanImage_(data) {
  const b64 = String(data || '').replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
  if (!b64) return null;
  const mime = b64.indexOf('/9j/') === 0 ? 'image/jpeg' : b64.indexOf('iVBOR') === 0 ? 'image/png' : '';
  if (!mime) return null;
  if (b64.length * 0.75 > CONFIG.MAX_IMAGE_BYTES) throw new Error('이미지가 너무 큽니다 (최대 5MB).');
  return { mime: mime, b64: b64 };
}

// 이전 제출 이미지 중 유지할 것 + 새 이미지 → [{ id, name, mimeType, data }]
function mergeImages_(prevList, keepIds, newFiles, idPrefix, label) {
  const keep = (Array.isArray(keepIds) ? keepIds : []).map(String);
  const out = [];
  (prevList || []).forEach(r => {
    if (keep.indexOf(String(r.id)) < 0) return;
    const img = r.data ? { mime: r.mimeType, b64: r.data } : legacyReceiptImage_(r.id);
    if (img) out.push({ id: String(r.id), name: r.name, mimeType: img.mime, data: img.b64 });
  });
  (Array.isArray(newFiles) ? newFiles : []).forEach((file, i) => {
    const img = cleanImage_(file.data);
    if (!img) throw new Error((file.name || label) + ': 이미지 파일만 첨부할 수 있습니다.');
    out.push({ id: idPrefix + Date.now() + '_' + i, name: String(file.name || label), mimeType: img.mime, data: img.b64 });
  });
  if (out.length > CONFIG.MAX_FILES) throw new Error(label + ' 사진은 최대 ' + CONFIG.MAX_FILES + '장까지 첨부할 수 있습니다.');
  return out;
}

// 예전 버전에서 드라이브에 따로 저장했던 영수증 파일 → 이미지 데이터
function legacyReceiptImage_(fileId) {
  try {
    const blob = DriveApp.getFileById(fileId).getBlob();
    if (!/^image\//.test(blob.getContentType())) return null;
    return { mime: blob.getContentType(), b64: Utilities.base64Encode(blob.getBytes()) };
  } catch (e) {
    return null;
  }
}

// 휴지통으로 이동 (영구 삭제 아님 — 30일 내 복구 가능)
function trashFiles_(ids) {
  (ids || []).forEach(id => {
    if (!id) return;
    try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { /* 이미 없음 */ }
  });
}

function getRootFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('DRIVE_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* 삭제됐으면 새로 생성 */ }
  }
  const folder = DriveApp.createFolder(CONFIG.DRIVE_FOLDER_NAME);
  props.setProperty('DRIVE_FOLDER_ID', folder.getId());
  return folder;
}

function getTripFolder_(tripId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const root = getRootFolder_();
    const name = safeName_(tripId);
    const it = root.getFoldersByName(name);
    return it.hasNext() ? it.next() : root.createFolder(name);
  } finally {
    lock.releaseLock();
  }
}


// ════════════════════════════════════════════════════
//  공통 유틸
// ════════════════════════════════════════════════════
function getSS_() {
  return SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}

let tz_ = null;
function getTz_() {
  if (!tz_) tz_ = getSS_().getSpreadsheetTimeZone();
  return tz_;
}

function readTable_(sheetName) {
  const sheet = getSS_().getSheetByName(sheetName);
  if (!sheet) throw new Error("'" + sheetName + "' 시트를 찾을 수 없습니다.");
  const values = sheet.getDataRange().getValues();
  const headers = (values[0] || []).map(h => String(h).trim());
  return {
    name: sheetName,
    sheet: sheet,
    headers: headers,
    rows: values.slice(1),
    idx: name => headers.indexOf(name),
  };
}

function requireCols_(t, names) {
  const cols = {};
  names.forEach(n => {
    const i = t.idx(n);
    if (i < 0) throw new Error("'" + t.name + "' 시트에 '" + n + "' 열이 없습니다.");
    cols[n] = i;
  });
  return cols;
}

function normalizeEmpId_(v) {
  return String(v == null ? '' : v).replace(/\s/g, '');
}

function normalizeName_(v) {
  return String(v == null ? '' : v).replace(/\s/g, '');
}

// 셀이 숫자라 앞자리 0이 빠진 경우도 같은 사번으로 인정
function sameEmpId_(cell, empId) {
  const a = normalizeEmpId_(cell);
  if (!a || !empId) return false;
  return a === empId || a.replace(/^0+/, '') === empId.replace(/^0+/, '');
}

function fmtDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, getTz_(), 'yyyy-MM-dd');
  return String(v == null ? '' : v).trim();
}

function isDateStr_(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function toWon_(v) {
  const n = Number(String(v == null ? '' : v).replace(/[,\s원]/g, ''));
  return n > 0 ? Math.round(n) : 0;
}

function safeName_(s) {
  return String(s).replace(/[\\/:*?"<>|\s]+/g, '_');
}

function escHtml_(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}


// ════════════════════════════════════════════════════
//  관리자용: 최초 설정 / 테스트 (편집기에서 직접 실행)
// ════════════════════════════════════════════════════
function setup() {
  [CONFIG.SHEET_CLAIM, CONFIG.SHEET_TRIP, CONFIG.SHEET_MEMBER, CONFIG.SHEET_BRANCH].forEach(name => {
    Logger.log((getSS_().getSheetByName(name) ? '✅ ' : '❌ 없음: ') + name);
  });

  const headers = ensureClaimHeaders_(getSS_().getSheetByName(CONFIG.SHEET_CLAIM));
  Logger.log('✅ 여비 청구 데이터 헤더: ' + headers.filter(Boolean).join(' | '));

  const folder = getRootFolder_();
  Logger.log('✅ 첨부 폴더: ' + folder.getName() + ' → ' + folder.getUrl());

  const props = PropertiesService.getScriptProperties();
  Logger.log(props.getProperty('KAKAO_REST_API_KEY') ? '✅ KAKAO_REST_API_KEY 등록됨' : '❌ KAKAO_REST_API_KEY 미등록 (스크립트 속성에 추가하세요)');
  Logger.log(props.getProperty('KAKAO_JS_KEY') ? '✅ KAKAO_JS_KEY 등록됨' : '⚠ KAKAO_JS_KEY 미등록 — 화면 지도가 카카오 대신 기본 지도로 나옵니다');
}

// 거리 계산 + 예비 지도 생성 확인 → 드라이브 첨부 폴더에 test_route.png 저장
function testDistance() {
  const branches = getBranchNames_();
  if (!branches.length) { Logger.log('지사별 주소 탭에 지사가 없습니다.'); return; }
  const key = getKakaoKey_();
  const route = computeRoute_(branches[0], '', '세종특별자치시청', key);
  Logger.log('거리: ' + route.km + 'km / 경로점 ' + route.path.length + '개');
  const file = getRootFolder_().createFile(buildRouteMap_(route).setName('test_route.png'));
  Logger.log('지도: ' + file.getUrl());
}

// 공휴일 조회 확인
function testHolidays() {
  const y = Utilities.formatDate(new Date(), getTz_(), 'yyyy');
  Logger.log(JSON.stringify(getHolidaySet_(y + '-01-01', y + '-12-31'), null, 1));
  Logger.log('예: ' + y + '-09-28 ~ ' + y + '-10-10 중간 근무일 → ' + middleWorkDays_(y + '-09-28', y + '-10-10').join(', '));
}

// PDF 서식 모양 확인용 (샘플 데이터로 PDF 생성 → 첨부 폴더에 저장)
function testPdf() {
  const html = buildClaimHtml_({
    user: { 성명: '홍길동', 소속: '대전지사' },
    trip: { 기본도착지: '진주(공단 본부)', 출장목적: '2026년 임금 및 단체협약 교섭 역량강화 워크숍' },
    rows: [
      { date: '2026-08-05', origin: '대전지사', waypoint: '', destination: '진주(본부)', transport: 'KTX', km: 0, fare: 0, daily: 25000, lodging: 0, meal: 16000, etc: 0 },
      { date: '2026-08-06', origin: '진주(본부)', waypoint: '', destination: '진주(본부)', transport: '', km: 0, fare: 0, daily: 25000, lodging: 0, meal: 8000, etc: 0 },
      { date: '2026-08-07', origin: '진주(본부)', waypoint: '', destination: '대전지사', transport: 'KTX', km: 0, fare: 0, daily: 25000, lodging: 0, meal: 16000, etc: 0 },
    ],
    totals: { km: 0, fare: 0, daily: 75000, lodging: 0, meal: 40000, etc: 0, total: 115000 },
    category: '근무지외', categoryEtc: '', unionCar: '무', fareReason: '대중교통 이용',
    submitDate: '2026년 08월 25일', signature: '', receipts: [], maps: [],
  });
  const blob = Utilities.newBlob(html, 'text/html', 'x.html').getAs('application/pdf').setName('test_여비청구서식.pdf');
  Logger.log('PDF: ' + getRootFolder_().createFile(blob).getUrl());
}
