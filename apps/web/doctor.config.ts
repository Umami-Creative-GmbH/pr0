export default {
  ignore: {
    overrides: [
      {
        // `run` invokes an async operation directly from event handlers. It is
        // not a React state setter; the actual functional updaters are pure.
        files: ["src/app/account-screen.tsx", "src/app/email-settings.tsx"],
        rules: ["react-doctor/no-impure-state-updater"],
      },
      {
        // Each local `run` awaits the supplied action directly. Deletion,
        // device approval, and method removal callbacks are not state updaters.
        files: [
          "src/app/account-deletion-settings.tsx",
          "src/app/device/approval.tsx",
          "src/app/login-method-settings.tsx",
        ],
        rules: ["react-doctor/no-impure-state-updater"],
      },
    ],
  },
};
