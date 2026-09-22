export default {
  ignore: {
    overrides: [
      {
        // `run` invokes an async operation directly from event handlers. It is
        // not a React state setter; the actual functional updaters are pure.
        files: ["src/app/account-screen.tsx", "src/app/email-settings.tsx"],
        rules: ["react-doctor/no-impure-state-updater"],
      },
    ],
  },
};
