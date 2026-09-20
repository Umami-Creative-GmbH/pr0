import { handleDeletionLookup } from "@/server/account-deletion";

export const GET = async (
  request: Request,
  context: { params: Promise<{ handle: string }> }
) => {
  const { handle } = await context.params;
  return handleDeletionLookup(request, handle);
};
