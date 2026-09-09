# Build your own host

You can use this code directly, replace selectors for another layout, or study the state machines and reimplement them. Retain the MIT notice in copies and substantial derivatives. This repository includes the sending/opening/recovery implementation, without a graphical interface, account system or configurable hotkeys.

## Minimal integration

1. Load the ES modules into a browser context with access to the target document. The modules do not authenticate or navigate to Snapchat.
2. Obtain explicit permission for the test account and recipients. Supply recipient configuration yourself; do not scrape or import unrelated users.
3. Create one engine with a document, mode, timing, callbacks, and your control exclusion predicate.
4. Trigger `start()` explicitly. Observe progress separately from attempted actions. Await `stop()` before replacing the engine or starting another activity on the same page.
5. Call `dispose()` on teardown. If navigation replaces the document, dispose the old instance and construct a new one.

```js
import {createOpener} from './index.js';

export function prepareApprovedOpening(document, approvedNames, report) {
  const opener = createOpener({
    document,
    mode: 'multi',
    recipients: [...approvedNames],
    multiDelay: 500,
    allowLegacyClickFallback: false,
    isExcludedElement: node => Boolean(node?.closest('[data-my-host]')),
    onState: state => report({kind: 'state', ...state}),
    onProgress: state => report({kind: 'progress', ...state}),
    onError: error => report({kind: 'error', ...error}),
    onReloadRequested: state => report({kind: 'reload-request', ...state}),
  });
  return opener; // The caller explicitly starts/stops it. No GUI is required.
}
```

## What you must supply

- Configuration validation, consent, and an appropriate execution environment.
- Your own UI or command integration, if desired. No UI recreation instructions or proprietary UI source are included.
- Persistence, recipient list management, and orchestration if your application needs them.
- Safe account/session handling through the website itself. This library does not need or receive cookies, passwords, license keys, or API credentials.
- Telemetry that does not disclose private names, content, or session data; redact callback data before sending it elsewhere.
- A stop control and conservative operating limits. Start with one approved cycle, not an unattended bulk run.

## Extending the model

Keep observation, action, and acknowledgement conceptually separate. A new action should declare expected evidence, timeout, retries, and cleanup before implementation. Add fixtures for detached elements, ambiguous candidates, delayed transitions, failed clicks, duplicate evidence, and cancellation. Check counters independently of click counts.

The current modules still contain Snapchat-specific state logic and actual selectors. They are not a generic plug-in driver interface. Porting to another platform requires deliberate changes to selectors, transition evidence, and state logic, not just a URL change. You can introduce your own driver interface around these observations, but do not claim it exists in this version.

Use documented website interfaces where available and comply with applicable platform rules. This project does not provide rate-limit evasion, CAPTCHA bypass, account rotation, private API credentials, or assurances that automation is permitted by a platform.
