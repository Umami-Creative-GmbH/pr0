const desktopOrigins = [
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
];
const developmentOrigins = ["http://localhost:1420", "http://127.0.0.1:1420"];

export const corsHeaders = (request: Request): Headers => {
  const headers = new Headers({ Vary: "Origin" });
  const origin = request.headers.get("Origin");
  const additionalOrigins = (process.env.API_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const allowedOrigins = new Set([
    ...desktopOrigins,
    ...additionalOrigins,
    ...(process.env.NODE_ENV === "development" ? developmentOrigins : []),
  ]);

  if (origin && allowedOrigins.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    headers.set(
      "Access-Control-Allow-Headers",
      "Accept, Content-Type, Authorization"
    );
    headers.set("Access-Control-Max-Age", "600");
  }

  return headers;
};

export const preflightResponse = (request: Request): Response => {
  const headers = corsHeaders(request);
  return new Response(null, {
    status: headers.has("Access-Control-Allow-Origin") ? 204 : 403,
    headers,
  });
};
