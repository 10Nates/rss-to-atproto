import Parser from "npm:rss-parser";
import { Agent, CredentialSession, RichText } from "npm:@atproto/api";
import persistent from "./persistent.json" with { type: "json" };

const RSS_FEED =
  "https://commons.wikimedia.org/w/api.php?action=featuredfeed&feed=potd&feedformat=rss&language=en";
const DOMAIN = "https://commons.wikimedia.org"
const MISSING_IMG_REPLACE =
  "https://upload.wikimedia.org/wikipedia/commons/a/a2/Nuvola_apps_error.svg";
const MISSING_IMG_ID_REPLACE = "File:Nuvola_apps_error.svg"
const MISSING_SOURCE_REPLACE = "Error parsing image source"
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
): { img_src: string; img_source: string; img_id: string; contentSnippet: string } {
  const imgSrcMatch = item.content?.match(/src="([^"]+)"/);
  const imgSourceMatch = item.content?.match(/href="([^"]+?File:[^"]+?)"/)

  let imgSrc = imgSrcMatch ? imgSrcMatch[1] : MISSING_IMG_REPLACE;
  imgSrc = imgSrc.replace(/\/(\d+?)px/, "/" + IMAGE_THUMB_SIZE + "px");

  const imgSource = imgSourceMatch ? DOMAIN + imgSourceMatch[1] : MISSING_SOURCE_REPLACE;
  const imgID = imgSourceMatch ? imgSourceMatch[1].replace("/wiki/", "") : MISSING_IMG_ID_REPLACE;

  return {
    img_src: imgSrc,
    img_source: imgSource,
    img_id: imgID,
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

function chunkText(text: string): string[] {
  const words = text.split(" ");
  const chunks: string[] = [""]; // It genuinely upsets me that this is recommended by the linter to be a const
  let chunk = 0;
  for (let i = 0; i < words.length; i++) {
    // Including ellipses, this adds up to exactly 300
    if ((chunks[chunk] + " " + words[i]).length > 297) {
      chunks[chunk] += "...";
      chunk++;
      chunks.push("..." + words[i]);
    } else {
      chunks[chunk] += (i > 0 ? " " : "") + words[i];
    }
  }
  return chunks;
}

async function getAuthorInfo(img_id: string): Promise<{ author: string; source: string }> {
  // https://commons.wikimedia.org/w/api.php?action=parse&format=json&page=%IMG_ID%&prop=wikitext&formatversion=2
  const api_url = `https://commons.wikimedia.org/w/api.php?action=parse&format=json&page=${img_id}&prop=wikitext&formatversion=2`;
  const response = await fetch(api_url);
  if (!response.ok) {
      throw new Error(`Failed to fetch author info: ${response.statusText}`);
  }
  const data = await response.json();
  const wikitext = data.parse.wikitext;
  const authorMatch = wikitext.match(/author\s{0,}=(.+?)\n/i);
  const sourceMatch = wikitext.match(/source\s{0,}=(.+?)\n/i);

  // strip formatting
  let author: string = authorMatch ? authorMatch[1].replace(/\[|\]|\{|\}/g, '') : "Unknown";
  author = author.split("|").at(-1) || author; // handle case where author is a reference 

  if (sourceMatch && sourceMatch[1] === "{{own}}") sourceMatch[1] = "Own work"; // Wikimedia formatting for self-publishing
  const source = sourceMatch ? sourceMatch[1].replace(/\[|\]|\{|\}/g, '') : "Unknown";


  return {
      author,
      source,
  };
}

/**
 * Shortens a given URL using the MediaWiki ShortenURL API.
 *
 * @param {string} originalUrl The URL to be shortened.
 * @returns {Promise<string>} A promise that resolves with the shortened URL string.
 * @throws {Error} If the API call fails or the response is not as expected.
 */
export async function shortenWikimediaUrl(originalUrl: string): Promise<string> {
  // Encode the original URL to ensure it's safe for inclusion in the query string.
  const encodedUrl = encodeURIComponent(originalUrl);

  // Construct the full API endpoint URL.
  const apiUrl = `https://www.mediawiki.org/w/api.php?action=shortenurl&format=json&url=${encodedUrl}&formatversion=2`;

  try {
    // Make the asynchronous fetch request to the MediaWiki API.
    const response = await fetch(apiUrl, { method: "POST" });

    // Check if the HTTP response was successful.
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // Parse the JSON response body.
    const data = await response.json();

    // Check if the expected 'shortenurl' object and 'shorturl' property exist in the response.
    if (data && data.shortenurl && data.shortenurl.shorturl) {
      // Return the shortened URL string.
      return data.shortenurl.shorturl;
    } else {
      // If the expected data structure is not found, throw an error.
      throw new Error("Invalid API response structure: 'shorturl' not found.");
    }
  } catch (error) {
    throw error; // Re-throw the error for the caller to handle.
  }
}

async function main() {
  // Login to platform
  console.log("Logging in as " + Deno.env.get("ATP_USERNAME"));
  await atp_session.login({
    identifier: Deno.env.get("ATP_USERNAME") || "",
    password: Deno.env.get("ATP_PASSWORD") || "",
  });
  const atp_agent = new Agent(atp_session);
  atp_agent.assertDid;

  let lastPubDate: Date = new Date(persistent.lastPubDate); // load last post

  const loop = setInterval(async () => {
    try {
      const latestItem = await GetLatestItem();
      const pubDateTime = new Date(latestItem.pubDate ? latestItem.pubDate : 0);
      if (pubDateTime.getTime() <= lastPubDate.getTime()) return;
      // Greater than, update detected
      console.log("New RSS post detected");

      const parsedItem = ParseItem(latestItem);

      // Remove page cache marker
      parsedItem.contentSnippet = parsedItem.contentSnippet.replace("(purge this page's cache)\n", "").replaceAll(/\n{3,}/g, "\n\n")

      // Fix url in the case it is too long
      if (parsedItem.img_source.length > 150) {
        console.log("Shortening image URL...")
        parsedItem.img_source = await shortenWikimediaUrl(parsedItem.img_source)
      }

      // Split every 300 with ellipses 
      const textThread = chunkText(parsedItem.contentSnippet);
      
      // Insert source info
      console.log("Fetching author info...")
      const authorInfo = await getAuthorInfo(parsedItem.img_id);
      const authorText = `Author: ${authorInfo.author}\nSource: ${authorInfo.source}\nImage: ${parsedItem.img_source}`
      const authorTextThread = chunkText(authorText)
      textThread.push(...authorTextThread);

      // Bot uploads very infrequently so this is required
      console.log("Refreshing session...");
      await atp_session.refreshSession();

      console.log("Uploading image...");
      const embed_blob = await CreateEmbed(parsedItem.img_src);

      // Post thread
      const root_rt = new RichText({ text: textThread[0] });
      await root_rt.detectFacets(atp_agent);

      const root_post = await atp_agent.post({
        text: root_rt.text,
        facets: root_rt.facets,
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

      // Prevent reposts
      // This is done early to prevent spamming in case there is an error posting child posts
      lastPubDate = pubDateTime;
      persistent.lastPubDate = pubDateTime.getTime();
      Deno.writeTextFileSync("./persistent.json", JSON.stringify(persistent));

      let last_post = root_post;
      for (let i = 1; i < textThread.length; i++) {
        const rt = new RichText({ text: textThread[i] });
        await rt.detectFacets(atp_agent);

        const post = await atp_agent.post({
          text: rt.text,
          facets: rt.facets,
          tags: POST_TAGS,
          langs: ["en-US"],
          createdAt: new Date().toISOString(),
          reply: {
            root: root_post,
            parent: last_post
          }
        });
        last_post = post;
      }

      console.log("Posted thread. Root: " + root_post.cid + " / " + root_post.uri);
    } catch (error) {
      console.error(error);
      throw error;
    }
  }, UPDATE_FREQ);

  // Graceful exit
  function exit() {
    console.log("Exiting...")
    clearInterval(loop);
    atp_session.logout().finally(() => {
      Deno.exit(0);
    });
    setTimeout(() => {
      console.log("Logout timed out, forcing exit.");
      Deno.exit(1)
    }, 2000);
  }
  Deno.addSignalListener("SIGTERM", exit);
  Deno.addSignalListener("SIGINT", exit);
}

if (import.meta.main) {
  main();
}
