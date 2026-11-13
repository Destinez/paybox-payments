# Local merchant receiver

Run `node examples/merchant-receiver/server.mjs`. The demo seed configures its signing secret after registering the merchant endpoint. `POST /control` accepts `{ "fail": true }` or `{ "fail": false }`. `GET /status` reports deduplicated deliveries.

This receiver is for a local demonstration: controls are deliberately unauthenticated and receipts live in memory. A merchant implementation should protect administrative controls, persist receipt IDs and acknowledge only after committing its own work.
