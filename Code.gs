/**
 * ════════════════════════════════════════════════════
 *  한국승강기안전공단노동조합 여비 청구 미니 ERP — 서버 스크립트 (Code.gs)
 * ════════════════════════════════════════════════════
 *
 * ▶ 시트 구성 (헤더 이름으로 열을 찾으므로 열 순서는 상관없음)
 *   - 여비 청구 데이터 : 출장 1건당 1인 1행 (여러 구간은 줄바꿈으로 합쳐 기록, 금액·km는 합계)
 *                        상태: 제출 → 보완요청(보완 메모가 직원 화면에 표시, 고쳐 내면 다시 '제출')
 *                              → 확인완료 → 마감   (확인완료·마감이면 직원은 수정 불가)
 *                        소속 = 직원이 확인한 근무 지사, 소속(등록) = 대상자 명단에 적힌 지사
 *   - 제출 현황        : 출장별 대상·제출·보완요청·미제출 요약 (스크립트가 다시 만드는 탭 — 직접 고치지 마세요)
 *   - 출장 관리        : 출장명 | 출장목적 | 기본도착지 | 출장시작일 | 출장종료일 | 마감여부
 *                        (유류대 열을 두고 값을 적으면 그 출장만 그 단가 사용 — 보통은 비워 두세요)
 *   - 식수             : 출장명 | 일자 | 식수(끼) | 비고   (담당자가 정하면 직원 화면 식비 칸이 그 끼니로 고정)
 *                        일자를 비우면 그 출장 전체 기간에 적용, 일자를 적은 줄이 우선. 탭이 없거나 줄이 없으면 직원이 직접 선택
 *   - 유류대           : 적용시작일 | 유류대(원/km) | 비고
 *                        분기마다 한 줄 추가 (예: 2026-10-01 | 307). 출장시작일 기준으로
 *                        그날 이전에 시작한 가장 최근 단가가 적용됨. setup 실행 시 탭이 없으면 만들어 줌
 *   - 대상자 명단      : 출장명 | 사번 | 성명 | 소속(= 지사별 주소의 지사 이름)
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
 *   스프레드시트를 다시 열면 위쪽 메뉴에 '여비 관리'가 생김 (새 출장 등록 · 설정 점검 · 제출 현황 · 보완요청 · PDF 폴더 정리)
 *
 * ▶ 출장명 = 출장을 구분하는 이름 (출장 관리·대상자 명단·여비 청구 데이터를 이 값으로 연결)
 *   출장마다 겹치지 않게 적으세요 (예: 2026 임단협 워크숍(10/14)). 예전 '출장ID' 머리글도 그대로 읽힘
 *
 * ▶ 제출 시 생성물 (드라이브 / 여비청구_첨부 / 연도 / '시작일~종료일 출장명' 폴더)
 *   - 출장명_사번_성명_출장일자.pdf        ← 이것 하나 (서식 + 서명 + 영수증 이미지 + 경로 지도)
 *   - _수정용데이터 / _상세_사번.json      ← 수정할 때 입력값·영수증을 다시 불러오는 데이터 (마감되면 자동 정리)
 *   - _이전제출 / …_이전제출_날짜.pdf     ← 다시 제출하면 이전 PDF를 여기로 옮겨 보관
 */

const CONFIG = {
  SPREADSHEET_ID: '1fH_EhDUjcTW50ulYCZLRSGL0HzTNLGOcfGAIPVbzb4s',
  SHEET_CLAIM:  '여비 청구 데이터',
  SHEET_TRIP:   '출장 관리',
  SHEET_MEMBER: '대상자 명단',
  SHEET_BRANCH: '지사별 주소',
  SHEET_FUEL:   '유류대',
  SHEET_MEAL:   '식수',
  ORG_NAME:     '한국승강기안전공단',   // 지사 이름 검색 시 앞에 붙임 (예: 한국승강기안전공단 대전지사)
  HOLIDAY_CALENDAR: 'ko.south_korea#holiday@group.v.calendar.google.com',

  // 금액 기준
  DEFAULT_FUEL_RATE: 307,               // 유류대 탭이 없거나 해당 기간 단가가 없을 때만 쓰는 예비 단가 (원/km)
  DAILY_BASE:   25000,                  // 일비 (1일)
  DAILY_LONG:   30000,                  // 전체 이동거리가 DAILY_LONG_KM 초과 시 일비
  DAILY_LONG_KM: 300,
  INNER_CATEGORY:   '근무지내',           // 식비 없음, 일비는 출장 시간 기준
  INNER_DAILY_LONG:  30000,             // 근무지내 4시간 이상 일비
  INNER_DAILY_SHORT: 20000,             // 근무지내 4시간 미만 일비
  INNER_HOURS: ['4시간 이상', '4시간 미만'],
  UNION_CAR_DAILY_CUT: 10000,           // 조합차량(법인차량) 이용 시 1일 일비 감액
  MEAL_PRICE:   8400,                   // 식비 1끼
  MEAL_DAY_MAX: 25000,                  // 식비 하루 상한 (3끼 = 25,000원)
  MAX_MEALS:    3,

  OPEN_STATUS:  '진행중',               // 출장 관리 마감여부
  CLOSED_STATUS: '마감',
  // 여비 청구 데이터 '상태' (사람별)
  ST_SUBMIT: '제출', ST_FIX: '보완요청', ST_OK: '확인완료', ST_CLOSED: '마감',
  SHEET_BOARD:  '제출 현황',
  PREV_FOLDER_NAME: '_이전제출',
  TRANSPORTS:   ['자차', '동승', 'KTX', '버스', '도보'],
  CAR:          '자차',                 // 유류비 자동 계산 대상
  RIDE:         '동승',                 // 운임 0원 (일비·식비 등은 동일)
  RECEIPT_TRANSPORTS: ['KTX', '버스', '자차'], // 이 교통편으로 이동한 줄이 있으면 운임 영수증 필수
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
  '상태', '보완 메모', '보완 이력', '제출일시', '출장명', '출장목적', '사번', '성명', '소속', '소속(등록)', '출장시작일', '출장종료일',
  '출발지', '경과지', '도착지', '교통편', '이동거리(km)', '운임_유류비', '일비', '숙박비', '식비', '식수 변경', '기타비용',
  '총청구금액', '운임청구사유', '입금은행', '계좌번호', '예금주', '여비 청구 및 영수증',
];
const CLAIM_STATUSES = [CONFIG.ST_SUBMIT, CONFIG.ST_FIX, CONFIG.ST_OK, CONFIG.ST_CLOSED];

// 시트 상태 값 → 표준 값 (예전 '진행중'·빈칸은 '제출')
function claimStatus_(v) {
  const s = String(v == null ? '' : v).trim();
  return CLAIM_STATUSES.indexOf(s) >= 0 ? s : CONFIG.ST_SUBMIT;
}
// 직원이 더 이상 고칠 수 없는 상태
function isLockedStatus_(st) {
  return st === CONFIG.ST_OK || st === CONFIG.ST_CLOSED;
}
function lockedMessage_(st) {
  return st === CONFIG.ST_OK ? '담당자가 확인완료한 청구는 고칠 수 없습니다. 고칠 것이 있으면 담당자에게 보완요청을 부탁하세요.'
    : '마감된 청구는 수정할 수 없습니다.';
}

// 숫자로 바뀌면 앞자리 0이 사라지는 열 → 텍스트 서식으로 저장
const CLAIM_TEXT_COLS = ['출장명', '사번', '계좌번호'];


// ════════════════════════════════════════════════════
//  웹앱 진입점
// ════════════════════════════════════════════════════
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('한국승강기안전공단노동조합 여비 청구')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL); // Netlify 등 다른 주소의 페이지 안에서도 열리게
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
      tripCheck: tripCheck_(auth.tripIds), // 출장이 0건일 때 이유 안내용
      branches: getBranchNames_(),
      transports: CONFIG.TRANSPORTS,
      kakaoJsKey: PropertiesService.getScriptProperties().getProperty('KAKAO_JS_KEY') || '',
      rules: {
        dailyBase: CONFIG.DAILY_BASE, dailyLong: CONFIG.DAILY_LONG, dailyLongKm: CONFIG.DAILY_LONG_KM,
        unionCarDailyCut: CONFIG.UNION_CAR_DAILY_CUT,
        innerDailyLong: CONFIG.INNER_DAILY_LONG, innerDailyShort: CONFIG.INNER_DAILY_SHORT,
        mealPrice: CONFIG.MEAL_PRICE, mealDayMax: CONFIG.MEAL_DAY_MAX, maxMeals: CONFIG.MAX_MEALS, maxFiles: CONFIG.MAX_FILES,
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
  const c = requireCols_(t, ['출장명', '사번', '성명', '소속']);

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
    const tripId = String(row[c.출장명]).trim();
    if (tripId && tripIds.indexOf(tripId) < 0) tripIds.push(tripId);
  });

  if (!user) throw new Error('사번 또는 성명이 일치하지 않습니다.');
  return { user, tripIds };
}

// 본인에게 배정된 출장 중 '진행중'인 것만 (withWorkDays: 중간 근무일 목록 포함)
function getOpenTrips_(tripIds, empId, withWorkDays) {
  const t = readTable_(CONFIG.SHEET_TRIP);
  const c = requireCols_(t, ['출장명', '출장목적', '기본도착지', '출장시작일', '출장종료일', '마감여부']);
  const rateCol = t.idx('유류대');
  const mine = findMyClaims_(empId);

  const trips = [];
  t.rows.forEach(row => {
    const id = String(row[c.출장명]).trim();
    if (!id || tripIds.indexOf(id) < 0) return;
    if (String(row[c.마감여부]).trim() !== CONFIG.OPEN_STATUS) return;
    const rate = rateCol >= 0 ? toWon_(row[rateCol]) : 0; // 출장별로 따로 적은 단가 (보통 비어 있음)
    const start = fmtDate_(row[c.출장시작일]);
    const trip = {
      출장명:     id,
      출장목적:   String(row[c.출장목적]).trim(),
      기본도착지: String(row[c.기본도착지]).trim(),
      출장시작일: fmtDate_(row[c.출장시작일]),
      출장종료일: fmtDate_(row[c.출장종료일]),
      유류대:     rate > 0 ? rate : fuelRateFor_(start),
      청구상태:   mine[id] ? mine[id].status : '미제출',   // 미제출 · 제출 · 보완요청 · 확인완료 · 마감
      보완메모:   mine[id] && mine[id].status === CONFIG.ST_FIX ? mine[id].memo : '',
      식수:       mealPlanFor_(id),   // 담당자가 정한 식수 { 'yyyy-MM-dd': 끼니, '*': 전체 기간 } 또는 null
    };
    if (withWorkDays) trip.근무일 = middleWorkDays_(trip.출장시작일, trip.출장종료일);
    trips.push(trip);
  });
  return trips;
}

// 출장 목록이 비었을 때 이유: 대상자 명단의 출장명이 출장 관리에 있는지, 마감여부가 '진행중'인지
function tripCheck_(tripIds) {
  const t = readTable_(CONFIG.SHEET_TRIP);
  const idCol = t.idx('출장명'), stCol = t.idx('마감여부');
  const status = {};
  t.rows.forEach(r => { const id = String(r[idCol]).trim(); if (id) status[id] = String(r[stCol]).trim(); });
  return tripIds.map(id => ({ id: id, found: id in status, status: status[id] || '' }));
}

