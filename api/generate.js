// api/generate.js
// -----------------------------------------------------------
// Google Gemini API 기반 서버리스 함수
// (Vercel 환경변수: GEMINI_API_KEY 필요)
// -----------------------------------------------------------
import { GoogleGenerativeAI } from "@google/generative-ai";

const PlanSection = {
  TITLE: "title",
  SUMMARY: "summary",
  PURPOSE: "purpose",
  KFS: "kfs",
  PLAN: "plan",
};

function buildPrompt(section, plan = {}) {
  const title = plan.title || "미정";
  const summary = plan.summary || "미정";
  const purpose = plan.purpose || "미정";

  const base = `당신은 한국 대기업 대상의 시니어 프로젝트 매니저 겸 컨설턴트입니다.
결과물은 한국어로, 간결하고 전문적인 톤으로 작성합니다.
---
[프로젝트 맥락]
- 업무 제목: ${title}
- 핵심 내용: ${summary}
- 목적/배경/필요성: ${purpose}
`;

  switch (section) {
    case PlanSection.TITLE:
      return `${base}
[요청] 위 내용을 가장 잘 나타내는 간결한 업무 제목 5개를 제시하라.
각 제목은 한 줄로 제시하고, 괄호 안에 핵심 포인트를 덧붙여라.`;

    case PlanSection.SUMMARY:
      return `${base}
[요청] 이 업무의 핵심 내용을 요약하라.
- 1문장 요약
- 주요 실행 내용(불릿 4~6개)
- KPI/성과지표(표)
- 리스크와 대응 방안(불릿 3개)`;

    case PlanSection.PURPOSE:
      return `${base}
[요청] 목적·배경·필요성을 구체적으로 서술하라.
- 배경(3줄)
- 문제정의(2줄)
- 목표(KPI 중심)
- 성공기준(정량·정성)
- 가정과 제약`;

    case PlanSection.KFS:
      return `${base}
[요청] 성공을 위해 관리해야 할 핵심 성공 요인(KFS) 3~5개를 제시하라.
각 항목은 정의·지표·리스크·선행조건을 포함하라.`;

    case PlanSection.PLAN:
      return `${base}
[요청] 실행계획(방안·일정·예산)을 구조화하라.
- 추진전략(불릿)
- 단계별 일정표(표)
- 예산 초안(표)
- 리스크 레지스터(Top5)
- 다음 2주 실행체크리스트`;
    default:
      return base;
  }
}

export default async function handler(req, res) {
  // GET으로 호출 시 단순 확인 응답
  if (req.method === "GET") {
    return res.status(200).send("generate function is alive");
  }
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    const { section, plan } = req.body || {};
    if (!section)
      return res.status(400).json({ error: "section 파라미터가 필요합니다." });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey)
      return res.status(500).json({ error: "GEMINI_API_KEY 누락" });

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-pro",
    });

    const prompt = buildPrompt(section, plan || {});
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, topP: 0.8, maxOutputTokens: 3072 },
    });

    const text = result?.response?.text?.() ?? "";
    return res.status(200).json({ text: text.trim() });
  } catch (err) {
    console.error("[generate.js Error]", err);
    return res
      .status(500)
      .json({ error: "AI 생성 중 오류가 발생했습니다." });
  }
}
