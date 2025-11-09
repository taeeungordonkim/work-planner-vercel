// api/generate.js
import { GoogleGenerativeAI } from "@google/generative-ai";

// Vercel 서버리스 동작 확인용 마커 로그
export const config = { runtime: "nodejs20.x", regions: ["icn1","hnd1"] };

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

const PlanSection = { TITLE:"title", SUMMARY:"summary", PURPOSE:"purpose", KFS:"kfs", PLAN:"plan" };

function promptOf(section, plan={}) {
  const title = plan.title || "미정";
  const summary = plan.summary || "미정";
  const purpose = plan.purpose || "미정";

  const base = `역할: 한국 기업 컨설턴트\n- 제목:${title}\n- 요약:${summary}\n- 목적:${purpose}\n`;
  switch (section) {
    case PlanSection.SUMMARY: return base + "요청: 1문장 요약 + 핵심 불릿 4~6개 + 리스크 3개 + 다음 액션.";
    case PlanSection.TITLE:   return base + "요청: 제목 5개(각 20자 이내)와 핵심 포인트 1줄.";
    case PlanSection.PURPOSE: return base + "요청: 배경/문제정의/목표(KPI)/성공기준/가정·제약.";
    case PlanSection.KFS:     return base + "요청: KFS 3~5개(정의·지표·리스크·선행조건) + 모니터링.";
    case PlanSection.PLAN:    return base + "요청: 추진전략, 단계별 일정표, 예산표(항목/근거), 리스크 Top5.";
    default:                  return base + "요청: 간단 요약.";
  }
}

export default async function handler(req, res) {
  // 헬스체크
  if (req.method === "GET") return res.status(200).send("generate function is alive");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  // 시작 로그(런타임 로그에서 반드시 보임)
  console.log("[generate] start");

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY is missing" });

  let payload;
  try {
    payload = await readJson(req);
  } catch {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  const { section, plan } = payload || {};
  if (!section) return res.status(400).json({ error: "section is required" });

  try {
    // 지연/타임아웃 회피: flash + 낮은 토큰 + 타임아웃 가드
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = promptOf(section, plan);
    console.log("[generate] calling gemini…");

    // 9초 타임아웃(Free 플랜 10초 제한 대비)
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 9000);

    const result = await model.generateContent(
      {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, topP: 0.8, maxOutputTokens: 1024 }
      },
      { signal: controller.signal }
    );

    clearTimeout(t);

    const text = result?.response?.text?.() ?? "";
    console.log("[generate] success, bytes:", text.length);
    return res.status(200).json({ text: text.trim() });
  } catch (err) {
    // 실패 지점 로그
    console.error("[generate] error:", err?.message || err);
    // 원인 힌트도 함께 반환(프론트에서 표시는 그대로 “서버 오류”로 해도 됨)
    return res.status(503).json({ error: "upstream_timeout_or_crash" });
  }
}
