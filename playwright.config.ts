import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './scripts/browser',
  timeout: 30000,
  fullyParallel: true,
  workers: 2,
  reporter: 'list',
  use: { baseURL: 'http://localhost:3003', channel: 'msedge', headless: true, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: [
    { command: 'npx vite --host 127.0.0.1 --port 3003 --strictPort', url: 'http://localhost:3003', reuseExistingServer: false, env: { VITE_APPS_SCRIPT_URL: '' } },
    { command: 'npx vite --host 127.0.0.1 --port 3002 --strictPort', url: 'http://localhost:3002', reuseExistingServer: false, env: { VITE_APPS_SCRIPT_URL: 'https://script.google.com/macros/s/browser-test/exec' } },
    { command: 'npx vite --host 127.0.0.1 --port 3004 --strictPort', url: 'http://localhost:3004', reuseExistingServer: false, env: { VITE_APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbzcbutQRzBUyaY9tzR46tl3xGKFiG1hOOjl_u60oHg8EbkWwFQP9quxrFYoaKYiP1m41g/exec' } },
    { command: 'npm run preview', url: 'http://localhost:4174', reuseExistingServer: false },
  ],
});
