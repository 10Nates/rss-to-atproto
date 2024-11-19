# RSS to AT Protocol: Wikimedia Commons

This is the source code for @wikimediadaily.bsky.social. It's designed to be customizable
for other RSS feeds, but some rigidity is needed to extract the Wikimedia Commons images.

## Operation

- Make a `.env` file with the variables `ATP_USERNAME` and `ATP_PASSWORD` (must be an [App Password](https://bsky.app/settings/app-passwords))
- Initialize `persistent.json` with `{ "lastPubDate": 0 }`
- Run:
  - Without Docker: `deno task start` (`deno run --env-file=.env --allow-env --allow-net --allow-write main.ts`)
  - With Docker: `docker build -t rss-to-atp . && docker run -d --restart=always --name wikimedia-commons-daily-bluesky rss-to-atp`

## Notice

Keep the [Bluesky terms of service](https://bsky.social/about/support/tos) and [rate limits](https://docs.bsky.app/docs/advanced-guides/rate-limits) in mind when using this program
