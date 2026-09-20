import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Validate the original encoding before Next's route adapter replaces invalid UTF-8.
export const proxy = (request: NextRequest) => {
  try {
    decodeURIComponent(new URL(request.url).search.replaceAll("+", " "));
  } catch {
    return NextResponse.json(
      {
        code: "validation_failed",
        message: "Use valid Unicode query encoding.",
        retryable: false,
      },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
  return NextResponse.next();
};
export const config = { matcher: "/api/v1/library/prompts" };
