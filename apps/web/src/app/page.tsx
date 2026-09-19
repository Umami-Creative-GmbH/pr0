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
  return <AccountScreen verification={verification} />;
};

export default Home;
