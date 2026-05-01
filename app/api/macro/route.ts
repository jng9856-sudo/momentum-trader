import { NextResponse } from 'next/server';

// ── 2026 주요 매크로 이벤트 캘린더 ───────────────────────────────────────────
// FOMC, CPI, NFP, PCE 일정 (미국 동부시간 기준)
// 출처: Fed 공식 일정 + BLS 발표 일정

export interface MacroEvent {
  id:          string;
  type:        'FOMC' | 'CPI' | 'NFP' | 'PCE' | 'GDP';
  title:       string;
  date:        string;       // YYYY-MM-DD
  time:        string;       // HH:MM (ET)
  impact:      'HIGH' | 'MEDIUM';
  description: string;
  daysUntil?:  number;       // 오늘 기준 D-day
  isUrgent?:   boolean;      // 3일 이내
  isPast?:     boolean;      // 이미 지난 이벤트
}

const EVENTS_2026: Omit<MacroEvent, 'daysUntil' | 'isUrgent' | 'isPast'>[] = [
  // ── FOMC (연 8회) ────────────────────────────────────────────────────────
  { id: 'fomc-2026-01', type: 'FOMC', title: 'FOMC 금리결정', date: '2026-01-28', time: '14:00', impact: 'HIGH', description: '1월 FOMC — 금리 동결/인하 여부 결정' },
  { id: 'fomc-2026-03', type: 'FOMC', title: 'FOMC 금리결정', date: '2026-03-18', time: '14:00', impact: 'HIGH', description: '3월 FOMC — SEP(점도표) 발표 포함' },
  { id: 'fomc-2026-04', type: 'FOMC', title: 'FOMC 금리결정', date: '2026-04-29', time: '14:00', impact: 'HIGH', description: '4월 FOMC — 금리 결정' },
  { id: 'fomc-2026-06', type: 'FOMC', title: 'FOMC 금리결정', date: '2026-06-10', time: '14:00', impact: 'HIGH', description: '6월 FOMC — SEP(점도표) 발표 포함' },
  { id: 'fomc-2026-07', type: 'FOMC', title: 'FOMC 금리결정', date: '2026-07-29', time: '14:00', impact: 'HIGH', description: '7월 FOMC — 금리 결정' },
  { id: 'fomc-2026-09', type: 'FOMC', title: 'FOMC 금리결정', date: '2026-09-16', time: '14:00', impact: 'HIGH', description: '9월 FOMC — SEP(점도표) 발표 포함' },
  { id: 'fomc-2026-10', type: 'FOMC', title: 'FOMC 금리결정', date: '2026-10-28', time: '14:00', impact: 'HIGH', description: '10월 FOMC — 금리 결정' },
  { id: 'fomc-2026-12', type: 'FOMC', title: 'FOMC 금리결정', date: '2026-12-09', time: '14:00', impact: 'HIGH', description: '12월 FOMC — SEP(점도표) 발표 포함' },

  // ── CPI (월별, 매월 둘째~셋째 주 수요일) ─────────────────────────────────
  { id: 'cpi-2026-01', type: 'CPI', title: 'CPI 소비자물가', date: '2026-01-14', time: '08:30', impact: 'HIGH', description: '12월 CPI — 인플레이션 지표' },
  { id: 'cpi-2026-02', type: 'CPI', title: 'CPI 소비자물가', date: '2026-02-11', time: '08:30', impact: 'HIGH', description: '1월 CPI — 인플레이션 지표' },
  { id: 'cpi-2026-03', type: 'CPI', title: 'CPI 소비자물가', date: '2026-03-11', time: '08:30', impact: 'HIGH', description: '2월 CPI — 인플레이션 지표' },
  { id: 'cpi-2026-04', type: 'CPI', title: 'CPI 소비자물가', date: '2026-04-10', time: '08:30', impact: 'HIGH', description: '3월 CPI — 인플레이션 지표' },
  { id: 'cpi-2026-05', type: 'CPI', title: 'CPI 소비자물가', date: '2026-05-13', time: '08:30', impact: 'HIGH', description: '4월 CPI — 인플레이션 지표' },
  { id: 'cpi-2026-06', type: 'CPI', title: 'CPI 소비자물가', date: '2026-06-11', time: '08:30', impact: 'HIGH', description: '5월 CPI — 인플레이션 지표' },
  { id: 'cpi-2026-07', type: 'CPI', title: 'CPI 소비자물가', date: '2026-07-15', time: '08:30', impact: 'HIGH', description: '6월 CPI — 인플레이션 지표' },
  { id: 'cpi-2026-08', type: 'CPI', title: 'CPI 소비자물가', date: '2026-08-12', time: '08:30', impact: 'HIGH', description: '7월 CPI — 인플레이션 지표' },
  { id: 'cpi-2026-09', type: 'CPI', title: 'CPI 소비자물가', date: '2026-09-10', time: '08:30', impact: 'HIGH', description: '8월 CPI — 인플레이션 지표' },
  { id: 'cpi-2026-10', type: 'CPI', title: 'CPI 소비자물가', date: '2026-10-14', time: '08:30', impact: 'HIGH', description: '9월 CPI — 인플레이션 지표' },
  { id: 'cpi-2026-11', type: 'CPI', title: 'CPI 소비자물가', date: '2026-11-13', time: '08:30', impact: 'HIGH', description: '10월 CPI — 인플레이션 지표' },
  { id: 'cpi-2026-12', type: 'CPI', title: 'CPI 소비자물가', date: '2026-12-10', time: '08:30', impact: 'HIGH', description: '11월 CPI — 인플레이션 지표' },

  // ── NFP 비농업취업자수 (매월 첫째 금요일) ────────────────────────────────
  { id: 'nfp-2026-01', type: 'NFP', title: 'NFP 고용지표', date: '2026-01-09', time: '08:30', impact: 'HIGH', description: '12월 고용 — 실업률/취업자수' },
  { id: 'nfp-2026-02', type: 'NFP', title: 'NFP 고용지표', date: '2026-02-06', time: '08:30', impact: 'HIGH', description: '1월 고용 — 실업률/취업자수' },
  { id: 'nfp-2026-03', type: 'NFP', title: 'NFP 고용지표', date: '2026-03-06', time: '08:30', impact: 'HIGH', description: '2월 고용 — 실업률/취업자수' },
  { id: 'nfp-2026-04', type: 'NFP', title: 'NFP 고용지표', date: '2026-04-03', time: '08:30', impact: 'HIGH', description: '3월 고용 — 실업률/취업자수' },
  { id: 'nfp-2026-05', type: 'NFP', title: 'NFP 고용지표', date: '2026-05-01', time: '08:30', impact: 'HIGH', description: '4월 고용 — 실업률/취업자수' },
  { id: 'nfp-2026-06', type: 'NFP', title: 'NFP 고용지표', date: '2026-06-05', time: '08:30', impact: 'HIGH', description: '5월 고용 — 실업률/취업자수' },
  { id: 'nfp-2026-07', type: 'NFP', title: 'NFP 고용지표', date: '2026-07-10', time: '08:30', impact: 'HIGH', description: '6월 고용 — 실업률/취업자수' },
  { id: 'nfp-2026-08', type: 'NFP', title: 'NFP 고용지표', date: '2026-08-07', time: '08:30', impact: 'HIGH', description: '7월 고용 — 실업률/취업자수' },
  { id: 'nfp-2026-09', type: 'NFP', title: 'NFP 고용지표', date: '2026-09-04', time: '08:30', impact: 'HIGH', description: '8월 고용 — 실업률/취업자수' },
  { id: 'nfp-2026-10', type: 'NFP', title: 'NFP 고용지표', date: '2026-10-02', time: '08:30', impact: 'HIGH', description: '9월 고용 — 실업률/취업자수' },
  { id: 'nfp-2026-11', type: 'NFP', title: 'NFP 고용지표', date: '2026-11-06', time: '08:30', impact: 'HIGH', description: '10월 고용 — 실업률/취업자수' },
  { id: 'nfp-2026-12', type: 'NFP', title: 'NFP 고용지표', date: '2026-12-04', time: '08:30', impact: 'HIGH', description: '11월 고용 — 실업률/취업자수' },

  // ── PCE 개인소비지출 (매월 말 금요일) ────────────────────────────────────
  { id: 'pce-2026-01', type: 'PCE', title: 'PCE 물가지수', date: '2026-01-30', time: '08:30', impact: 'HIGH', description: '12월 PCE — Fed 선호 인플레이션 지표' },
  { id: 'pce-2026-02', type: 'PCE', title: 'PCE 물가지수', date: '2026-02-27', time: '08:30', impact: 'HIGH', description: '1월 PCE — Fed 선호 인플레이션 지표' },
  { id: 'pce-2026-03', type: 'PCE', title: 'PCE 물가지수', date: '2026-03-27', time: '08:30', impact: 'HIGH', description: '2월 PCE — Fed 선호 인플레이션 지표' },
  { id: 'pce-2026-04', type: 'PCE', title: 'PCE 물가지수', date: '2026-04-30', time: '08:30', impact: 'HIGH', description: '3월 PCE — Fed 선호 인플레이션 지표' },
  { id: 'pce-2026-05', type: 'PCE', title: 'PCE 물가지수', date: '2026-05-29', time: '08:30', impact: 'HIGH', description: '4월 PCE — Fed 선호 인플레이션 지표' },
  { id: 'pce-2026-06', type: 'PCE', title: 'PCE 물가지수', date: '2026-06-26', time: '08:30', impact: 'HIGH', description: '5월 PCE — Fed 선호 인플레이션 지표' },
  { id: 'pce-2026-07', type: 'PCE', title: 'PCE 물가지수', date: '2026-07-31', time: '08:30', impact: 'HIGH', description: '6월 PCE — Fed 선호 인플레이션 지표' },
  { id: 'pce-2026-08', type: 'PCE', title: 'PCE 물가지수', date: '2026-08-28', time: '08:30', impact: 'HIGH', description: '7월 PCE — Fed 선호 인플레이션 지표' },
  { id: 'pce-2026-09', type: 'PCE', title: 'PCE 물가지수', date: '2026-09-25', time: '08:30', impact: 'HIGH', description: '8월 PCE — Fed 선호 인플레이션 지표' },
  { id: 'pce-2026-10', type: 'PCE', title: 'PCE 물가지수', date: '2026-10-30', time: '08:30', impact: 'HIGH', description: '9월 PCE — Fed 선호 인플레이션 지표' },
  { id: 'pce-2026-11', type: 'PCE', title: 'PCE 물가지수', date: '2026-11-25', time: '08:30', impact: 'HIGH', description: '10월 PCE — Fed 선호 인플레이션 지표' },
  { id: 'pce-2026-12', type: 'PCE', title: 'PCE 물가지수', date: '2026-12-23', time: '08:30', impact: 'HIGH', description: '11월 PCE — Fed 선호 인플레이션 지표' },

  // ── GDP (분기별) ──────────────────────────────────────────────────────────
  { id: 'gdp-2026-q1-adv', type: 'GDP', title: 'GDP 속보치', date: '2026-04-29', time: '08:30', impact: 'MEDIUM', description: '1Q 2026 GDP 속보치' },
  { id: 'gdp-2026-q2-adv', type: 'GDP', title: 'GDP 속보치', date: '2026-07-30', time: '08:30', impact: 'MEDIUM', description: '2Q 2026 GDP 속보치' },
  { id: 'gdp-2026-q3-adv', type: 'GDP', title: 'GDP 속보치', date: '2026-10-29', time: '08:30', impact: 'MEDIUM', description: '3Q 2026 GDP 속보치' },
];

