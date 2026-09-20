import { handlePrompts } from "@/server/prompt-http";

export const POST = (request: Request) => handlePrompts(request);
