import Parser from "npm:rss-parser";
import { Agent, CredentialSession } from "npm:@atproto/api";
import persistent from "./persistent.json" with { type: "json" };

const RSS_FEED =
  "https://commons.wikimedia.org/w/api.php?action=featuredfeed&feed=potd&feedformat=rss&language=en";
const MISSING_IMG_REPLACE =
  "https://upload.wikimedia.org/wikipedia/commons/a/a2/Nuvola_apps_error.svg";
const MISSING_DESCRIPTION_REPLACE = "No description provided";
const IMAGE_ALT_TEXT = "Wikimedia Commons image of the day";
const POST_TAGS = [
  "wikimedia",
  "pictureoftheday",
  "creativecommons",
  "photography",
]
const IMAGE_THUMB_SIZE = 800;
const UPDATE_FREQ = 60 * 1000; // in ms
const ATP_PROVIDER = "https://bsky.social";

const parser = new Parser();
const atp_session = new CredentialSession(new URL(ATP_PROVIDER));

async function GetLatestItem(): Promise<Parser.Item> {
  const feed = await parser.parseURL(RSS_FEED);
  // filter by pubDate
  feed.items.sort((a, b) =>
    new Date(b.pubDate ? b.pubDate : 0).getTime() -
    new Date(a.pubDate ? a.pubDate : 0).getTime()
  );
  return feed.items[0];
}

function ParseItem(
  item: Parser.Item,
): { img_src: string; contentSnippet: string } {
  const imgSrcMatch = item.content?.match(/src="([^"]+)"/);
  let imgSrc = imgSrcMatch ? imgSrcMatch[1] : MISSING_IMG_REPLACE;
  imgSrc = imgSrc.replace(/\/(\d+?)px/, "/" + IMAGE_THUMB_SIZE + "px");

  return {
    img_src: imgSrc,
    contentSnippet: item.contentSnippet || MISSING_DESCRIPTION_REPLACE,
  };
}

async function CreateEmbed(
  image_url: string,
): Promise<
  { $type: string; ref: { $link: string }; mimeType: string; size: number }
> {
  // get bytes
  const imageResponse = await fetch(image_url);
  if (!imageResponse.ok) {
    throw new Error(`Failed to fetch image: ${imageResponse.statusText}`);
  }
  const mimetype = imageResponse.headers.get("content-type") || "image/jpeg";

  const imgBytes = await imageResponse.blob();
  const response = await atp_session.fetch(
    ATP_PROVIDER + "/xrpc/com.atproto.repo.uploadBlob",
    {
      method: "POST",
      headers: {
        "Content-Type": mimetype,
        "Authorization": "Bearer " + atp_session.session?.accessJwt,
      },
      body: imgBytes,
    },
  );

  if (!response.ok) {
    throw new Error("Network response was not ok " + response.statusText);
  }

  const data = await response.json();
  return data.blob;
}

async function main() {
  // Login to platform
  console.log("Logging in as " + Deno.env.get("ATP_USERNAME"));
  await atp_session.login({
    identifier: Deno.env.get("ATP_USERNAME") || "",
    password: Deno.env.get("ATP_PASSWORD") || "",
  });
  const atp_agent = new Agent(atp_session);
  const _ = atp_agent.assertAuthenticated();

  let lastPubDate: Date = new Date(persistent.lastPubDate); // load last post

  setInterval(async () => {
    try {
      const latestItem = await GetLatestItem();
      const pubDateTime = new Date(latestItem.pubDate ? latestItem.pubDate : 0);
      if (pubDateTime.getTime() <= lastPubDate.getTime()) return;
      // Greater than, update detected
      console.log("New RSS post detected");

      const parsedItem = ParseItem(latestItem);

      // refresh sesion if needed
      if (!(atp_session.hasSession && atp_session.session?.active)) {
        console.log("Refreshing session...");
        await atp_session.refreshSession();
      }

      const embed_blob = await CreateEmbed(parsedItem.img_src);
      const post = await atp_agent.post({
        text: parsedItem.contentSnippet,
        tags: POST_TAGS,
        langs: ["en-US"],
        createdAt: new Date().toISOString(),
        embed: {
          "$type": "app.bsky.embed.images",
          "images": [{
            "alt": IMAGE_ALT_TEXT,
            "image": embed_blob,
          }],
        },
      });

      console.log("Posted: " + post.cid + " / " + post.uri);

      // prevent reposts
      lastPubDate = pubDateTime;
      persistent.lastPubDate = pubDateTime.getTime();
      Deno.writeTextFileSync("./persistent.json", JSON.stringify(persistent));
      
    } catch (error) {
      console.error(error);
      throw error;
    }
  }, UPDATE_FREQ);
}

if (import.meta.main) {
  main();
}
