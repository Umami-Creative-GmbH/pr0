import { handlePrompts } from "@/server/prompt-http";

export const GET = (request: Request) =>
  handlePrompts(request, undefined, true);
