// server.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from '@google/generative-ai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.GEMINI_API_KEY) {
  console.error('[FATAL] GEMINI_API_KEY가 .env에 없습니다.');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const MODEL_NAME = 'gemini-2.0-flash';

app.use(cors({ origin: true }));
app.use(express.json());

// ---- 정적 파일 서빙 (절대경로) ----
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

// 루트 요청은 index.html로
app.get('/', (_, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// 헬스체크
app.get('/api/health', (_, res) => {
  res.json({ ok: true });
});

// 프롬프트 빌더
const PlanSection = {
  TITLE: 'title',
  SUMMARY: 'summary',
  PURPOSE: 'purpose',
  KFS: 'kfs',
  PLAN: 'plan',
};

function buildPrompt(section, plan = {}) {
  const title = plan.title || '미정';
  const summary = plan.summary || '미정';
  const purpose = plan.purpose || '미정';

  const base = `당신은 유능한 프로젝트 매니저(PM)입니다. 다음 업무 기획 내용에 대해 요청하는 항목을 전문가 수준으로 작성해 주세요.
결과물은 한국어로, 친절하고 전문적인 어조로 작성해 주세요.

### 현재까지의 업무 기획 내용
- **업무 제목:** ${title}
- **핵심 내용:** ${summary}
- **목적/배경/필요성:** ${purpose}

---`;

  switch (section) {
    case PlanSection.TITLE:
      return `당신은 뛰어난 카피라이터입니다. 다음 업무 내용을 가장 잘 나타내는 간결하고 명확한 **업무 제목**을 5개 제안해주세요.
각 제목은 한 줄로 제시하고, 별도의 설명은 붙이지 마세요.

### 업무 내용
- **핵심 내용:** ${summary}
- **목적/배경:** ${purpose}`;
    case PlanSection.SUMMARY:
      return `${base}
위 내용을 바탕으로, 이 업무의 **핵심 내용**을 3~4문장으로 요약해 주세요. 누가, 무엇을, 어떻게, 왜 하는지가 명확히 드러나도록 작성해 주세요.`;
    case PlanSection.PURPOSE:
      return `${base}
위 내용을 바탕으로, 이 업무의 **목적, 배경, 그리고 필요성**을 구체적으로 서술해 주세요. 각 항목을 명확히 구분하여 작성해 주세요.`;
    case PlanSection.KFS:
      return `${base}
위 내용을 바탕으로, 이 업무를 성공적으로 완수하기 위한 **핵심 성공 요인(Key Factors for Success)**을 3가지 제안하고, 각 요인에 대한 간단한 설명을 덧붙여 주세요.`;
    case PlanSection.PLAN:
      return `${base}
위 내용을 바탕으로, 업무 수행을 위한 **개략적인 방안, 예상 일정, 그리고 필요한 예산 항목**에 대한 초안을 작성해 주세요.
전문적인 보고서 형식으로 구조화하여 제안해 주세요.
- **방안:** 구체적 실행 단계
- **일정:** 주요 마일스톤(1주차, 2주차 등)
- **예산:** 인건비/마케팅비/개발비 등 분류`;
    default:
      return '';
  }
}

app.post('/api/generate', async (req, res) => {
  try {
    const { section, plan } = req.body || {};
    if (!section) return res.status(400).json({ error: 'section이 필요합니다.' });

    const prompt = buildPrompt(section, plan);
    if (!prompt) return res.status(400).json({ error: '잘못된 section입니다.' });

    const model = genAI.getGenerativeModel({ model: MODEL_NAME });
    const result = await model.generateContent(prompt);
    const text = result?.response?.text?.() ?? '';

    res.json({ text: text.trim() });
  } catch (err) {
    console.error('[Gemini Error]', err);
    res.status(500).json({ error: 'AI 생성 중 오류가 발생했습니다.' });
  }
});

app.listen(PORT, () => {
  console.log(`✔ 서버 실행: http://localhost:${PORT}`);
  console.log(`✔ 정적 경로: ${publicDir}`);
});
