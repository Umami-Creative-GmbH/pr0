import { handlePrompts } from "@/server/prompt-http";

export const GET = async (
  request: Request,
  context: { params: Promise<{ id: string }> }
) => {
  const { id } = await context.params;
  return handlePrompts(request, { kind: "organization-review", id });
};
