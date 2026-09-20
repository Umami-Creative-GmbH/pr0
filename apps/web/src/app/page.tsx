import { methodLinkResultSchema } from "@pr0/api-contract/accounts";

import { AccountScreen } from "./account-screen";

const Home = async ({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const params = await searchParams;
  let verification: string | undefined;
  if (params.verified === "1") {
    verification = "ok";
  }
  if (params.verification === "invalid") {
    verification = "invalid";
  }
  let socialError: string | undefined;
  if (params.social) {
    socialError = "invalid_social";
  }
  if (
    params.social === "account_not_linked" ||
    params.social === "registration_closed" ||
    params.social === "rate_limited"
  ) {
    socialError = params.social;
  }
  return (
    <AccountScreen
      verification={verification}
      socialError={socialError}
      methodResult={methodLinkResultSchema.safeParse(params.methods).data}
    />
  );
};

export default Home;
