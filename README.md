# RSS to AT Protocol: Wikimedia Commons

This is the source code for @wikimediadaily.bsky.social. It was originally designed to be customizable
for other RSS feeds, but too much rigidity was needed to extract the Wikimedia Commons images.

## Operation

- Make a `.env` file with the variables `ATP_USERNAME` and `ATP_PASSWORD` (must be an [App Password](https://bsky.app/settings/app-passwords))
- Initialize `persistent.json` with `{ "lastPubDate": 0 }`
- Run: `deno task start` (`deno run --env-file=.env --allow-env --allow-net --allow-write main.ts`)

## Notice

Keep the [Bluesky terms of service](https://bsky.social/about/support/tos) and [rate limits](https://docs.bsky.app/docs/advanced-guides/rate-limits) in mind when using this program
