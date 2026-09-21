# Security / Safe Browsing note

This project is a non-commercial fan-made web game. It is not affiliated with Nintendo or Splatoon.

The web app does not provide login forms, credential collection, software installers, or automatic downloads.
The browser client connects only to the same host over WebSocket for the online match feature.

The server adds security response headers including Content-Security-Policy, X-Content-Type-Options,
X-Frame-Options, Referrer-Policy, Permissions-Policy, and HSTS in production.
