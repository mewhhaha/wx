import { test as base, type ConsoleMessage, type Request, type Response } from "@playwright/test";

interface BrowserFailure {
  kind: string;
  message: string;
  url?: string;
}

function isCriticalUrl(rawUrl: string): boolean {
  const pathname = new URL(rawUrl).pathname;
  return /\.(?:css|m?js|ts|wasm|scm)$/i.test(pathname) || /(?:worker|grammar|tree-sitter)/i.test(pathname);
}

function consoleFailure(message: ConsoleMessage): BrowserFailure | null {
  if (message.type() !== "error") {
    return null;
  }

  return {
    kind: "console.error",
    message: message.text(),
    url: message.location().url || undefined
  };
}

function requestFailure(request: Request): BrowserFailure | null {
  if (!isCriticalUrl(request.url())) {
    return null;
  }

  return {
    kind: "critical request failed",
    message: request.failure()?.errorText ?? "request failed",
    url: request.url()
  };
}

function responseFailure(response: Response): BrowserFailure | null {
  if (response.status() < 400 || !isCriticalUrl(response.url())) {
    return null;
  }

  return {
    kind: "critical response failed",
    message: `${response.status()} ${response.statusText()}`,
    url: response.url()
  };
}

interface BrowserTestOptions {
  expectedCriticalFailurePatterns: readonly string[];
}

export const test = base.extend<BrowserTestOptions>({
  expectedCriticalFailurePatterns: [[], { option: true }],
  page: async ({ page, expectedCriticalFailurePatterns }, use, testInfo) => {
    const failures: BrowserFailure[] = [];

    page.on("pageerror", (error) => {
      failures.push({ kind: "pageerror", message: error.stack ?? error.message });
    });
    page.on("console", (message) => {
      const failure = consoleFailure(message);
      if (failure) failures.push(failure);
    });
    page.on("requestfailed", (request) => {
      const failure = requestFailure(request);
      if (failure) failures.push(failure);
    });
    page.on("response", (response) => {
      const failure = responseFailure(response);
      if (failure) failures.push(failure);
    });

    await page.addInitScript(() => {
      const recorded: BrowserFailure[] = [];
      Object.defineProperty(window, "__wxE2eFailures", {
        configurable: false,
        value: recorded
      });

      window.addEventListener("unhandledrejection", (event) => {
        const reason = event.reason;
        recorded.push({
          kind: "unhandledrejection",
          message: reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)
        });
      });

      const BrowserWorker = window.Worker;
      window.Worker = class MonitoredWorker extends BrowserWorker {
        private readonly monitorError: (event: ErrorEvent) => void;
        private readonly monitorMessageError: () => void;
        constructor(scriptURL: string | URL, options?: WorkerOptions) {
          super(scriptURL, options);
          this.monitorError = (event) => {
            recorded.push({
              kind: "worker error",
              message: event.message,
              url: event.filename || String(scriptURL)
            });
          };
          this.monitorMessageError = () => {
            recorded.push({
              kind: "worker messageerror",
              message: "Worker message could not be deserialized.",
              url: String(scriptURL)
            });
          };
          this.addEventListener("error", this.monitorError);
          this.addEventListener("messageerror", this.monitorMessageError);
        }
        override terminate(): void {
          this.removeEventListener("error", this.monitorError);
          this.removeEventListener("messageerror", this.monitorMessageError);
          super.terminate();
        }
      };
    });

    await use(page);

    const inPageFailures = await page
      .evaluate(() => (window as Window & { __wxE2eFailures?: BrowserFailure[] }).__wxE2eFailures ?? [])
      .catch(() => [] as BrowserFailure[]);
    failures.push(...inPageFailures);

    const unexpectedFailures = failures.filter((failure) => {
      if (!failure.url) return true;
      return !expectedCriticalFailurePatterns.some((pattern) => new RegExp(pattern).test(failure.url!));
    });

    if (unexpectedFailures.length > 0) {
      const details = JSON.stringify(unexpectedFailures, null, 2);
      await testInfo.attach("browser-failures", {
        body: details,
        contentType: "application/json"
      });
      throw new Error(`Unexpected browser failures:\n${details}`);
    }
  }
});

export { expect } from "@playwright/test";
