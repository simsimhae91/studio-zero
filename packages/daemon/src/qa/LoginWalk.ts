import type { Browser, BrowserContextOptions, Locator, Page, Request } from 'playwright-core';
import { PROVIDERS, type Provider } from '../arms/logins.ts';
import { SIGN_IN, SIGN_UP } from '../scratch/ScreenSpec.ts';
import { excerpt } from '../util/core.ts';
import { STEP_ATTR } from './FlowWalker.ts';

/**
 * Signing in with a provider, as far as the studio can go without being a person with an account there.
 *
 * The provider's half cannot be stood in for: measured on a stack (2026-11-14), the auth service sends a Google
 * sign-in to Google whatever address it is configured with, and takes another address for Kakao only as one
 * that the owner's browser and its own container both reach, which this Mac has none of. What the product
 * wrote is its own half, and that is pressed here: the button, the request it makes of the backend to start
 * that provider's sign-in, the address it names for the person to come back to, and the backend's answer, which
 * is to send the person to the provider. The browser is stopped at that door; nobody is sent through it.
 */

/** A button that signs a person in with a provider says which: `data-login="kakao"`. */
export const LOGIN_ATTR = 'data-login';

/** Where the backend sends a person for each provider. */
const DOOR: Record<Provider, string> = { kakao: 'kauth.kakao.com', google: 'accounts.google.com' };
const AUTHORIZE = '/auth/v1/authorize';
/** How long the marked buttons are looked for on a screen, and a press is waited on. */
const LOOK_MS = 2000;
const PRESS_MS = 8000;

export interface LoginWalk {
  /** The providers the product offers, as its buttons are marked. */
  offered: string[];
  problems: string[];
}

const isProvider = (name: string): name is Provider => (PROVIDERS as readonly string[]).includes(name);
/** An address as a URL, or null for something that is not one. */
function parsed(address: string | null): URL | null {
  try {
    return address ? new URL(address) : null;
  } catch {
    return null;
  }
}

/**
 * Presses each provider's button on a product that is being served at `base`. `on` is the providers the
 * project's backend has switched on (`StackInfo.logins`); `apiOrigin` is that backend as the browser reaches it.
 */
export async function walkLogins(deps: { browser: Browser; base: string; phone: BrowserContextOptions | null; apiOrigin: string; on: readonly string[] }): Promise<LoginWalk> {
  const { browser, base, apiOrigin, on } = deps;
  const touch = deps.phone !== null;
  const home = new URL(base).origin;
  const problems: string[] = [];
  const context = await browser.newContext({ ...(deps.phone ?? { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }), serviceWorkers: 'block' });
  // The door: a page may load what it likes from elsewhere, and is taken nowhere but the product and its backend.
  await context.route(
    (url) => url.origin !== home && url.origin !== apiOrigin,
    (route) => (route.request().isNavigationRequest() ? route.abort('aborted') : route.continue()),
  );
  const press = (control: Locator): Promise<void> => (touch ? control.tap({ timeout: PRESS_MS }) : control.click({ timeout: PRESS_MS }));

  /** Opens the product signed out and goes to where its provider buttons are: the first screen, or one press of the sign-in or sign-up marks away. */
  const arrive = async (): Promise<Page> => {
    const page = await context.newPage();
    const marked = page.locator(`[${LOGIN_ATTR}]`).first();
    const there = (): Promise<boolean> => marked.waitFor({ state: 'visible', timeout: LOOK_MS }).then(() => true, () => false);
    await page.goto(`${base}/`, { waitUntil: 'networkidle', timeout: 45_000 }).catch(() => undefined);
    if (await there()) return page;
    for (const id of [SIGN_IN, SIGN_UP]) {
      const lead = page.locator(`[${STEP_ATTR}="${id}:1"]`).first();
      if (!(await lead.isVisible().catch(() => false))) continue;
      await press(lead).catch(() => undefined);
      if (await there()) return page;
      await page.goto(`${base}/`, { waitUntil: 'networkidle', timeout: 45_000 }).catch(() => undefined);
    }
    return page;
  };

  try {
    const first = await arrive();
    const names = await first.locator(`[${LOGIN_ATTR}]`).evaluateAll((els, attr) => els.map((el) => (el.getAttribute(attr) ?? '').trim()), LOGIN_ATTR).catch(() => [] as string[]);
    const offered = [...new Set(names.filter((name) => name !== ''))];
    await first.close().catch(() => undefined);

    for (const name of offered) {
      const mark = `${LOGIN_ATTR}="${name}"`;
      if (!isProvider(name) || !on.includes(name)) {
        problems.push(`The sign-in screen has a button marked ${mark}, and the studio has not set that provider up on this Mac (set up: ${on.length > 0 ? on.join(', ') : 'none'}). Show a button for each provider in the kit's "logins" and for no other.`);
        continue;
      }
      const page = await arrive();
      try {
        const control = page.locator(`[${LOGIN_ATTR}="${name}"]`).first();
        const from = new URL(page.url()).origin;
        const asked: Promise<Request | null> = context.waitForEvent('request', { predicate: (req) => req.url().startsWith(`${apiOrigin}${AUTHORIZE}`), timeout: PRESS_MS }).catch(() => null);
        const pressed = await press(control).then(() => true, () => false);
        const request = pressed ? await asked : null;
        if (!request) {
          problems.push(`Signing in with ${name}: ${pressed ? `the button marked ${mark} was pressed and the backend was not asked to start a sign-in (no request to ${AUTHORIZE})` : `the button marked ${mark} could not be pressed (it is not visible, or lies under another element)`}. The press calls supabase.auth.signInWithOAuth({ provider: '${name}', options: { redirectTo: window.location.origin } }).`);
          continue;
        }
        const query = new URL(request.url()).searchParams;
        if (query.get('provider') !== name) problems.push(`Signing in with ${name}: the button marked ${mark} asked the backend for provider "${query.get('provider') ?? ''}".`);
        const back = query.get('redirect_to');
        if (parsed(back)?.origin !== from) {
          problems.push(`Signing in with ${name}: the person is to come back to ${back ? `"${excerpt(back, 120)}"` : 'no address (redirectTo was not given)'}, and the product is being served at ${from}. A person who signs in there lands somewhere else. Give redirectTo from where the product runs (window.location.origin), never a written-out address.`);
        }
        const answer = await request.response().catch(() => null);
        const to = answer?.headers().location ?? null;
        if (!answer || answer.status() >= 400) {
          const body = answer ? await answer.text().catch(() => '') : '';
          problems.push(`Signing in with ${name}: the backend refused to start it${answer ? ` (${answer.status()}: ${excerpt(body.replace(/\s+/g, ' '), 200)})` : ' (it did not answer)'}.`);
        } else if (parsed(to)?.host !== DOOR[name]) {
          problems.push(`Signing in with ${name}: the backend answered ${answer.status()} and did not send the person to ${DOOR[name]}${to ? ` (it sent them to ${excerpt(to, 120)})` : ''}.`);
        }
      } finally {
        await page.close().catch(() => undefined);
      }
    }
    return { offered, problems };
  } finally {
    await context.close().catch(() => undefined);
  }
}
