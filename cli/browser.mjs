// @ts-check
import { spawn } from "node:child_process";

/**
 * The command that opens a URL in the default browser, run without a shell so
 * the URL is never interpreted as a command.
 * @param {NodeJS.Platform} platform
 * @param {string} url
 * @returns {{ command: string, args: string[] }}
 */
export function browserCommand(platform, url) {
  if (platform === "win32") return { command: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url] };
  if (platform === "darwin") return { command: "open", args: [url] };
  return { command: "xdg-open", args: [url] };
}

/**
 * Opening the browser is best effort: the address is always printed too.
 * @param {string} url
 * @returns {Promise<boolean>}
 */
export function openBrowser(url) {
  const { command, args } = browserCommand(process.platform, url);
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, { shell: false, stdio: "ignore", detached: true, windowsHide: true });
      child.on("error", () => resolve(false));
      child.on("spawn", () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}
