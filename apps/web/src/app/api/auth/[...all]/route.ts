import { handleAuth } from "@/server/account-http";
import { handleDevice } from "@/server/device-http";

const handle = (request: Request) =>
  new URL(request.url).pathname.startsWith("/api/auth/device")
    ? handleDevice(request)
    : handleAuth(request);
export { handle as GET, handle as POST };
