# Reproducible tests and limits

Install Node 22 or newer, run `npm ci`, then `npm test`. Runtime modules have no package dependencies; jsdom is used only in tests. Nothing in this command contacts Snapchat or sends a real message.

The suite currently has 51 tests: 15 baseline tests and 36 expanded recovery/cancellation tests. It checks public API lifecycle, dependency-free import, instance isolation, canvas patch leases, matching/cache behavior, sender nickname and shortcut flows, both opener modes, timing, counting, and cancellation. See test names for the exact assertions.

## Controlled time

`tests/helpers.js` provides an in-memory scheduler and a seeded linear-congruential random generator. Six named seeds vary transition/action delays in each sender mode. The sender accepts `random` so internal probabilistic yielding can also be controlled. Browser event/microtask processing is not globally replaced: the scheduler drains microtasks around controlled deadlines. Tests have explicit run limits to turn runaway recovery into a failure.

Cancellation tests stop at each reported state and assert stable post-stop state and no pending controlled timers. Delayed transition tests verify acknowledgement and one-count behavior. Exhaustion tests verify a missing shortcut Select button and absent final acknowledgement never become a successful count.

## Real-browser validation is separate

This repository tests the core modules, not a complete browser extension or application. If you build a host around them, add isolated real-browser tests for its rendering, controls, permissions, storage, navigation and lifecycle. Block external network access and use synthetic pages in automated tests.

Fixture passes are not proof of live Snapchat delivery. This core's jsdom fixtures do not reproduce trusted input events, camera permissions, all layout/locale variants, every recovery branch, browser rendering behavior, or server acknowledgement. Integration checks for a host application are separate from `npm test`.

Before live acceptance, use only approved accounts and recipients. Verify individual operations manually and keep real messaging outside automated CI. Never add production license keys, email accounts, session tokens, cookies, or private runtime files to fixtures.
