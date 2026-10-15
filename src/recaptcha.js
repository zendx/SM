import { get } from "./api.js";

let scriptPromise;
function withTimeout(promise) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () =>
          reject(new Error("Human verification timed out. Please try again.")),
        12000,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

function loadRecaptcha(siteKey) {
  if (!scriptPromise) {
    let script;
    scriptPromise = withTimeout(
      new Promise((resolve, reject) => {
        script = document.createElement("script");
        script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`;
        script.async = true;
        script.onload = () => {
          if (!window.grecaptcha?.ready) {
            reject(
              new Error("Could not load human verification. Please try again."),
            );
            return;
          }
          window.grecaptcha.ready(() => resolve(window.grecaptcha));
        };
        script.onerror = () =>
          reject(
            new Error("Could not load human verification. Please try again."),
          );
        document.head.appendChild(script);
      }),
    ).catch((error) => {
      script?.remove();
      scriptPromise = undefined;
      throw error;
    });
  }
  return scriptPromise;
}

export async function recaptchaResponse(action) {
  if (!action) return {};
  const { siteKey } = await get("/auth/recaptcha");
  if (!siteKey) return {};
  const captcha = await loadRecaptcha(siteKey);
  let token;
  try {
    // Generate a fresh token on every submission, including retries.
    token = await withTimeout(captcha.execute(siteKey, { action }));
  } catch {
    throw new Error("Human verification could not complete. Please try again.");
  }
  if (typeof token !== "string" || !token)
    throw new Error("Human verification could not complete. Please try again.");
  return { recaptcha_token: token };
}