// 출장명 → { rowNo, status, memo, branch, locked }  (본인 제출 행)
function findMyClaims_(empId) {
  const out = {};
  const sheet = getSS_().getSheetByName(CONFIG.SHEET_CLAIM);
  if (!sheet || sheet.getLastRow() < 2) return out;
  const t = readTable_(CONFIG.SHEET_CLAIM);
  const idCol = t.idx('출장명'), empCol = t.idx('사번'), stCol = t.idx('상태'), atCol = t.idx('제출일시'), purposeCol = t.idx('출장목적');
  const memoCol = t.idx('보완 메모'), brCol = t.idx('소속');
  if (idCol < 0 || empCol < 0) return out;
  t.rows.forEach((row, i) => {
    if (!sameEmpId_(row[empCol], empId)) return;
    const id = String(row[idCol]).trim();
    if (!id) return;
    const status = claimStatus_(stCol >= 0 ? row[stCol] : '');
    // 같은 출장에 행이 여러 개면 마지막 행 기준, 하나라도 잠긴 상태면 잠금
    const at = atCol >= 0 && row[atCol] instanceof Date ? Utilities.formatDate(row[atCol], getTz_(), 'yyyy-MM-dd HH:mm') : String(atCol >= 0 ? row[atCol] : '').trim();
    const purpose = purposeCol >= 0 ? String(row[purposeCol]).trim() : '';
    out[id] = {
      rowNo: i + 2, submittedAt: at, purpose: purpose, status: status,
      memo: memoCol >= 0 ? String(row[memoCol]).trim() : '',
      branch: brCol >= 0 ? String(row[brCol]).trim() : '',
      locked: isLockedStatus_(status) || (out[id] ? out[id].locked : false),
    };
  });
  return out;
}

// 유류대 탭 → 그 날짜에 적용되는 단가 (적용시작일 ≤ 날짜 중 가장 최근)
// 날짜가 비었으면 오늘 기준, 탭이 없거나 맞는 줄이 없으면 CONFIG.DEFAULT_FUEL_RATE
// 식수 탭 → 출장명별 { 'yyyy-MM-dd': 끼니, '*': 일자를 비운 줄(전체 기간) }  (없으면 null)
let mealPlans_ = null;
function mealPlanFor_(tripName) {
  if (!mealPlans_) {
    mealPlans_ = {};
    if (getSS_().getSheetByName(CONFIG.SHEET_MEAL)) {
      const t = readTable_(CONFIG.SHEET_MEAL);
      const nCol = t.idx('출장명'), dCol = t.idx('일자');
      const mCol = t.headers.findIndex(h => h.indexOf('식수') === 0);
      if (nCol >= 0 && mCol >= 0) {
        t.rows.forEach(r => {
          const name = String(r[nCol]).trim(), raw = String(r[mCol]).trim();
          if (!name || raw === '') return;
          const n = Math.min(CONFIG.MAX_MEALS, Math.max(0, Math.floor(Number(raw.replace(/[^\d.]/g, '')) || 0)));
          const d = dCol >= 0 ? fmtDate_(r[dCol]) : '';
          (mealPlans_[name] = mealPlans_[name] || {})[isDateStr_(d) ? d : '*'] = n;
        });
      }
    }
  }
  return mealPlans_[String(tripName).trim()] || null;
}

