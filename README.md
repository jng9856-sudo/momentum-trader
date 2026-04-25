# Momentum Trader — 모멘텀 매수/매도 신호 분석기

AI(Claude)가 실시간 웹 검색으로 반도체·테크 주식의 모멘텀 매매 신호를 매일 자동 분석합니다.

---

## 분석 항목

- **매수/매도/관망 신호** + 신뢰도 (HIGH / MEDIUM / LOW)
- **모멘텀 강도 점수** (1–10)
- **지수 대비 RS** / **섹터 내 RS**
- **50일 이동평균 위치** (위 / 근접 / 아래)
- **차트 패턴** (컵앤핸들, W베이스, 돌파, 하락추세)
- **진입 구간, 지지/저항, 손절선**
- **당일 추천 매수 Top 3** 자동 선정

---

## 로컬 개발 환경 세팅

```bash
# 1. 의존성 설치
npm install

# 2. 환경 변수 설정
cp .env.example .env.local
# .env.local 파일을 열어 ANTHROPIC_API_KEY 값을 입력

# 3. 개발 서버 실행
npm run dev
# → http://localhost:3000 접속
```

---

## Vercel 배포

### 방법 1: Vercel CLI (권장)
```bash
npm install -g vercel
vercel           # 첫 배포
vercel --prod    # 프로덕션 배포
```

### 방법 2: GitHub 연동 (자동 배포)
1. GitHub에 이 프로젝트를 push
2. [vercel.com](https://vercel.com) → New Project → Import Repository
3. **Environment Variables** 탭에서 아래 값 입력:
   - Key: `ANTHROPIC_API_KEY`
   - Value: `sk-ant-...` (Anthropic Console에서 발급)
4. Deploy 클릭

> **중요:** API Key는 절대 코드에 직접 넣지 말고 반드시 환경변수로만 관리하세요.

---

## 사용법

1. 관심 종목 추가/제거 (기본: AMD, MRVL, AVGO, MU, INTC, ARM, NVDA, TSM)
2. **분석 실행** 버튼 클릭
3. AI가 실시간 웹 검색으로 각 종목 분석 (약 30–60초)
4. 당일 분석 결과는 브라우저에 캐싱됨 (새로고침해도 유지)
5. 다음날 접속 시 캐시 만료 → 재분석 필요

---

## 기술 스택

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **AI Engine**: Anthropic Claude (claude-sonnet-4) + Web Search
- **Deployment**: Vercel

---

## 주의사항

이 서비스는 AI가 공개 데이터를 기반으로 생성한 참고 정보입니다.
투자 판단 및 손익에 대한 책임은 전적으로 본인에게 있습니다.
금융 투자 권유가 아닙니다.
