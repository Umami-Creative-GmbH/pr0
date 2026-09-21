import { handleChanges } from "@/server/change-http";

export const GET = (request: Request) => handleChanges(request);