// ── D-day 계산 및 필터링 ────────────────────────────────────────────────────
function enrichEvents(events: typeof EVENTS_2026): MacroEvent[] {
  // ✅ 수정: UTC 기준으로 명시하여 시간대 파싱 오류 방지
  const todayStr = new Date().toISOString().slice(0, 10);
  const today = new Date(todayStr + 'T00:00:00Z');

  return events.map(e => {
    const eventDate = new Date(e.date + 'T00:00:00Z'); // ✅ UTC 명시
    const diffMs    = eventDate.getTime() - today.getTime();
    const daysUntil = Math.round(diffMs / (1000 * 60 * 60 * 24));
    return {
      ...e,
      daysUntil,
      isUrgent: daysUntil >= 0 && daysUntil <= 3,
      isPast:   daysUntil < 0,
    };
  });
}

export async function GET(req: Request) {
  const url   = new URL(req.url);
  const days  = parseInt(url.searchParams.get('days') ?? '30');
  const all   = enrichEvents(EVENTS_2026);

  // 오늘 기준 앞으로 N일 이내 이벤트 + 최근 3일 이내 지난 이벤트
  const upcoming = all
    .filter(e => e.daysUntil !== undefined && e.daysUntil >= -3 && e.daysUntil <= days)
    .sort((a, b) => (a.daysUntil ?? 0) - (b.daysUntil ?? 0));

  // 다음 HIGH 임팩트 이벤트 (진입 주의 판단용)
  const nextUrgent = all.find(e => !e.isPast && e.isUrgent && e.impact === 'HIGH') ?? null;
  const nextHigh   = all.find(e => !e.isPast && e.impact === 'HIGH') ?? null;

  // 7일 이내 HIGH 이벤트 수
  const highWithin7 = all.filter(e => !e.isPast && (e.daysUntil ?? 99) <= 7 && e.impact === 'HIGH').length;

  return NextResponse.json({
    events:       upcoming,
    nextUrgent,
    nextHigh,
    highWithin7,
    buyWarning:   !!nextUrgent,
    analyzed_at:  new Date().toISOString(),
  });
}
