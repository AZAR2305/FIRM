import { defineConfig } from "@playwright/test";

// The demo-path test runs against a LOCAL FORK of Monad Testnet (anvil on :8546) with the app built from the fork deployment:
//   see frontend/README.md "End-to-end test". It is skipped with a clear message when the fork is not running.
// Uses the Microsoft Edge that ships with Windows (set PW_CHANNEL=chrome|chromium to use another browser).
export default defineConfig({
  testDir: "./e2e",
  timeout: 240_000,
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    channel: process.env.PW_CHANNEL ?? "msedge",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npx next start -H 127.0.0.1 -p 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
