import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireStandardOrPro } from "@/lib/billing/requirePro";
import { isAiEndpointsEnabled } from "@/lib/config/featureFlags";
import { checkRateLimit } from "@/lib/rate-limit";
import { getUserTier } from "@/lib/billing/subscriptions";
import { reserveUsage, completeUsage, markUsageUncertain, releaseUsage } from "@/lib/ai-usage/ledger";

/**
 * AI profesor unutar skripti (hrvatski, poglavlja 20–28).
 *
 * Skripte su ranije zvale api.anthropic.com izravno iz preglednika (bez ključa — nikad
 * nije radilo). Ova ruta prima isti oblik tijela ({ system?, messages }) pa poglavlja
 * mijenjaju samo URL, a vraća Anthropic-oblik odgovora sa SAMO text blokovima, tako da
 * postojeći kod koji čita content[0].text / filter(type==='text') radi bez izmjena.
 *
 * Model i max_tokens određuje server; klijentski `model`/`max_tokens` se ignoriraju.
 */

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const BASE_SYSTEM =
  "Ti si AI profesor hrvatskog jezika za srednjoškolce koji se pripremaju za državnu maturu u Hrvatskoj. " +
  "Odgovaraj ISKLJUČIVO na pitanja vezana uz gradivo mature. Uvijek odgovaraj na hrvatskom.";

const MODEL = "claude-sonnet-5-5";
const MAX_TOKENS = 3000; // uključuje adaptive thinking
const AI_RATE_LIMIT_MS = 8_000;
const MAX_MSG_CHARS = 6000;
const MAX_LESSON_SYSTEM_CHARS = 4000;

export async function POST(req) {
  if (!isAiEndpointsEnabled()) {
    return NextResponse.json(
      { error: "AI je privremeno nedostupan.", code: "FEATURE_DISABLED" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const body = await req.json().catch(() => null);
    const messages = body?.messages;
    if (
      !Array.isArray(messages) ||
      messages.length !== 1 ||
      messages[0]?.role !== "user" ||
      typeof messages[0]?.content !== "string" ||
      !messages[0].content.trim() ||
      messages[0].content.length > MAX_MSG_CHARS
    ) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    const lessonSystem = typeof body?.system === "string" ? body.system.trim() : "";
    if (lessonSystem.length > MAX_LESSON_SYSTEM_CHARS) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const deny = await requireStandardOrPro(req, { source: "ai-skripta" });
    if (deny) return deny;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { limited, retryAfterSec } = await checkRateLimit(user.id, "ai", AI_RATE_LIMIT_MS);
    if (limited) {
      return NextResponse.json(
        { error: "Pričekaj malo prije sljedeće AI poruke." },
        { status: 429, headers: { "Retry-After": String(retryAfterSec) } }
      );
    }

    // Upute lekcije dolaze nakon fiksnog okvira; okvir (samo matura, hrvatski) uvijek vrijedi.
    const system = lessonSystem
      ? `${BASE_SYSTEM}\n\nUpute za ovu lekciju:\n${lessonSystem}`
      : BASE_SYSTEM;
    const anthropicMessages = [{ role: "user", content: messages[0].content }];

    const tier = await getUserTier(user.id);
    const { requestId } = await reserveUsage({
      userId: user.id,
      feature: "ai-skripta",
      tier,
      model: MODEL,
      estimatedInputTokens: new TextEncoder().encode(JSON.stringify({ system, messages: anthropicMessages })).length + 2048,
      maxOutputTokens: MAX_TOKENS,
    });

    let response;
    try {
      response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        output_config: { effort: "low" },
        system,
        messages: anthropicMessages,
      });
      await completeUsage({ requestId, model: MODEL, usage: response.usage });
    } catch (error) {
      if ([400, 401, 403, 429].includes(error?.status)) await releaseUsage({ requestId }).catch(() => {});
      else await markUsageUncertain({ requestId }).catch(() => {});
      throw error;
    }

    return NextResponse.json(
      {
        content: (response.content || [])
          .filter((b) => b.type === "text")
          .map((b) => ({ type: "text", text: b.text })),
        stop_reason: response.stop_reason,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[ai/skripta] Error:", err);
    if (err?.code === "AI_BUDGET_EXCEEDED") {
      return NextResponse.json({ error: "AI budget exceeded", code: err.code }, { status: 429 });
    }
    return NextResponse.json({ error: "AI request unavailable" }, { status: 503 });
  }
}
