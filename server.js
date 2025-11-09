// server.js (교체본 전체)
// ------------------------------------------------------------------
// 실행 전 준비:
// 1) .env에 GEMINI_API_KEY=...  (필수), PORT=3000(선택)
// 2) package.json에 "@google/generative-ai": "^0.21.0" 포함
// 3) public/index.html 이 존재해야 루트 접속이 뜹니다.
// ------------------------------------------------------------------

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from '@google/generative-ai';

// __dirname 대체 (ESM)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 기본 서버 세팅
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: true }));
app.use(express.json());

// 정적 파일 서빙
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));
app.get('/', (_, res) => res.sendFile(path.join(publicDir, 'index.html')));

// 헬스 체크
app.get('/api/health', (_, res) => res.json({ ok: true, ts: Date.now() }));

// ------------------------------------------------------------------
//  품질 강화: 모델/파라미터/시스템지시/출력포맷/2패스(Self-critique)
// ------------------------------------------------------------------

// 1) 모델: 깊이 있는 응답을 위해 pro 권장 (flash는 빠르지만 얕음)
const MODEL_NAME = 'gemini-1.5-pro';

// 2) 생성 파라미터: 보다 구체/정밀한 응답
const generationConfig = {
  temperature: 0.3,       // 낮을수록 보수적·구체
  topP: 0.8,
  maxOutputTokens: 3072,  // 필요 시 4096까지
};

// 3) 시스템 지시: 역할/톤/규격 고정
const systemInstruction = `
당신은 한국 대기업 대상의 시니어 프로젝트 매니저 겸 컨설턴트입니다.
- 톤: 간결·전문·근거 중심. 상투적 미사여구 금지.
- 반드시 고객 맥락(산업/목표/제약)을 반영하고, 가정은 명시합니다.
- 출력은 섹션별 소제목 + 불릿 + 표(필요 시)로 구조화합니다.
- 각 산출물 말미에 '리스크·가정·다음 액션(담당/기한)'을 포함합니다.
- 한국 기업 보고서 문체를 유지합니다.
`;

// 섹션 키
const PlanSection = {
  TITLE: 'title',
  SUMMARY: 'summary',
  PURPOSE: 'purpose',
  KFS: 'kfs',
  PLAN: 'plan',
};

// 섹션별 출력 포맷 강제
const sectionFormats = {
  [PlanSection.TITLE]: `
[출력포맷]
- 제목 5개 (각 20자 이내)
- 각 제목 아래에 '핵심 포인트(한 줄)' 첨부
`,
  [PlanSection.SUMMARY]: `
[출력포맷]
1) 한줄 요약(<= 25자)
2) 핵심 내용(불릿 4~6개)
3) KPI/지표(표)
4) 리스크·대응(불릿 3개)
5) 다음 액션(담당/기한)
`,
  [PlanSection.PURPOSE]: `
[출력포맷]
- 배경(3줄) / 문제정의(2줄) / 목표(정량·정성)
- 성공기준(KPI 3개)
- 이해관계자 맵(표: 담당-관심-영향-협력사항)
- 가정/의존성
`,
  [PlanSection.KFS]: `
[출력포맷]
- KFS 3~5개 (각 항목: 정의·관리지표·리스크·선행조건)
- 모니터링 캘린더(주간 단위 표)
`,
  [PlanSection.PLAN]: `
[출력포맷]
- 추진전략(불릿)
- 단계별 WBS(표: 주차/산출물/R&R/검증)
- 타임라인(주차별 마일스톤)
- 예산 초안(표: 항목/단가/수량/금액/가정)
- 리스크 레지스터(Top5)
- 다음 2주 실행체크리스트
`,
};

// 컨텍스트 + 평가 기준 + 섹션 포맷 포함한 사용자 프롬프트 구성
function buildPrompt(section, plan = {}) {
  const title = plan.title || '미정';
  const summary = plan.summary || '미정';
  const purpose = plan.purpose || '미정';

  const context = `
[프로젝트 맥락]
- 업무 제목: ${title}
- 핵심 내용: ${summary}
- 목적/배경/필요성: ${purpose}

[제약]
- 분량: 섹션당 8~15줄 내외
- 용어: 한국 기업 실무 용어 위주 (영문 약어는 첫 1회만 병기)
- 산업 평균 수치/벤치마크는 가정으로 표기

[평가기준]
- 구체성(수치·마일스톤·지표)
- 실행가능성(R&R·기한)
- 리스크 대비
`;

  const format = sectionFormats[section] || '';
  return `${context}
${format}
[요청] 위 기준에 맞춰 '${section.toUpperCase()}' 산출물을 작성하라.
상투적 표현을 피하고 수치/기한/R&R을 구체화하라.
`;
}

// Gemini 클라이언트
if (!process.env.GEMINI_API_KEY) {
  console.error('[FATAL] GEMINI_API_KEY가 .env에 없습니다.');
  process.exit(1);
}
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// API: 섹션별 생성 (2패스: Draft → Critique & Revise)
app.post('/api/generate', async (req, res) => {
  try {
    const { section, plan } = req.body || {};
    if (!section) return res.status(400).json({ error: 'section이 필요합니다.' });

    const userPrompt = buildPrompt(section, plan || {});
    const model = genAI.getGenerativeModel({
      model: MODEL_NAME,
      systemInstruction,       // 시스템 지시 적용
      generationConfig,        // 기본 생성 파라미터
    });

    // --- 1차안(Draft)
    const draftResp = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig,
    });
    const draftText = draftResp?.response?.text?.() ?? '';

    // --- 자체 검토 & 개선(2패스)
    const critiquePrompt = `
다음 초안을 자기검토하라. 결함(모호성, 실행가능성 부족, 지표 부재)을 지적하고 '개선본'을 제시하라.
[초안]
${draftText}

[출력 지침]
- '개선본'만 최종으로 제공.
- 중복 제거, 수치/기한/R&R 구체화.
- 표는 Markdown 표로 간결히.
`;
    const revisedResp = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: critiquePrompt }] }],
      generationConfig,
    });
    const finalText = revisedResp?.response?.text?.() ?? draftText;

    res.json({ text: finalText.trim() });
  } catch (err) {
    console.error('[Gemini Error]', err);
    res.status(500).json({ error: 'AI 생성 중 오류가 발생했습니다.' });
  }
});

// 서버 시작
app.listen(PORT, () => {
  console.log(`✔ 서버 실행: http://localhost:${PORT}`);
  console.log(`✔ 정적 경로: ${publicDir}`);
});
