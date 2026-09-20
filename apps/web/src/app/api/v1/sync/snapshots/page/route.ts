import { handleSnapshot } from "@/server/snapshot-http";

export const POST = (request: Request) => handleSnapshot(request, true);
