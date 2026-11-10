// Disposable network addresses for Docker-backed tests.

/** A local TCP port that was free a moment ago. */
export const availablePort = async () => {
  const reservation = Bun.serve({ port: 0, fetch: () => new Response() });
  const { port } = reservation;
  await reservation.stop(true);
  return port;
};

/** A random address octet from 1 to 250, for private test subnets that rarely collide. */
export const randomOctet = (): number => Math.floor(Math.random() * 250) + 1;
