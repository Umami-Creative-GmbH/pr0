import { z } from "zod";

import { DeviceApproval } from "./approval";

const DevicePage = async ({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const { user_code: code } = await searchParams;
  return (
    <DeviceApproval
      initialCode={z.string().max(8).safeParse(code).data ?? ""}
    />
  );
};
export default DevicePage;
