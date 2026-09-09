# Contributing

Keep contributions UI-free and dependency-free at runtime. Add a synthetic fixture reproducing the failure, run `npm ci && npm test`, and describe state/count/recovery changes in the pull request. Tests must not contact real accounts, message recipients, or require credentials. Preserve copyright and license notices.

Do not submit browser profiles, cookies, proprietary code, service keys, real recipient lists, or screenshots containing private account data. Selector updates need false-positive and stale-element tests, not only a successful click. Treat timing/counting changes as behavior changes and update the documentation.