let fuelRates_ = null;
function fuelRateFor_(date) {
  if (!fuelRates_) {
    fuelRates_ = [];
    if (getSS_().getSheetByName(CONFIG.SHEET_FUEL)) {
      const t = readTable_(CONFIG.SHEET_FUEL);
      const dCol = t.idx('적용시작일');
      const rCol = t.headers.findIndex(h => h.indexOf('유류대') === 0);
      if (dCol >= 0 && rCol >= 0) {
        t.rows.forEach(r => {
          const d = fmtDate_(r[dCol]), v = toWon_(r[rCol]);
          if (isDateStr_(d) && v > 0) fuelRates_.push([d, v]);
        });
        fuelRates_.sort((a, b) => a[0].localeCompare(b[0]));
      }
    }
  }
  const day = isDateStr_(date) ? date : Utilities.formatDate(new Date(), getTz_(), 'yyyy-MM-dd');
  let rate = 0;
  fuelRates_.forEach(([d, v]) => { if (d <= day) rate = v; });
  return rate || CONFIG.DEFAULT_FUEL_RATE;
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
    if (mine.locked) throw new Error(lockedMessage_(mine.status));

    const folder = findTripFolder_(tripId, false);
    const detail = folder ? loadDetail_(folder, auth.user.사번) : null;
    // 시트에 제출 행은 있는데 수정용 데이터 파일이 없음 (시트에 직접 넣은 행, 예전 버전 제출 등)
    if (!detail) return { ok: true, claim: null, legacy: { rowNo: mine.rowNo, submittedAt: mine.submittedAt, purpose: mine.purpose } };
    return {
      ok: true,
      status: mine.status, memo: mine.status === CONFIG.ST_FIX ? mine.memo : '',
      claim: {
        branch: detail.branch || mine.branch || '', // 직원이 확인한 근무 지사
        rows: detail.rows,
        category: detail.category, categoryEtc: detail.categoryEtc, innerHours: detail.innerHours,
        unionCar: detail.unionCar, fareReason: detail.fareReason,
        bank: detail.bank, account: detail.account, holder: detail.holder,
        receipts: (detail.receipts || []).map(r => ({ id: r.id, name: r.name })),
        routeImages: (detail.routeImages || []).map(r => ({ id: r.id, name: r.name, row: r.row })), // row = 증빙하는 줄 (저장 순서)
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

// 장소 이름들 → { addresses: { 이름: 세부주소 }, errors: { 이름: 못 찾은 이유 } }  (화면 표·PDF 표 주소 표시용)
// 지사별 주소 탭에 있는 이름은 시트 주소를 그대로 씀 (카카오 호출 없음)
function lookupAddresses(names) {
  try {
    const branches = branchAddressMap_();
    const out = {}, errors = {};
    let key = null;
    (Array.isArray(names) ? names : []).slice(0, 100).forEach(n => {
      const q = String(n || '').trim();
      if (!q || q in out) return;
      const sheetAddr = branches[q.replace(/\s/g, '')];
      if (sheetAddr) { out[q] = sheetAddr; return; }
      try {
        key = key || getKakaoKey_();
        out[q] = resolvePlace_(q, key).address || '';
        if (!out[q]) errors[q] = '검색 결과에 주소가 없습니다.';
      } catch (e) {
        out[q] = '';
        errors[q] = e.message;
      }
    });
    return { ok: true, addresses: out, errors: errors };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

// 지사별 주소 탭 → { 띄어쓰기 뺀 지사 이름: 주소 }  (주소가 빈 지사는 제외)
function branchAddressMap_() {
  const map = {};
  if (!getSS_().getSheetByName(CONFIG.SHEET_BRANCH)) return map;
  const t = readTable_(CONFIG.SHEET_BRANCH);
  const nameCol = t.idx('지사'), addrCol = t.idx('주소');
  if (nameCol < 0 || addrCol < 0) return map;
  t.rows.forEach(r => {
    const name = String(r[nameCol]).replace(/\s/g, ''), addr = String(r[addrCol]).trim();
    if (name && addr) map[name] = addr;
  });
  return map;
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
    if (isLockedStatus_(trip.청구상태)) throw new Error(lockedMessage_(trip.청구상태));

    // 소속: 등록된 소속이 실제와 다르면 직원이 화면에서 바꾼 값 (지사별 주소 탭에 있는 이름만)
    const branch = String(f.branch || '').trim() || user.소속;
    if (branch !== user.소속 && getBranchNames_().map(b => b.replace(/\s/g, '')).indexOf(branch.replace(/\s/g, '')) < 0) {
      throw new Error("소속 '" + branch + "'이(가) 소속 목록에 없습니다. 목록에서 골라 주세요.");
    }
    const who = Object.assign({}, user, { 소속: branch }); // PDF의 소속 칸은 이번 청구의 소속

    const unionCar = f.unionCar === '유' ? '유' : '무';
    const category = CONFIG.CATEGORIES.indexOf(f.category) >= 0 ? f.category : '근무지외';
    const inner = category === CONFIG.INNER_CATEGORY;
    const innerHours = inner ? (CONFIG.INNER_HOURS.indexOf(f.innerHours) >= 0 ? f.innerHours : CONFIG.INNER_HOURS[0]) : '';
    const rows = validateRows_(f.rows, trip, {
      unionCar: unionCar === '유', inner: inner, innerLong: innerHours === CONFIG.INNER_HOURS[0],
    });
    const sum = k => rows.reduce((a, r) => a + r[k], 0);
    const totals = {
      km: Math.round(sum('km') * 10) / 10,
      fare: sum('fare'), daily: sum('daily'), lodging: sum('lodging'), meal: sum('meal'), etc: sum('etc'),
    };
    totals.total = totals.fare + totals.daily + totals.lodging + totals.meal + totals.etc;
    if (totals.total <= 0) throw new Error('청구 금액이 0원입니다.');

    const categoryEtc = category === '기타' ? String(f.categoryEtc || '').trim() : '';
    if (category === '기타' && !categoryEtc) throw new Error('구분이 기타이면 내용을 입력하세요.');
    const fareReason = String(f.fareReason || '').trim();
    if (rows.some(r => r.transport === CONFIG.CAR && r.km > 0) && !/^[1-5]\./.test(fareReason)) {
      throw new Error('자차를 이용한 줄이 있으면 운임청구사유를 1~5번 중에서 선택하세요.');
    }

    const bank = String(f.bank || '').trim();
    const account = String(f.account || '').trim();
    const holder = String(f.holder || '').trim();
    if (!bank || !account || !holder) throw new Error('입금 계좌 정보를 모두 입력하세요.');
    if (!/^[\d-]+$/.test(account)) throw new Error('계좌번호는 숫자와 - 만 입력하세요.');

    const sig = cleanImage_(f.signature);
    if (!sig) throw new Error('서명을 입력하세요.');

    const folder = findTripFolder_(tripId, true, trip);
    const prev = loadDetail_(folder, user.사번);

    // 영수증·경로 증빙 사진: 이전 제출분 중 유지할 것 + 새로 올린 것 (모두 이미지, 파일로 따로 저장하지 않음)
    const keepIds = Array.isArray(f.keepReceiptIds) ? f.keepReceiptIds.map(String) : [];
    const receipts = mergeImages_(prev && prev.receipts, keepIds, f.receipts, 'r', '영수증');
    const routeImages = mergeImages_(prev && prev.routeImages, f.keepRouteIds, f.routeImages, 'p', '경로 증빙', f.keepRouteNos);
    if (rows.some(r => isMove_(r) && CONFIG.RECEIPT_TRANSPORTS.indexOf(r.transport) >= 0) && !receipts.length) {
      throw new Error('대중교통(KTX·버스)이나 자차를 이용한 줄이 있으면 운임 영수증을 1장 이상 첨부하세요.');
    }

    const dates = rows.map(r => r.date).sort();
    const startDate = dates[0], endDate = dates[dates.length - 1];
    // PDF 이름: 출장명_사번_성명_출장일자 (여러 날이면 시작일~종료일)
    const pdfName = [tripId, user.사번, user.성명, startDate === endDate ? startDate : startDate + '~' + endDate]
      .join('_').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() + '.pdf'; // 파일 이름에 못 쓰는 글자만 '-'로

    // 구간별 경로 지도 (km는 서버에서 다시 길찾기로 확인)
    const maps = buildRouteEvidence_(rows);
    // 별도 경로 증빙 사진은 화면에서 고른 줄에 연결 → 그 줄의 PDF 증빙은 자동 지도 대신 이 사진
    const idxByNo = {};
    rows.forEach((r, i) => { idxByNo[r.no] = i; });
    routeImages.forEach(img => {
      const i = idxByNo[img.no];
      if (i == null || !(rows[i].km > 0 && isMove_(rows[i]))) {
        throw new Error('별도 경로 증빙 사진 \'' + img.name + '\': 어느 줄의 증빙인지 골라 주세요.');
      }
      img.row = i; // 저장된 줄 순서 (다시 불러올 때 같은 줄에 연결)
      delete img.no;
    });
    maps.forEach(m => {
      m.photos = routeImages.filter(img => img.row === m.row);
      if (m.differs && !m.photos.length) {
        const r = rows[m.row];
        throw new Error(r.no + '번째 줄: 이동거리 ' + r.km + 'km가 카카오 길찾기 ' + m.kakaoKm
          + 'km와 달라서 그 줄의 길찾기(네비) 캡처가 필요합니다. 별도 경로 증빙 사진에 올리고 줄을 골라 주세요.');
      }
    });

    // 서식 PDF (이것 하나만 드라이브에 남김)
    const pdfHtml = buildClaimHtml_({
      user: who, trip: trip, rows: rows, totals: totals,
      category: category, categoryEtc: categoryEtc, innerHours: innerHours, unionCar: unionCar, fareReason: fareReason,
      submitDate: Utilities.formatDate(new Date(), getTz_(), 'yyyy년 MM월 dd일'),
      signature: sig.b64, receipts: receipts, maps: maps, routeImages: routeImages,
    });
    const pdfFile = folder.createFile(
      Utilities.newBlob(pdfHtml, 'text/html', 'claim.html').getAs('application/pdf')
        .setName(pdfName));
    created.push(pdfFile.getId());

    // 수정용 상세 데이터 (_수정용데이터 폴더)
    const detail = {
      version: 2,
      submittedAt: Utilities.formatDate(new Date(), getTz_(), 'yyyy-MM-dd HH:mm'),
      rows: rows.map(r => ({
        date: r.date, origin: r.origin, waypoint: r.waypoint, destination: r.destination,
        transport: r.transport, km: r.km, fare: r.transport === CONFIG.CAR ? 0 : r.fare,
        meals: r.meals, lodging: r.lodging, etc: r.etc,
        mealReason: r.mealChange ? r.mealChange.reason : '', // 담당자 지정 식수를 바꾼 사유
        daily: r.dailyManual == null ? '' : r.dailyManual, // '' = 자동
      })),
      branch: branch,
      category: category, categoryEtc: categoryEtc, innerHours: innerHours, unionCar: unionCar, fareReason: fareReason,
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
    const md = d => d.slice(5);
    const values = {
      상태: CONFIG.ST_SUBMIT,
      '보완 메모': '',
      제출일시: new Date(),
      출장명: tripId,
      출장목적: trip.출장목적,
      사번: user.사번,
      성명: user.성명,
      소속: branch,
      '소속(등록)': user.소속,
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
      '식수 변경': rows.filter(r => r.mealChange)
        .map(r => md(r.date) + ' ' + r.mealChange.from + '→' + r.mealChange.to + '끼 (' + r.mealChange.reason + ')').join('\n'),
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
      if (mine && mine.locked) throw new Error(lockedMessage_(mine.status));
      const rowNo = mine ? mine.rowNo : sheet.getLastRow() + 1;
      const old = mine ? sheet.getRange(rowNo, 1, 1, headers.length).getValues()[0] : null;

      // 보완 이력: 다시 낼 때마다 한 줄씩 (보완요청 중이었으면 그 메모도 함께 남김)
      if (old) {
        const now = Utilities.formatDate(new Date(), getTz_(), 'MM-dd HH:mm');
        const hist = String(old[headers.indexOf('보완 이력')] || '').trim();
        const line = mine.status === CONFIG.ST_FIX
          ? now + ' 재제출 (보완요청: ' + (mine.memo || '메모 없음') + ')'
          : now + ' 수정 제출';
        values['보완 이력'] = (hist ? hist + '\n' : '') + line;
      }

      CLAIM_TEXT_COLS.forEach(name => {
        const i = headers.indexOf(name);
        if (i >= 0) sheet.getRange(rowNo, i + 1).setNumberFormat('@');
      });
      // 표준 헤더에 없는 열(관리자가 추가한 메모 열 등)은 기존 값 유지
      const row = headers.map((h, i) => (h in values ? values[h] : old ? old[i] : ''));
      sheet.getRange(rowNo, 1, 1, row.length).setValues([row]);
      SpreadsheetApp.flush();
    } finally {
      lock.releaseLock();
    }

    // 이전 제출물 정리: 이전 PDF는 _이전제출 폴더로 옮겨 보관, 나머지(수정용 데이터·예전 개별 파일)는 휴지통
    if (prev) {
      keepPreviousPdf_(folder, prev.pdfId, prev.submittedAt);
      let old = [prev._fileId].concat(prev.mapIds || []);
      if ((prev.version || 1) < 2) old = old.concat((prev.receipts || []).map(r => r.id));
      trashFiles_(old);
    }
    try { refreshStatusBoard_(true); } catch (e) { Logger.log('제출 현황 갱신 실패: ' + e.message); }

    return { ok: true, total: totals.total, pdfUrl: pdfFile.getUrl(), updated: !!prev };
  } catch (e) {
    trashFiles_(created);
    return { ok: false, message: e.message };
  }
}

// 입력 줄 검증 + 금액 계산 (유류비·일비·식비는 서버에서 다시 계산)
// opts: { unionCar: 조합차량(법인차량) 이용, inner: 근무지내, innerLong: 근무지내 4시간 이상 }
function validateRows_(input, trip, opts) {
  opts = opts || {};
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

    // 근무지내는 식비 없음
    const meals = opts.inner ? 0 : Math.min(CONFIG.MAX_MEALS, Math.max(0, Math.floor(Number(r.meals) || 0)));
    return {
      no: no > 0 ? no : i + 1, // 화면의 줄 번호 (경로 증빙 사진 연결용)
      date: date, origin: origin, waypoint: waypoint, destination: destination, transport: transport, km: km,
      fare: transport === CONFIG.CAR ? Math.round(km * trip.유류대) : transport === CONFIG.RIDE ? 0 : toWon_(r.fare),
      meals: meals, meal: meals * CONFIG.MEAL_PRICE,
      lodging: toWon_(r.lodging), etc: toWon_(r.etc), daily: 0,
      dailyManual: String(r.daily == null ? '' : r.daily).trim() === '' ? null : toWon_(r.daily), // 직접 입력한 일비
      mealReason: String(r.mealReason || '').trim().slice(0, 100), // 담당자 지정 식수를 바꾼 사유
      mapImage: move ? cleanImage_(r.mapImage) : null, // 화면에서 캡처한 지도 (거리 표시 포함)
      needsProof: move && r.needsProof === true, // 화면에서 이동거리를 길찾기와 다르게 고친 줄
    };
  });

  // 일비: 날짜별 1회, 전체 이동거리 기준으로 단가 결정
  const totalKm = rows.reduce((a, r) => a + r.km, 0);
  // 조합차량(법인차량)을 이용했으면 1일 일비에서 감액
  // 근무지내는 출장 시간 기준(4시간 이상/미만), 그 외는 전체 이동거리 기준
  const full = opts.inner ? (opts.innerLong ? CONFIG.INNER_DAILY_LONG : CONFIG.INNER_DAILY_SHORT)
    : totalKm > CONFIG.DAILY_LONG_KM ? CONFIG.DAILY_LONG : CONFIG.DAILY_BASE;
  const rate = Math.max(0, full - (opts.unionCar ? CONFIG.UNION_CAR_DAILY_CUT : 0));
  const seen = {};
  rows.forEach(r => {
    if (seen[r.date]) return;
    seen[r.date] = true;
    r.daily = rate;
  });
  // 직접 입력한 일비가 있으면 자동값 대신 사용
  rows.forEach(r => { if (r.dailyManual != null) r.daily = r.dailyManual; });
  // 담당자가 정한 식수가 있으면 그 날짜 첫 줄에 그 끼니, 같은 날 다른 줄은 0끼 (직원 입력보다 우선)
  // 단, 직원이 사유를 적고 첫 줄의 끼니를 바꿨으면 그 값을 쓰고 '식수 변경'으로 기록
  const plan = opts.inner ? null : trip.식수;
  if (plan) {
    const planSeen = {};
    rows.forEach(r => {
      const n = Object.prototype.hasOwnProperty.call(plan, r.date) ? plan[r.date] : plan['*'];
      if (n == null) return;
      const first = !planSeen[r.date];
      planSeen[r.date] = true;
      if (first && r.mealReason && r.meals !== n) {
        r.mealChange = { from: n, to: r.meals, reason: r.mealReason };
      } else {
        r.meals = first ? n : 0;
      }
      r.meal = r.meals * CONFIG.MEAL_PRICE;
    });
  }
  // 식비: 1끼 단가 × 끼니, 같은 날짜 합계는 하루 상한까지만 (3끼 = 25,000원)
  const mealUsed = {};
  rows.forEach(r => {
    const used = mealUsed[r.date] || 0;
    r.meal = Math.max(0, Math.min(r.meal, CONFIG.MEAL_DAY_MAX - used));
    mealUsed[r.date] = used + r.meal;
  });
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
        // 캡처가 필요한 줄: 화면에서 거리를 고친 줄, 또는 서버 길찾기와 크게 다른 줄
        // (길찾기는 실시간 교통으로 거리가 조금씩 달라져서 서버 확인은 5km·10%까지 허용)
        row: i, kakaoKm: route.km,
        differs: r.needsProof || Math.abs(route.km - r.km) > Math.max(5, route.km * 0.1),
        caption: label + '  |  카카오 길찾기 ' + route.km + 'km (청구 ' + r.km + 'km)',
        mime: img.mime, b64: img.b64,
      });
    } catch (e) {
      out.push({
        row: i,
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
  const legacyKey = headers.indexOf('출장ID');
  if (legacyKey >= 0 && headers.indexOf('출장명') < 0) {
    sheet.getRange(1, legacyKey + 1).setValue('출장명'); // 기존 제출 행은 그대로 연결됨
    headers[legacyKey] = '출장명';
  }
  // 예전 '마감여부'(진행중/마감) → '상태'(제출/보완요청/확인완료/마감). '진행중'은 '제출'로 바꿈
  const legacyStatus = headers.indexOf('마감여부');
  if (legacyStatus >= 0 && headers.indexOf('상태') < 0) {
    sheet.getRange(1, legacyStatus + 1).setValue('상태');
    headers[legacyStatus] = '상태';
    const n = sheet.getLastRow() - 1;
    if (n > 0) {
      const r = sheet.getRange(2, legacyStatus + 1, n, 1);
      r.setValues(r.getValues().map(v => [String(v[0]).trim() ? claimStatus_(v[0]) : '']));
    }
  }

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
//  ※ 1쪽 서식(표 구성·문구·칸 이름)은 처음 양식 그대로 유지. 바꾸지 마세요.
//    (직원 화면 5단계의 미리보기도 같은 서식을 그대로 씀 — Index.html formSheetHtml)
//    증빙 서류(2쪽부터)만 이 앱에서 덧붙인 부분
// ════════════════════════════════════════════════════
function buildClaimHtml_(d) {
  const e = escHtml_;
  const w = n => (n ? Number(n).toLocaleString('ko-KR') : '0');
  const md = s => { const p = s.split('-'); return Number(p[1]) + '/' + Number(p[2]); };

  const cat = CONFIG.CATEGORIES.map(c => {
    const mark = d.category === c ? 'O' : '&nbsp;&nbsp;';
    return c === '기타'
      ? '기타(' + (d.category === '기타' ? e(d.categoryEtc) : '직접 작성 요망') + ')'
      : c + '(' + mark + ')';
  });

  const bodyRows = d.rows.map(r => '<tr>'
    + '<td class="c">' + md(r.date) + '</td>'
    + '<td>' + e(r.origin) + '</td>'
    + '<td>' + e(r.waypoint) + '</td>'
    + '<td>' + e(r.destination) + '</td>'
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
    + '.gap { height: 10px; }'
    + '.plain td { border: 0; }'
    + '.sig { position: relative; display: inline-block; width: 110px; text-align: center; }'
    + '.sig img { position: absolute; left: 5px; top: -22px; width: 100px; height: 50px; }'
    + '.page { page-break-before: always; }'
    + 'h3 { font-size: 11pt; margin: 0 0 6px; padding: 3px 6px; background: #f0f0f0; border-left: 4px solid #000; }'
    + 'h3.next { margin-top: 10px; }'
    + 'h3 .cap { font-weight: normal; }'
    + '.tiles { table-layout: fixed; }'
    + '.tiles td { border: 0; padding: 0 6px 10px; vertical-align: top; text-align: center; }'
    + '.tiles tr { page-break-inside: avoid; }'
    + '.tiles .cap { text-align: left; }'
    + '.tiles img { max-width: 100%; max-height: 100mm; border: 1px solid #999; }'  /* 영수증 한 줄 + 경로 한 줄이 A4 한 쪽에 들어가는 높이 */
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
    + '<td class="c">조합차량<br>이용여부</td><td class="c">' + d.unionCar + '</td></tr>'
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

  // 증빙 서류: 한 쪽에 윗부분은 운임 영수증, 아랫부분은 이동 경로 증빙 (많으면 다음 쪽으로 이어짐)
  // 경로 증빙은 줄마다 직접 올린 길찾기 캡처가 있으면 그것, 없으면 자동 경로 지도
  const receiptTiles = d.receipts.map((r, i) => ({
    head: '운임 영수증 ' + (i + 1), sub: r.name, mime: r.mimeType, b64: r.data,
  }));
  const routeTiles = [];
  d.maps.forEach(m => {
    const photos = m.photos || [];
    if (photos.length) {
      photos.forEach((p, i) => routeTiles.push({
        head: m.caption,
        sub: '직접 첨부한 경로 증빙' + (photos.length > 1 ? ' ' + (i + 1) + '/' + photos.length : '') + ' · ' + p.name,
        mime: p.mimeType, b64: p.data,
      }));
      return;
    }
    routeTiles.push({ head: m.caption, sub: m.error || '', mime: m.mime, b64: m.b64 });
  });
  // 칸 묶음 → 표 (2장 이하는 2열, 3장 이상은 3열)
  const tileTable = list => {
    const cols = list.length <= 2 ? 2 : 3;
    let t = '<table class="tiles">';
    for (let i = 0; i < list.length; i += cols) {
      t += '<tr>';
      for (let j = i; j < i + cols; j++) {
        const x = list[j];
        t += '<td style="width:' + (100 / cols) + '%">' + (!x ? '' : '<div class="cap b">' + e(x.head) + '</div>'
          + (x.sub ? '<div class="cap">' + e(x.sub) + '</div>' : '')
          + (x.b64 ? '<img src="data:' + x.mime + ';base64,' + x.b64 + '">' : '')) + '</td>';
      }
      t += '</tr>';
    }
    return t + '</table>';
  };
  if (receiptTiles.length || routeTiles.length) {
    html += '<div class="page"><h2>증빙 서류</h2>';
    if (receiptTiles.length) html += '<h3>운임 영수증 <span class="cap">' + receiptTiles.length + '장</span></h3>' + tileTable(receiptTiles);
    if (routeTiles.length) html += '<h3 class="next">이동 경로 증빙 <span class="cap">' + d.maps.length + '구간</span></h3>' + tileTable(routeTiles);
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
// keepNos가 있으면(경로 증빙) 각 이미지에 화면 줄 번호 no도 붙임 (keepIds와 같은 순서, 새 이미지는 file.no)
function mergeImages_(prevList, keepIds, newFiles, idPrefix, label, keepNos) {
  const keep = (Array.isArray(keepIds) ? keepIds : []).map(String);
  const withNo = Array.isArray(keepNos);
  const out = [];
  (prevList || []).forEach(r => {
    if (keep.indexOf(String(r.id)) < 0) return;
    const img = r.data ? { mime: r.mimeType, b64: r.data } : legacyReceiptImage_(r.id);
    if (!img) return;
    const item = { id: String(r.id), name: r.name, mimeType: img.mime, data: img.b64 };
    if (withNo) item.no = Math.floor(Number(keepNos[keep.indexOf(String(r.id))])) || 0;
    out.push(item);
  });
  (Array.isArray(newFiles) ? newFiles : []).forEach((file, i) => {
    const img = cleanImage_(file.data);
    if (!img) throw new Error((file.name || label) + ': 이미지 파일만 첨부할 수 있습니다.');
    const item = { id: idPrefix + Date.now() + '_' + i, name: String(file.name || label), mimeType: img.mime, data: img.b64 };
    if (withNo) item.no = Math.floor(Number(file.no)) || 0;
    out.push(item);
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

// 출장 폴더: 여비청구_첨부 / 연도 / '2026-10-14~10-16 출장명'
// 한 번 만든 폴더는 스크립트 속성에 ID를 기억해서, 나중에 기간·이름을 바꿔도 같은 폴더를 씀.
// 예전 위치(여비청구_첨부 / 출장명)의 폴더도 찾음 → '여비 관리 > PDF 폴더 정리'로 새 위치로 옮김
// create=false면 없을 때 null. trip(출장 정보)이 없으면 출장 관리 탭에서 찾음
function findTripFolder_(tripId, create, trip) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const props = PropertiesService.getScriptProperties();
    const key = 'FOLDER:' + tripId;
    const id = props.getProperty(key);
    if (id) {
      try {
        const f = DriveApp.getFolderById(id);
        if (!f.isTrashed()) return f;
      } catch (e) { /* 지워졌으면 아래에서 다시 찾음 */ }
    }
    const root = getRootFolder_();
    const legacy = root.getFoldersByName(safeName_(tripId));
    if (legacy.hasNext()) return legacy.next();
    if (!create) return null;

    const info = trip || tripInfo_(tripId) || {};
    const year = childFolder_(root, (info.출장시작일 || Utilities.formatDate(new Date(), getTz_(), 'yyyy')).slice(0, 4));
    const folder = year.createFolder(tripFolderLabel_(tripId, info));
    props.setProperty(key, folder.getId());
    return folder;
  } finally {
    lock.releaseLock();
  }
}

// '2026-10-14~10-16 출장명' (하루짜리는 '2026-09-23 출장명')
function tripFolderLabel_(tripId, info) {
  const a = info.출장시작일 || '', b = info.출장종료일 || '';
  const period = !a ? '' : !b || a === b ? a : a + '~' + (a.slice(0, 4) === b.slice(0, 4) ? b.slice(5) : b);
  return ((period ? period + ' ' : '') + tripId).replace(/[\\/:*?"<>|]+/g, '-');
}

function childFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

// 출장 관리 탭 → { 출장명, 출장시작일, 출장종료일, 마감여부 } (없으면 null)
function tripInfo_(tripId) {
  const t = readTable_(CONFIG.SHEET_TRIP);
  const idCol = t.idx('출장명'), sCol = t.idx('출장시작일'), eCol = t.idx('출장종료일'), stCol = t.idx('마감여부');
  const row = t.rows.find(r => String(r[idCol]).trim() === tripId);
  if (!row) return null;
  return {
    출장명: tripId,
    출장시작일: sCol >= 0 ? fmtDate_(row[sCol]) : '',
    출장종료일: eCol >= 0 ? fmtDate_(row[eCol]) : '',
    마감여부: stCol >= 0 ? String(row[stCol]).trim() : '',
  };
}

// 다시 제출할 때 이전 PDF → _이전제출 폴더로 옮기고 이름 끝에 '_이전제출_제출일시' (실패하면 휴지통)
function keepPreviousPdf_(tripFolder, pdfId, submittedAt) {
  if (!pdfId) return;
  try {
    const f = DriveApp.getFileById(pdfId);
    if (f.isTrashed()) return;
    const stamp = String(submittedAt || Utilities.formatDate(f.getDateCreated(), getTz_(), 'yyyy-MM-dd HH:mm')).replace(/[:]/g, '');
    f.setName(f.getName().replace(/\.pdf$/i, '') + '_이전제출_' + stamp + '.pdf');
    f.moveTo(childFolder_(tripFolder, CONFIG.PREV_FOLDER_NAME));
  } catch (e) {
    trashFiles_([pdfId]);
  }
}

// 예전 위치(여비청구_첨부 / 출장명)의 출장 폴더를 새 위치(연도 / 기간 출장명)로 옮기고,
// 기간이 바뀐 출장은 폴더 이름도 맞춤. 여비 관리 메뉴에서 실행
function organizeTripFolders() {
  const root = getRootFolder_();
  const props = PropertiesService.getScriptProperties();
  const t = readTable_(CONFIG.SHEET_TRIP);
  const idCol = t.idx('출장명');
  let moved = 0, renamed = 0;
  t.rows.forEach(r => {
    const id = String(r[idCol]).trim();
    if (!id) return;
    const info = tripInfo_(id);
    const folder = findTripFolder_(id, false);
    if (!folder) return;
    const label = tripFolderLabel_(id, info);
    const year = childFolder_(root, (info.출장시작일 || Utilities.formatDate(new Date(), getTz_(), 'yyyy')).slice(0, 4));
    const parents = folder.getParents();
    const parentId = parents.hasNext() ? parents.next().getId() : '';
    if (parentId !== year.getId()) { folder.moveTo(year); moved++; }
    if (folder.getName() !== label) { folder.setName(label); renamed++; }
    props.setProperty('FOLDER:' + id, folder.getId());
  });
  return '출장 폴더 ' + moved + '개를 연도 폴더로 옮기고, ' + renamed + '개의 이름을 기간·출장명으로 맞췄습니다.';
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
  // 예전 시트 호환: '출장명' 열이 없고 '출장ID' 열이 있으면 그 열을 출장명으로 읽음
  const legacyKey = headers.indexOf('출장ID');
  if (legacyKey >= 0 && headers.indexOf('출장명') < 0) headers[legacyKey] = '출장명';
  // 여비 청구 데이터: 예전 '마감여부' 열은 '상태' 열로 읽음
  const legacyStatus = headers.indexOf('마감여부');
  if (sheetName === CONFIG.SHEET_CLAIM && legacyStatus >= 0 && headers.indexOf('상태') < 0) headers[legacyStatus] = '상태';
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
//  여비 관리 메뉴 (스프레드시트 위쪽 메뉴)
//  스크립트가 이 스프레드시트에 연결돼 있을 때(확장 프로그램 → Apps Script로 연 프로젝트) 나타남
// ════════════════════════════════════════════════════
function onOpen() {
  SpreadsheetApp.getUi().createMenu('여비 관리')
    .addItem('새 출장 등록…', 'menuNewTrip')
    .addItem('설정 점검', 'menuCheck')
    .addItem('제출 현황 새로 고침', 'menuRefreshBoard')
    .addSeparator()
    .addItem('선택한 사람 보완요청…', 'menuRequestFix')
    .addItem('PDF 폴더 정리', 'menuOrganizeFolders')
    .addToUi();
}

// 출장 관리 탭에서 출장명을 적거나 고치면 겹치는 이름을 빨갛게 표시하고 알림
function onEdit(e) {
  try {
    const rg = e && e.range;
    if (!rg || rg.getRow() < 2) return;
    const sheet = rg.getSheet();
    if (sheet.getName() !== CONFIG.SHEET_TRIP) return;
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
    let col = headers.indexOf('출장명') + 1;
    if (!col) col = headers.indexOf('출장ID') + 1;
    if (!col || col < rg.getColumn() || col > rg.getLastColumn()) return;
    const n = Math.max(sheet.getLastRow() - 1, 1);
    const names = sheet.getRange(2, col, n, 1).getValues().map(v => String(v[0]).trim());
    const count = {};
    names.forEach(v => { if (v) count[v] = (count[v] || 0) + 1; });
    sheet.getRange(2, col, n, 1).setBackgrounds(names.map(v => [v && count[v] > 1 ? '#f8d7da' : null]));
    const dup = Object.keys(count).filter(v => count[v] > 1);
    if (dup.length) {
      e.source.toast(dup.join(', ') + ' — 이미 있는 출장명이에요. 출장마다 다른 이름(끝에 날짜 등)으로 바꿔 주세요.', '출장명 겹침', 10);
    }
  } catch (err) { /* 알림만 하는 기능이라 실패해도 편집은 그대로 */ }
}

function menuNewTrip() {
  const html = HtmlService.createHtmlOutput(newTripDialogHtml_(newTripData_())).setWidth(760).setHeight(640);
  SpreadsheetApp.getUi().showModalDialog(html, '새 출장 등록');
}

function menuCheck() {
  const lines = prepareSheets_().concat(checkSettings_());
  const body = lines.map(l => '<li class="' + (l.indexOf('❌') === 0 ? 'bad' : l.indexOf('⚠') === 0 ? 'warn' : '') + '">' + escHtml_(l) + '</li>').join('');
  const html = HtmlService.createHtmlOutput('<style>body{font:14px/1.6 "Malgun Gothic",sans-serif;margin:12px}ul{padding-left:18px;margin:0}'
    + 'li{margin:3px 0}.bad{color:#b42318;font-weight:bold}.warn{color:#9a4a00}</style><ul>' + body + '</ul>').setWidth(640).setHeight(520);
  SpreadsheetApp.getUi().showModalDialog(html, '설정 점검');
}

function menuRefreshBoard() {
  const ok = refreshStatusBoard_(false);
  getSS_().toast(ok ? "'" + CONFIG.SHEET_BOARD + "' 탭을 새로 만들었어요." : '다른 작업 중이라 갱신하지 못했어요. 잠시 뒤 다시 눌러 주세요.', '제출 현황', 5);
}

function menuOrganizeFolders() {
  SpreadsheetApp.getUi().alert(organizeTripFolders());
}

// 여비 청구 데이터 탭에서 선택한 행 → 상태 '보완요청' + 보완 메모
function menuRequestFix() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== CONFIG.SHEET_CLAIM) {
    ui.alert("'" + CONFIG.SHEET_CLAIM + "' 탭에서 보완요청할 사람의 행(아무 칸)을 선택한 뒤 다시 눌러 주세요.");
    return;
  }
  const rows = [];
  sheet.getActiveRangeList().getRanges().forEach(rg => {
    for (let r = rg.getRow(); r < rg.getRow() + rg.getNumRows(); r++) if (r >= 2 && rows.indexOf(r) < 0) rows.push(r);
  });
  if (!rows.length) { ui.alert('보완요청할 사람의 행을 선택해 주세요. (1행 머리글 제외)'); return; }
  const headers = ensureClaimHeaders_(sheet);
  const nameCol = headers.indexOf('성명') + 1;
  const names = rows.map(r => sheet.getRange(r, nameCol).getValue()).join(', ');
  const res = ui.prompt('보완요청 · ' + rows.length + '명 (' + names + ')',
    '직원 화면에 보일 메모를 적으세요.\n예: 10/16 영수증이 흐려요. 다시 찍어 올려 주세요.', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const memo = res.getResponseText().trim();
  if (!memo) { ui.alert('메모가 비어 있어 보완요청하지 않았습니다.'); return; }
  const stCol = headers.indexOf('상태') + 1, memoCol = headers.indexOf('보완 메모') + 1;
  rows.forEach(r => {
    sheet.getRange(r, stCol).setValue(CONFIG.ST_FIX);
    sheet.getRange(r, memoCol).setValue(memo);
  });
  refreshStatusBoard_(false);
  getSS_().toast(rows.length + '명에게 보완요청했어요. 직원이 출장을 열면 메모가 보여요.', '보완요청', 6);
}


// ── 시트 준비: 열 이름 정리 + 목록에서 고르기(데이터 확인) ─────────────
// 대상자 명단·식수의 출장명 = 출장 관리에 있는 이름만, 대상자 명단의 소속 = 지사별 주소에 있는 지사만,
// 여비 청구 데이터의 상태 = 제출/보완요청/확인완료/마감, 출장 관리의 마감여부 = 진행중/마감
function prepareSheets_() {
  const ss = getSS_(), out = [];
  const colOf = (sheet, names) => {
    const h = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0].map(v => String(v).trim());
    for (let i = 0; i < names.length; i++) { const c = h.indexOf(names[i]); if (c >= 0) return c + 1; }
    return 0;
  };
  const body = (sheet, col) => sheet.getRange(2, col, Math.max(sheet.getMaxRows() - 1, 1), 1);
  const listRule = (values, help) => SpreadsheetApp.newDataValidation().requireValueInList(values, true)
    .setAllowInvalid(false).setHelpText(help).build();

  const claim = ss.getSheetByName(CONFIG.SHEET_CLAIM);
  if (claim) {
    ensureClaimHeaders_(claim);
    const c = colOf(claim, ['상태']);
    if (c) body(claim, c).setDataValidation(listRule(CLAIM_STATUSES, '제출 · 보완요청(보완 메모를 함께 적기) · 확인완료 · 마감'));
    out.push("✅ 여비 청구 데이터: 상태·보완 메모·보완 이력·소속(등록)·식수 변경 열 준비, 상태는 목록에서 선택");
  }

  const trip = ss.getSheetByName(CONFIG.SHEET_TRIP);
  if (trip) {
    const st = colOf(trip, ['마감여부']);
    if (st) body(trip, st).setDataValidation(listRule([CONFIG.OPEN_STATUS, CONFIG.CLOSED_STATUS], '진행중 · 마감'));
    const idc = colOf(trip, ['출장명', '출장ID']);
    if (idc) {
      const tripRule = SpreadsheetApp.newDataValidation().requireValueInRange(body(trip, idc), true)
        .setAllowInvalid(false).setHelpText("'출장 관리' 탭에 있는 출장명만 고를 수 있어요.").build();
      [CONFIG.SHEET_MEMBER, CONFIG.SHEET_MEAL].forEach(name => {
        const sh = ss.getSheetByName(name);
        const c = sh ? colOf(sh, ['출장명', '출장ID']) : 0;
        if (c) { body(sh, c).setDataValidation(tripRule); out.push('✅ ' + name + ': 출장명은 출장 관리 목록에서 선택'); }
      });
    }
  }

  const branch = ss.getSheetByName(CONFIG.SHEET_BRANCH), member = ss.getSheetByName(CONFIG.SHEET_MEMBER);
  if (branch && member) {
    const bc = colOf(branch, ['지사']), mc = colOf(member, ['소속']);
    if (bc && mc) {
      body(member, mc).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(body(branch, bc), true)
        .setAllowInvalid(false).setHelpText("'지사별 주소' 탭에 있는 지사만 고를 수 있어요.").build());
      out.push('✅ 대상자 명단: 소속은 지사별 주소 목록에서 선택');
    }
  }
  return out;
}

// 설정 점검 → 결과 줄 목록 (✅ 정상 · ⚠ 확인 필요 · ❌ 고쳐야 함)
function checkSettings_() {
  const ss = getSS_(), out = [];
  [CONFIG.SHEET_CLAIM, CONFIG.SHEET_TRIP, CONFIG.SHEET_MEMBER, CONFIG.SHEET_BRANCH, CONFIG.SHEET_FUEL, CONFIG.SHEET_MEAL].forEach(n => {
    if (!ss.getSheetByName(n)) out.push('❌ 탭이 없음: ' + n);
  });
  if (!ss.getSheetByName(CONFIG.SHEET_TRIP)) return out;

  const trips = readTable_(CONFIG.SHEET_TRIP), idc = trips.idx('출장명');
  const sc = trips.idx('출장시작일'), ec = trips.idx('출장종료일'), stc = trips.idx('마감여부');
  const rowsById = {};
  trips.rows.forEach((r, i) => {
    const id = String(r[idc]).trim();
    if (!id) return;
    (rowsById[id] = rowsById[id] || []).push(i + 2);
    const a = fmtDate_(r[sc]), b = fmtDate_(r[ec]);
    if (String(r[stc]).trim() === CONFIG.CLOSED_STATUS) return;
    if (!isDateStr_(a) || !isDateStr_(b)) out.push('❌ 출장 관리 ' + (i + 2) + '행 ' + id + ': 출장시작일·출장종료일을 날짜로 적어 주세요');
    else if (a > b) out.push('❌ 출장 관리 ' + (i + 2) + '행 ' + id + ': 시작일이 종료일보다 늦어요');
  });
  const dup = Object.keys(rowsById).filter(id => rowsById[id].length > 1);
  out.push(dup.length ? '❌ 겹치는 출장명: ' + dup.map(id => id + '(' + rowsById[id].join('·') + '행)').join(', ') : '✅ 출장명 겹침 없음');

  [CONFIG.SHEET_MEMBER, CONFIG.SHEET_MEAL].forEach(name => {
    if (!ss.getSheetByName(name)) return;
    const t = readTable_(name), c = t.idx('출장명');
    if (c < 0) { out.push('❌ ' + name + ": '출장명' 열이 없어요"); return; }
    const missing = {};
    t.rows.forEach((r, i) => { const v = String(r[c]).trim(); if (v && !rowsById[v] && v.indexOf('(예시)') !== 0) (missing[v] = missing[v] || []).push(i + 2); });
    const k = Object.keys(missing);
    out.push(k.length ? '❌ ' + name + '에 출장 관리에 없는 출장명: ' + k.map(v => v + '(' + missing[v].join('·') + '행)').join(', ') : '✅ ' + name + ' 출장명 모두 연결됨');
  });

  if (ss.getSheetByName(CONFIG.SHEET_MEMBER)) {
    const branches = branchAddressMap_(), names = {};
    getBranchNames_().forEach(b => { names[b.replace(/\s/g, '')] = true; });
    const m = readTable_(CONFIG.SHEET_MEMBER), c = m.idx('소속');
    const bad = {};
    if (c >= 0) m.rows.forEach((r, i) => { const v = String(r[c]).trim(); if (v && !names[v.replace(/\s/g, '')]) (bad[v] = bad[v] || []).push(i + 2); });
    const k = Object.keys(bad);
    out.push(k.length ? '❌ 대상자 명단 소속 중 지사별 주소에 없는 이름: ' + k.map(v => v + '(' + bad[v].slice(0, 5).join('·') + '행)').join(', ') : '✅ 대상자 명단 소속 모두 지사 목록에 있음');
    const noAddr = getBranchNames_().filter(b => !branches[b.replace(/\s/g, '')]);
    if (noAddr.length) out.push('⚠ 지사별 주소에 주소가 빈 지사: ' + noAddr.join(', ') + ' (카카오 검색으로 찾음)');
  }

  out.push('✅ 오늘 적용 유류대: ' + fuelRateFor_('') + '원/km' + (ss.getSheetByName(CONFIG.SHEET_FUEL) ? '' : ' (유류대 탭이 없어 예비 단가)'));
  const props = PropertiesService.getScriptProperties();
  out.push(props.getProperty('KAKAO_REST_API_KEY') ? '✅ 카카오 REST API 키 등록됨' : '❌ 카카오 REST API 키 없음 (프로젝트 설정 → 스크립트 속성 KAKAO_REST_API_KEY)');
  out.push(props.getProperty('KAKAO_JS_KEY') ? '✅ 카카오 지도 키 등록됨' : '⚠ 카카오 지도 키 없음 — 화면 지도가 기본 지도로 나와요');
  try { out.push(ensureCleanupTrigger_()); } catch (e) { out.push('⚠ 자동 정리 등록 실패: ' + e.message + ' (편집기에서 setup을 한 번 실행하세요)'); }
  return out;
}


// ── 제출 현황 탭 ─────────────────────────────────────
// 출장마다: 기간 · 진행 · 대상 · 제출 · 보완요청 · 확인완료 · 마감 · 미제출 · 청구 합계 · 미제출자 · 확인할 것 · PDF 폴더
// fromSubmit: 직원 제출 직후 호출 (잠금이 바쁘면 건너뜀)
function refreshStatusBoard_(fromSubmit) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(fromSubmit ? 5000 : 30000)) return false;
  try {
    const ss = getSS_();
    const key = v => normalizeEmpId_(v).replace(/^0+/, '');
    const trips = readTable_(CONFIG.SHEET_TRIP);
    const tc = { id: trips.idx('출장명'), a: trips.idx('출장시작일'), b: trips.idx('출장종료일'), st: trips.idx('마감여부') };

    const targets = {}; // 출장명 → { 사번키: 성명 }
    const members = readTable_(CONFIG.SHEET_MEMBER);
    const mc = { id: members.idx('출장명'), emp: members.idx('사번'), name: members.idx('성명') };
    members.rows.forEach(r => {
      const id = String(r[mc.id]).trim(), emp = key(r[mc.emp]);
      if (id && emp) (targets[id] = targets[id] || {})[emp] = String(r[mc.name]).trim();
    });

    const claims = {}; // 출장명 → { 사번키: { status, total, branchChanged, mealChanged } }
    const cs = ss.getSheetByName(CONFIG.SHEET_CLAIM);
    if (cs && cs.getLastRow() >= 2) {
      const t = readTable_(CONFIG.SHEET_CLAIM);
      const c = { id: t.idx('출장명'), emp: t.idx('사번'), st: t.idx('상태'), total: t.idx('총청구금액'),
        br: t.idx('소속'), reg: t.idx('소속(등록)'), meal: t.idx('식수 변경') };
      t.rows.forEach(r => {
        const id = String(r[c.id]).trim(), emp = key(r[c.emp]);
        if (!id || !emp) return;
        const reg = c.reg >= 0 ? String(r[c.reg]).trim() : '';
        (claims[id] = claims[id] || {})[emp] = {
          status: claimStatus_(c.st >= 0 ? r[c.st] : ''),
          total: c.total >= 0 ? toWon_(r[c.total]) : 0,
          branchChanged: !!reg && c.br >= 0 && String(r[c.br]).trim() !== reg,
          mealChanged: c.meal >= 0 && !!String(r[c.meal]).trim(),
        };
      });
    }

    const list = trips.rows.map(r => {
      const id = String(r[tc.id]).trim();
      if (!id) return null;
      const a = fmtDate_(r[tc.a]), b = fmtDate_(r[tc.b]);
      const who = targets[id] || {}, done = claims[id] || {};
      const cnt = { 제출: 0, 보완요청: 0, 확인완료: 0, 마감: 0 };
      let total = 0, br = 0, meal = 0;
      Object.keys(done).forEach(k => {
        const x = done[k];
        cnt[x.status]++; total += x.total;
        if (x.branchChanged) br++;
        if (x.mealChanged) meal++;
      });
      const missing = Object.keys(who).filter(k => !done[k]).map(k => who[k] || k);
      const notes = [];
      if (cnt.보완요청) notes.push('보완요청 ' + cnt.보완요청);
      if (br) notes.push('소속 변경 ' + br);
      if (meal) notes.push('식수 변경 ' + meal);
      const url = tripFolderUrl_(id);
      return {
        open: String(r[tc.st]).trim() !== CONFIG.CLOSED_STATUS, start: a,
        row: [id, a === b || !b ? a : a + ' ~ ' + b, String(r[tc.st]).trim() || CONFIG.OPEN_STATUS,
          Object.keys(who).length, cnt.제출, cnt.보완요청, cnt.확인완료, cnt.마감, missing.length, total,
          missing.slice(0, 15).join(', ') + (missing.length > 15 ? ' 외 ' + (missing.length - 15) + '명' : ''),
          notes.join(' · '), url ? '=HYPERLINK("' + url + '","열기")' : ''],
      };
    }).filter(Boolean);
    // 진행중인 출장 먼저, 그 안에서는 최근 출장 먼저
    list.sort((x, y) => (y.open - x.open) || String(y.start).localeCompare(String(x.start)));

    const head = ['출장명', '기간', '진행', '대상', '제출', '보완요청', '확인완료', '마감', '미제출', '청구 합계(원)', '미제출자', '확인할 것', 'PDF 폴더'];
    let sheet = ss.getSheetByName(CONFIG.SHEET_BOARD);
    if (!sheet) sheet = ss.insertSheet(CONFIG.SHEET_BOARD);
    sheet.clear();
    const values = [head].concat(list.map(x => x.row));
    sheet.getRange(1, 1, values.length, head.length).setValues(values);
    sheet.getRange(1, 1, 1, head.length).setFontWeight('bold').setBackground('#e8eef7');
    if (list.length) sheet.getRange(2, 10, list.length, 1).setNumberFormat('#,##0');
    sheet.setFrozenRows(1);
    sheet.getRange(values.length + 2, 1).setValue('갱신 ' + Utilities.formatDate(new Date(), getTz_(), 'yyyy-MM-dd HH:mm')
      + ' · 이 탭은 직원이 제출할 때와 [여비 관리 > 제출 현황 새로 고침]에서 다시 만들어져요. 직접 고치지 마세요.').setFontColor('#666666');
    return true;
  } finally {
    lock.releaseLock();
  }
}

// 출장 폴더 주소 (잠금 없이 찾기만 함, 없으면 '')
function tripFolderUrl_(tripId) {
  try {
    const id = PropertiesService.getScriptProperties().getProperty('FOLDER:' + tripId);
    if (id) { const f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f.getUrl(); }
    const it = getRootFolder_().getFoldersByName(safeName_(tripId));
    return it.hasNext() ? it.next().getUrl() : '';
  } catch (e) {
    return '';
  }
}


// ── 새 출장 등록 ─────────────────────────────────────
// 대화상자에 넘길 자료: 기존 출장명, 지사 목록, 사번별 성명·최근 소속(직원이 확인한 소속 우선)
function newTripData_() {
  const key = v => normalizeEmpId_(v).replace(/^0+/, '');
  const people = {};
  const m = readTable_(CONFIG.SHEET_MEMBER);
  const mc = { emp: m.idx('사번'), name: m.idx('성명'), br: m.idx('소속') };
  m.rows.forEach(r => {
    const emp = normalizeEmpId_(r[mc.emp]);
    if (!emp) return;
    people[key(emp)] = { 사번: emp, 성명: String(r[mc.name]).trim(), 소속: String(r[mc.br]).trim(), from: '대상자 명단' };
  });
  const cs = getSS_().getSheetByName(CONFIG.SHEET_CLAIM);
  if (cs && cs.getLastRow() >= 2) {
    const t = readTable_(CONFIG.SHEET_CLAIM);
    const c = { emp: t.idx('사번'), name: t.idx('성명'), br: t.idx('소속') };
    t.rows.forEach(r => {
      const emp = normalizeEmpId_(r[c.emp]), br = c.br >= 0 ? String(r[c.br]).trim() : '';
      if (!emp || !br) return;
      const p = people[key(emp)] || (people[key(emp)] = { 사번: emp, 성명: String(r[c.name]).trim() });
      p.소속 = br; p.from = '직원 확인';
    });
  }
  const trips = readTable_(CONFIG.SHEET_TRIP), idc = trips.idx('출장명');
  return {
    trips: trips.rows.map(r => String(r[idc]).trim()).filter(Boolean),
    branches: getBranchNames_(),
    people: people,
    maxMeals: CONFIG.MAX_MEALS,
  };
}

// 대화상자 [등록] → 출장 관리 1줄 + 대상자 명단 n줄 + 식수 n줄
// f: { name, purpose, dest, start, end, people: [{사번, 성명, 소속}], meals: { 'yyyy-MM-dd': 끼니 } }
function createTripFromDialog(f) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    f = f || {};
    const name = String(f.name || '').trim(), purpose = String(f.purpose || '').trim(), dest = String(f.dest || '').trim();
    const start = String(f.start || '').trim(), end = String(f.end || '').trim();
    if (!name) throw new Error('출장명을 적어 주세요.');
    if (/[\\/:*?"<>|]/.test(name)) throw new Error('출장명에는 \\ / : * ? " < > | 를 쓸 수 없어요.');
    const trips = readTable_(CONFIG.SHEET_TRIP);
    if (trips.rows.some(r => String(r[trips.idx('출장명')]).trim() === name)) throw new Error("'" + name + "'은(는) 이미 있는 출장명이에요. 끝에 날짜를 붙이는 등 다르게 해 주세요.");
    if (!purpose) throw new Error('출장목적을 적어 주세요.');
    if (!dest) throw new Error('기본도착지를 적어 주세요.');
    if (!isDateStr_(start) || !isDateStr_(end)) throw new Error('기간을 날짜로 골라 주세요.');
    if (start > end) throw new Error('시작일이 종료일보다 늦어요.');

    const branchSet = {};
    getBranchNames_().forEach(b => { branchSet[b.replace(/\s/g, '')] = b; });
    const seen = {};
    const people = (Array.isArray(f.people) ? f.people : []).map((p, i) => {
      const emp = normalizeEmpId_(p.사번), nm = String(p.성명 || '').trim(), br = String(p.소속 || '').trim();
      if (!emp) return null;
      if (seen[emp]) throw new Error('사번 ' + emp + '이(가) 두 번 들어 있어요.');
      seen[emp] = true;
      if (!nm) throw new Error((i + 1) + '번째 대상자(' + emp + '): 성명을 적어 주세요.');
      if (!branchSet[br.replace(/\s/g, '')]) throw new Error((i + 1) + '번째 대상자(' + nm + '): 소속을 지사 목록에서 골라 주세요.');
      return { 출장명: name, 사번: emp, 성명: nm, 소속: branchSet[br.replace(/\s/g, '')] };
    }).filter(Boolean);
    if (!people.length) throw new Error('대상자를 1명 이상 넣어 주세요.');

    const meals = [];
    Object.keys(f.meals || {}).sort().forEach(d => {
      const raw = f.meals[d];
      if (raw === '' || raw == null || !isDateStr_(d) || d < start || d > end) return;
      meals.push({ 출장명: name, 일자: d, '식수(끼)': Math.min(CONFIG.MAX_MEALS, Math.max(0, Math.floor(Number(raw) || 0))), 비고: '새 출장 등록' });
    });

    const ss = getSS_();
    appendByHeaders_(ss.getSheetByName(CONFIG.SHEET_TRIP), [{
      출장명: name, 출장목적: purpose, 기본도착지: dest, 출장시작일: start, 출장종료일: end, 마감여부: CONFIG.OPEN_STATUS,
    }], ['출장명']);
    appendByHeaders_(ss.getSheetByName(CONFIG.SHEET_MEMBER), people, ['출장명', '사번']);
    if (meals.length) {
      let mealSheet = ss.getSheetByName(CONFIG.SHEET_MEAL);
      if (!mealSheet) {
        mealSheet = ss.insertSheet(CONFIG.SHEET_MEAL);
        mealSheet.getRange(1, 1, 1, 4).setValues([['출장명', '일자', '식수(끼)', '비고']]);
        mealSheet.setFrozenRows(1);
      }
      appendByHeaders_(mealSheet, meals, ['출장명']);
    }
    SpreadsheetApp.flush();
    lock.releaseLock();
    try { refreshStatusBoard_(false); } catch (e) { /* 현황 갱신은 다음 기회에 */ }
    return { ok: true, message: "'" + name + "' 출장을 등록했어요. 출장 관리 1줄, 대상자 명단 " + people.length + '줄' + (meals.length ? ', 식수 ' + meals.length + '줄' : '') + '을 넣었어요.' };
  } catch (e) {
    return { ok: false, message: e.message };
  } finally {
    try { lock.releaseLock(); } catch (e) { /* 이미 풀림 */ }
  }
}

// 객체 목록을 머리글 이름에 맞춰 시트 끝에 추가 (textCols는 텍스트 서식으로 — 앞자리 0 유지)
function appendByHeaders_(sheet, objs, textCols) {
  if (!sheet || !objs.length) return;
  const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0].map(h => String(h).trim());
  if (headers.indexOf('출장명') < 0 && headers.indexOf('출장ID') >= 0) headers[headers.indexOf('출장ID')] = '출장명';
  const start = sheet.getLastRow() + 1;
  (textCols || []).forEach(n => {
    const c = headers.indexOf(n);
    if (c >= 0) sheet.getRange(start, c + 1, objs.length, 1).setNumberFormat('@');
  });
  sheet.getRange(start, 1, objs.length, headers.length).setValues(objs.map(o => headers.map(h => (h in o ? o[h] : ''))));
}

function newTripDialogHtml_(data) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  body{font:14px/1.5 "Malgun Gothic","Apple SD Gothic Neo",sans-serif;margin:0;color:#1b2333}
  form{padding:4px 14px 70px;display:grid;gap:10px}
  label.f{display:grid;gap:3px;font-size:13px;color:#5d6879}
  input,select,textarea{font:inherit;color:#1b2333;border:1px solid #c9d1dc;border-radius:4px;padding:6px 8px;box-sizing:border-box;width:100%}
  textarea{height:64px}
  .row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}
  .msg{font-size:12.5px}.bad{color:#b42318;font-weight:bold}.good{color:#1d7a4a}
  table{border-collapse:collapse;width:100%}th,td{border:1px solid #dde3ea;padding:4px 6px;text-align:left;font-size:13px}
  th{background:#f1f4f8;font-weight:normal;color:#5d6879}td.need select{border-color:#b42318;background:#fdecea}
  .meals{display:flex;flex-wrap:wrap;gap:8px}.meals label{display:flex;gap:4px;align-items:center;font-size:13px}.meals select{width:auto}
  .foot{position:fixed;left:0;right:0;bottom:0;background:#fff;border-top:1px solid #dde3ea;padding:10px 14px;display:flex;gap:8px;align-items:center}
  .foot span{margin-right:auto;font-size:13px}
  button{font:inherit;border:1px solid #1b365d;background:#fff;color:#1b365d;border-radius:4px;padding:6px 14px;cursor:pointer}
  button.pri{background:#1b365d;color:#fff}button:disabled{opacity:.45;cursor:default}
  .x{border:0;color:#b42318;padding:0 4px}
  h4{margin:6px 0 0;font-size:14px}
</style></head><body><form id="f" onsubmit="return false">
  <label class="f">출장명 (출장마다 다른 이름 · 예: 2026 임단협 워크숍(11월))<input id="name" autocomplete="off"><span class="msg" id="nameMsg"></span></label>
  <label class="f">출장목적<input id="purpose"></label>
  <div class="row">
    <label class="f">기본도착지<input id="dest" list="br"></label>
    <label class="f">출장시작일<input id="start" type="date"></label>
    <label class="f">출장종료일<input id="end" type="date"></label>
  </div>
  <datalist id="br"></datalist>
  <h4>대상자</h4>
  <label class="f">사번을 줄마다 붙여넣고 [표에 넣기]. 처음 등록하는 사람은 '사번 성명 소속'처럼 (엑셀 3열 복사도 됨)
    <textarea id="paste" placeholder="20231234&#10;20190077&#10;20250311 이민수 세종지사"></textarea></label>
  <div><button type="button" id="addBtn">표에 넣기</button> <span class="msg" id="pasteMsg"></span></div>
  <table><thead><tr><th style="width:22%">사번</th><th style="width:22%">성명</th><th>소속</th><th style="width:18%">소속 출처</th><th style="width:40px"></th></tr></thead><tbody id="people"></tbody></table>
  <h4>식수 <span class="msg" style="font-weight:normal;color:#5d6879">비워 두면 직원이 직접 입력해요</span></h4>
  <div class="meals" id="meals"><span class="msg">기간을 고르면 날짜가 나와요</span></div>
</form>
<div class="foot"><span id="foot"></span><button type="button" onclick="google.script.host.close()">닫기</button><button type="button" class="pri" id="save">등록</button></div>
<script>
const DATA = ${json};
const $ = id => document.getElementById(id);
const key = v => String(v || '').replace(/\\s/g, '').replace(/^0+/, '');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let people = [];
$('br').innerHTML = DATA.branches.map(b => '<option value="' + esc(b) + '">').join('');
function check() {
  const n = $('name').value.trim(), dup = DATA.trips.indexOf(n) >= 0;
  $('nameMsg').textContent = !n ? '' : dup ? '이미 있는 출장명이에요. 끝에 날짜를 붙이는 등 다르게 해 주세요.' : '사용할 수 있는 이름이에요.';
  $('nameMsg').className = 'msg ' + (dup ? 'bad' : 'good');
  const needBranch = people.filter(p => DATA.branches.indexOf(p.소속) < 0).length;
  const ok = n && !dup && $('purpose').value.trim() && $('dest').value.trim() && $('start').value && $('end').value && $('start').value <= $('end').value && people.length && !needBranch && people.every(p => p.성명);
  $('save').disabled = !ok;
  $('foot').textContent = needBranch ? '소속을 골라야 하는 사람이 ' + needBranch + '명 있어요.'
    : $('start').value && $('end').value && $('start').value > $('end').value ? '시작일이 종료일보다 늦어요.'
    : ok ? '출장 관리 1줄, 대상자 명단 ' + people.length + '줄' + (mealCount() ? ', 식수 ' + mealCount() + '줄' : '') + '이 들어가요.' : '';
}
function mealCount() { return [...document.querySelectorAll('#meals select[data-d]')].filter(s => s.value !== '').length; }
function drawPeople() {
  $('people').innerHTML = people.map((p, i) => '<tr><td>' + esc(p.사번) + '</td>'
    + '<td><input data-i="' + i + '" data-k="성명" value="' + esc(p.성명) + '"></td>'
    + '<td class="' + (DATA.branches.indexOf(p.소속) < 0 ? 'need' : '') + '"><select data-i="' + i + '" data-k="소속"><option value="">고르세요</option>'
    + DATA.branches.map(b => '<option' + (b === p.소속 ? ' selected' : '') + '>' + esc(b) + '</option>').join('') + '</select></td>'
    + '<td class="msg">' + esc(p.from) + '</td><td><button type="button" class="x" data-del="' + i + '">삭제</button></td></tr>').join('');
  check();
}
$('people').addEventListener('change', e => { const t = e.target; if (t.dataset.k) { people[t.dataset.i][t.dataset.k] = t.value.trim(); if (t.dataset.k === '소속') people[t.dataset.i].from = '직접 선택'; drawPeople(); } });
$('people').addEventListener('click', e => { const i = e.target.dataset.del; if (i != null) { people.splice(Number(i), 1); drawPeople(); } });
$('addBtn').addEventListener('click', () => {
  let added = 0, dupl = 0;
  $('paste').value.split(/\\n/).forEach(line => {
    const t = line.trim().split(/[\\t,]+|\\s+/).filter(Boolean);
    if (!t.length || !/\\d/.test(t[0])) return;
    const emp = t[0];
    if (people.some(p => key(p.사번) === key(emp))) { dupl++; return; }
    const known = DATA.people[key(emp)] || {};
    const br = t.length >= 3 ? t.slice(2).join(' ') : known.소속 || '';
    people.push({ 사번: known.사번 || emp, 성명: t[1] || known.성명 || '', 소속: br,
      from: t.length >= 3 ? '붙여넣기' : known.from === '직원 확인' ? '지난 출장(직원 확인)' : known.from ? '대상자 명단' : '처음 등록' });
    added++;
  });
  $('paste').value = '';
  $('pasteMsg').textContent = added + '명을 넣었어요' + (dupl ? ' (이미 있는 ' + dupl + '명은 건너뜀)' : '') + '. 소속이 맞는지 확인해 주세요.';
  drawPeople();
});
function drawMeals() {
  const a = $('start').value, b = $('end').value;
  if (!a || !b || a > b) { $('meals').innerHTML = '<span class="msg">기간을 고르면 날짜가 나와요</span>'; check(); return; }
  const days = [];
  for (let d = new Date(a + 'T00:00:00'); days.length < 31; d.setDate(d.getDate() + 1)) {
    const s = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    if (s > b) break;
    days.push(s);
  }
  const opts = '<option value="">직원 입력</option>' + Array.from({ length: DATA.maxMeals + 1 }, (_, n) => '<option value="' + n + '">' + n + '끼</option>').join('');
  $('meals').innerHTML = '<label>모든 날 <select id="allMeals">' + opts + '</select></label>'
    + days.map(s => '<label>' + s.slice(5) + ' <select data-d="' + s + '">' + opts + '</select></label>').join('');
  $('allMeals').addEventListener('change', e => { document.querySelectorAll('#meals select[data-d]').forEach(s => { s.value = e.target.value; }); check(); });
  check();
}
['name', 'purpose', 'dest'].forEach(id => $(id).addEventListener('input', check));
['start', 'end'].forEach(id => $(id).addEventListener('change', drawMeals));
$('meals').addEventListener('change', check);
$('save').addEventListener('click', () => {
  const meals = {};
  document.querySelectorAll('#meals select[data-d]').forEach(s => { meals[s.dataset.d] = s.value; });
  $('save').disabled = true; $('foot').textContent = '등록하는 중…';
  google.script.run.withSuccessHandler(res => {
    if (!res.ok) { $('foot').innerHTML = '<b class="bad">' + esc(res.message) + '</b>'; $('save').disabled = false; return; }
    $('foot').innerHTML = '<b class="good">' + esc(res.message) + '</b>';
    DATA.trips.push($('name').value.trim());
    $('save').textContent = '등록됨';
  }).withFailureHandler(err => { $('foot').innerHTML = '<b class="bad">' + esc(err.message) + '</b>'; $('save').disabled = false; })
    .createTripFromDialog({ name: $('name').value.trim(), purpose: $('purpose').value.trim(), dest: $('dest').value.trim(),
      start: $('start').value, end: $('end').value, people: people, meals: meals });
});
check();
</script></body></html>`;
}


// ════════════════════════════════════════════════════
//  관리자용: 최초 설정 / 테스트 (편집기에서 직접 실행)
// ════════════════════════════════════════════════════
// ════════════════════════════════════════════════════
//  마감된 청구의 수정용 데이터 정리 (드라이브 용량 절약)
// ════════════════════════════════════════════════════
// 마감된 청구는 다시 고칠 일이 없으므로 _수정용데이터의 상세 파일(사진 사본 포함)을 휴지통으로 보냄.
// 청구서 PDF와 시트 기록은 그대로 둠. 대상: '출장 관리'에서 마감된 출장의 모든 사람
//                                     + '여비 청구 데이터'에서 상태가 '마감'인 사람
// setup()을 실행하면 매일 새벽 3시에 자동 실행되도록 등록됨. 편집기에서 직접 실행해도 됨.
// ※ 마감을 다시 '제출'·'보완요청'으로 되돌리면 그 사람은 이전 내용을 불러오지 못하고 새로 작성해야 함.
function cleanupClosedClaims() {
  const closedTrips = {};
  const trips = readTable_(CONFIG.SHEET_TRIP);
  const tIdCol = trips.idx('출장명'), tStCol = trips.idx('마감여부');
  trips.rows.forEach(r => {
    const id = String(r[tIdCol]).trim();
    if (id && String(r[tStCol]).trim() === CONFIG.CLOSED_STATUS) closedTrips[id] = true;
  });

  const targets = {}; // 출장명 → { 사번: true } (true 대신 '*'이면 그 출장 전체)
  Object.keys(closedTrips).forEach(id => { targets[id] = '*'; });
  const sheet = getSS_().getSheetByName(CONFIG.SHEET_CLAIM);
  if (sheet && sheet.getLastRow() >= 2) {
    const t = readTable_(CONFIG.SHEET_CLAIM);
    const idCol = t.idx('출장명'), empCol = t.idx('사번'), stCol = t.idx('상태');
    if (idCol >= 0 && empCol >= 0 && stCol >= 0) {
      t.rows.forEach(r => {
        const id = String(r[idCol]).trim();
        if (!id || targets[id] === '*' || claimStatus_(r[stCol]) !== CONFIG.ST_CLOSED) return;
        (targets[id] = targets[id] || {})[normalizeEmpId_(r[empCol])] = true;
      });
    }
  }

  // 출장 폴더는 찾기만 하고 새로 만들지 않음
  let removed = 0, bytes = 0;
  Object.keys(targets).forEach(id => {
    const tripFolder = findTripFolder_(id, false);
    if (!tripFolder) return;
    const want = targets[id];
    const names = want === '*' ? null : Object.keys(want).map(detailFileName_);
    const dataIt = tripFolder.getFoldersByName(CONFIG.DATA_FOLDER_NAME);
    [tripFolder].concat(dataIt.hasNext() ? [dataIt.next()] : []).forEach(folder => {
      const files = folder.getFiles();
      while (files.hasNext()) {
        const f = files.next();
        const name = f.getName();
        if (!/^_상세_.*\.json$/.test(name) || f.isTrashed()) continue;
        if (names && names.indexOf(name) < 0) continue;
        bytes += f.getSize();
        f.setTrashed(true);
        removed++;
      }
    });
  });
  const msg = '마감된 청구의 수정용 데이터 ' + removed + '개 정리 (' + Math.round(bytes / 1048576 * 10) / 10 + 'MB, 휴지통은 30일 뒤 자동으로 비워짐)';
  Logger.log(msg);
  return msg;
}

// 매일 새벽 정리 자동 실행 등록 (이미 있으면 그대로)
function ensureCleanupTrigger_() {
  const has = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'cleanupClosedClaims');
  if (!has) ScriptApp.newTrigger('cleanupClosedClaims').timeBased().everyDays(1).atHour(3).create();
  return has ? '✅ 마감 데이터 자동 정리: 이미 등록됨 (매일 새벽 3시)' : '✅ 마감 데이터 자동 정리 등록 (매일 새벽 3시)';
}

function setup() {
  [CONFIG.SHEET_CLAIM, CONFIG.SHEET_TRIP, CONFIG.SHEET_MEMBER, CONFIG.SHEET_BRANCH].forEach(name => {
    Logger.log((getSS_().getSheetByName(name) ? '✅ ' : '❌ 없음: ') + name);
  });

  // 출장 관리: 같은 출장명이 두 번 이상 쓰였는지 (같은 이름이면 서로 다른 출장도 같은 출장으로 처리됨)
  const trips = readTable_(CONFIG.SHEET_TRIP), idCol = trips.idx('출장명');
  if (idCol >= 0) {
    const rowsById = {};
    trips.rows.forEach((r, i) => {
      const id = String(r[idCol]).trim();
      if (id) (rowsById[id] = rowsById[id] || []).push(i + 2);
    });
    const dup = Object.keys(rowsById).filter(id => rowsById[id].length > 1);
    Logger.log(dup.length
      ? '❌ 출장 관리에 겹치는 출장명: ' + dup.map(id => id + '(' + rowsById[id].join('·') + '행)').join(', ') + ' — 출장마다 다른 이름으로 바꾸세요 (예: 끝에 날짜 붙이기)'
      : '✅ 출장명 겹침 없음');
  }

  // 식수 탭이 없으면 만들어 둠 (담당자가 출장별로 식수를 정할 때 사용)
  if (!getSS_().getSheetByName(CONFIG.SHEET_MEAL)) {
    const meal = getSS_().insertSheet(CONFIG.SHEET_MEAL);
    meal.getRange(1, 1, 2, 4).setValues([
      ['출장명', '일자', '식수(끼)', '비고'],
      ['(예시) 출장 관리의 출장명 그대로', '', 2, '일자를 비우면 전체 기간 · 예시 줄은 지우세요'],
    ]);
    meal.setFrozenRows(1);
    Logger.log('✅ 식수 탭을 만들었어요. 출장명·일자·식수(끼)를 적으면 직원 화면 식비 칸이 그 끼니로 고정돼요.');
  }

  // 유류대 탭이 없으면 만들어 둠 (분기마다 한 줄씩 추가해서 사용)
  let fuel = getSS_().getSheetByName(CONFIG.SHEET_FUEL);
  if (!fuel) {
    fuel = getSS_().insertSheet(CONFIG.SHEET_FUEL);
    fuel.getRange(1, 1, 2, 3).setValues([
      ['적용시작일', '유류대(원/km)', '비고'],
      ['2026-01-01', CONFIG.DEFAULT_FUEL_RATE, '예시 — 실제 분기 단가로 고치세요'],
    ]);
    fuel.getRange(2, 1).setNumberFormat('yyyy-mm-dd');
    fuel.setFrozenRows(1);
    Logger.log('✅ 유류대 탭을 만들었어요. 분기마다 적용시작일과 단가를 한 줄씩 추가하세요.');
  }
  Logger.log('✅ 오늘 적용 유류대: ' + fuelRateFor_('') + '원/km');

  const headers = ensureClaimHeaders_(getSS_().getSheetByName(CONFIG.SHEET_CLAIM));
  Logger.log('✅ 여비 청구 데이터 헤더: ' + headers.filter(Boolean).join(' | '));
  prepareSheets_().forEach(l => Logger.log(l));
  checkSettings_().filter(l => l.indexOf('✅') !== 0).forEach(l => Logger.log(l));
  Logger.log(refreshStatusBoard_(false) ? "✅ '" + CONFIG.SHEET_BOARD + "' 탭을 만들었어요" : '⚠ 제출 현황을 만들지 못했어요 (잠시 뒤 다시 실행)');
  Logger.log("ℹ 스프레드시트를 새로 고치면 위쪽에 '여비 관리' 메뉴가 생겨요 (스크립트가 시트에 연결된 경우)");

  const folder = getRootFolder_();
  Logger.log('✅ 첨부 폴더: ' + folder.getName() + ' → ' + folder.getUrl());

  const props = PropertiesService.getScriptProperties();
  Logger.log(props.getProperty('KAKAO_REST_API_KEY') ? '✅ KAKAO_REST_API_KEY 등록됨' : '❌ KAKAO_REST_API_KEY 미등록 (스크립트 속성에 추가하세요)');
  Logger.log(props.getProperty('KAKAO_JS_KEY') ? '✅ KAKAO_JS_KEY 등록됨' : '⚠ KAKAO_JS_KEY 미등록 — 화면 지도가 카카오 대신 기본 지도로 나옵니다');
}

// 세부주소 확인: 지사별 주소 탭 상태 + 각 지사·예시 장소의 주소 조회 결과를 로그에 출력
function testAddresses() {
  const sheet = getSS_().getSheetByName(CONFIG.SHEET_BRANCH);
  if (!sheet) { Logger.log("❌ '" + CONFIG.SHEET_BRANCH + "' 탭이 없습니다. 탭 이름을 정확히 맞추세요."); return; }
  const t = readTable_(CONFIG.SHEET_BRANCH);
  Logger.log('지사별 주소 탭 머리글: ' + t.headers.join(' | ') + (t.idx('지사') < 0 || t.idx('주소') < 0 ? '  ❌ 지사·주소 열 이름 확인' : '  ✅'));
  const names = getBranchNames_().concat(['세종특별자치시청', '대전역']);
  const res = lookupAddresses(names);
  if (!res.ok) { Logger.log('❌ ' + res.message); return; }
  names.forEach(n => Logger.log((res.addresses[n] ? '✅ ' : '❌ ') + n + ' → ' + (res.addresses[n] || res.errors[n])));
  // 대상자 명단 소속 중 지사별 주소 탭에 없는 이름 (이 이름들은 카카오 검색으로만 찾음)
  const branches = branchAddressMap_();
  const m = readTable_(CONFIG.SHEET_MEMBER), col = m.idx('소속');
  const missing = {};
  if (col >= 0) m.rows.forEach(r => { const v = String(r[col]).trim(); if (v && !branches[v.replace(/\s/g, '')]) missing[v] = true; });
  Logger.log(Object.keys(missing).length ? '⚠ 지사별 주소 탭에 없는 소속: ' + Object.keys(missing).join(', ') : '✅ 모든 소속이 지사별 주소 탭에 있어요');
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
