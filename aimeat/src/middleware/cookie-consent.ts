import type { RequestHandler, Request, Response, NextFunction } from 'express';
import type { AimeatConfig } from '../config.js';

/**
 * Build the CookieConsent.run() configuration object as a JS string.
 * Categories are built from config.cookieConsentCategories.
 * 'necessary' is always included as enabled + readOnly.
 */
function buildCookieConsentRunConfig(config: AimeatConfig): string {
  // Build categories object
  const categories: Record<string, { enabled?: boolean; readOnly?: boolean }> = {
    necessary: { enabled: true, readOnly: true },
  };
  for (const cat of config.cookieConsentCategories) {
    if (cat !== 'necessary') {
      categories[cat] = {};
    }
  }

  // Build preference sections
  const sections: Array<{ title: string; description?: string; linkedCategory?: string }> = [
    { title: 'Cookie usage', description: 'We use cookies to ensure basic site functionality and to improve your experience.' },
    { title: 'Necessary', linkedCategory: 'necessary' },
  ];
  for (const cat of config.cookieConsentCategories) {
    if (cat !== 'necessary') {
      sections.push({
        title: cat.charAt(0).toUpperCase() + cat.slice(1),
        linkedCategory: cat,
      });
    }
  }

  // Build footer with policy URL if set
  const footer = config.cookieConsentPolicyUrl
    ? `<a href="${config.cookieConsentPolicyUrl}">Privacy Policy</a>`
    : undefined;

  const runConfig = {
    categories,
    guiOptions: {
      consentModal: { layout: 'box', position: 'bottom right' },
      preferencesModal: { layout: 'box' },
    },
    language: {
      default: 'en',
      autoDetect: 'document',
      translations: {
        en: {
          consentModal: {
            title: 'Cookie Settings',
            description: 'This site uses cookies to ensure you get the best experience.',
            acceptAllBtn: 'Accept all',
            acceptNecessaryBtn: 'Reject all',
            showPreferencesBtn: 'Settings',
            ...(footer ? { footer } : {}),
          },
          preferencesModal: {
            title: 'Cookie Preferences',
            acceptAllBtn: 'Accept all',
            acceptNecessaryBtn: 'Reject all',
            savePreferencesBtn: 'Save settings',
            sections,
          },
        },
      },
    },
  };

  return JSON.stringify(runConfig);
}

/**
 * Build the HTML snippet to inject before </body>.
 * Includes the CSS link, UMD script, and CookieConsent.run() call.
 */
function buildInjectSnippet(config: AimeatConfig): string {
  const runConfig = buildCookieConsentRunConfig(config);
  return (
    `<link rel="stylesheet" href="/cookieconsent.css">` +
    `<script src="/cookieconsent.umd.js"></script>` +
    `<script>CookieConsent.run(${runConfig});</script>`
  );
}

/**
 * Express middleware that injects vanilla-cookieconsent banner HTML/JS
 * into HTML responses before </body>.
 *
 * If config.cookieConsentEnabled is false, returns a no-op middleware.
 * The snippet is pre-built once at middleware creation time.
 */
export function cookieConsentMiddleware(config: AimeatConfig): RequestHandler {
  if (!config.cookieConsentEnabled) {
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }

  // Pre-build the snippet once
  const snippet = buildInjectSnippet(config);

  return (_req: Request, res: Response, next: NextFunction) => {
    const originalSend = res.send.bind(res);

    res.send = function (body?: unknown): Response {
      // Only inject into string bodies with text/html content type
      if (typeof body === 'string') {
        const contentType = res.getHeader('Content-Type');
        const ctString = typeof contentType === 'string' ? contentType : '';
        if (ctString.includes('text/html')) {
          const closingBodyIndex = body.lastIndexOf('</body>');
          if (closingBodyIndex !== -1) {
            body = body.slice(0, closingBodyIndex) + snippet + body.slice(closingBodyIndex);
          }
        }
      }
      return originalSend(body);
    };

    next();
  };
}

/**
 * Returns a self-executing JS function (IIFE) that dynamically injects
 * the CSS link, loads the UMD script, and initializes CookieConsent.
 *
 * This is for manual integration via the portal endpoint
 * GET /v1/portal/cookie-consent.js
 */
export function buildStandaloneSnippetJs(config: AimeatConfig): string {
  const runConfig = buildCookieConsentRunConfig(config);

  return `(function(){` +
    `var link=document.createElement('link');` +
    `link.rel='stylesheet';` +
    `link.href='/cookieconsent.css';` +
    `document.head.appendChild(link);` +
    `var script=document.createElement('script');` +
    `script.src='/cookieconsent.umd.js';` +
    `script.onload=function(){CookieConsent.run(${runConfig});};` +
    `document.head.appendChild(script);` +
    `})();`;
}
