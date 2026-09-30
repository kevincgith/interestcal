// Browser tests for the page itself (layout, inputs, exports). Run: npm run test:e2e
// Each test runs in desktop Chrome and on an emulated iPhone (WebKit, i.e. Safari's engine).
import { defineConfig, devices } from '@playwright/test';

const PORT = 4180;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://127.0.0.1:${PORT}/` },
  projects: [
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
    { name: 'iphone-safari', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1 -d site`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    stderr: 'ignore',
  },
});
