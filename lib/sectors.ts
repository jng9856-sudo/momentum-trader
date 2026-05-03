// Finnhub industry 문자열 → 한글 섹터명 매핑
export const INDUSTRY_TO_SECTOR: Record<string, string> = {
  // 반도체·테크
  'Semiconductors':          '반도체·테크',
  'Software':                'IT·테크',
  'Technology':              'IT·테크',
  'Quantum Computing':       'IT·테크',
  // ETF
  'ETF-Space':               '우주·항공',
  'ETF-Genomics':            '바이오·헬스케어',
  'ETF-Innovation':          'IT·테크',
  'ETF-Fintech':             '금융·핀테크',
  // 헬스케어
  'Biotechnology':           '바이오·헬스케어',
  'Pharmaceuticals':         '헬스케어',
  'Medical Devices':         '헬스케어',
  // 금융
  'Banks':                   '금융·핀테크',
  'Capital Markets':         '금융·핀테크',
  'Crypto-Finance':          '금융·핀테크',
  // 에너지
  'Oil & Gas':               '에너지',
};

export function classifySector(industry: string | null | undefined): string {
  if (!industry) return '기타';
  return INDUSTRY_TO_SECTOR[industry] ?? '기타';
}
