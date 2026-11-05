import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { injectHeroVideo, injectHeroVideoText } from "@/lib/hero-videos/inject";
import { displayName, driveFileIdFrom, formatDuration, isDriveFolderLink, matchCategory, mediaFileName } from "@/lib/hero-videos/names";
import { assembleZip } from "@/lib/site-builder/run";
import { RESERVED_SUBDOMAINS, firstFreeVersion } from "@/lib/site-studio/deploy/naming";
import { buildBoard } from "@/lib/site-studio/deploy/categorize";

const URL_ = "https://sed-media.dmviral.com/hero-videos/kitchen-remodel-2-1oxgnYdQ6yV2.mp4";

/** The slot exactly as the SD Home template's script.js carries it (2026-11-05). */
const SD_HOME_SCRIPT = `
  var HERO = { poster: "media/hero/hero-poster.webp", loop: "https://cdn.dbimg.app/DFQlY3rT.mp4" };
  var CLIPS = { "media/kitchen/kitchen-island.webp": "media/hero/hero-loop.mp4" };
  function fillHero() {
    var box = $("[data-hero-media]");
    box.innerHTML = '<video class="hero__video" src="' + HERO.loop + '" muted playsinline loop preload="none" data-loop-mp4="' + HERO.loop + '"></video>' +
      '<div class="hero__plane" data-gl="hero"></div>';
  }
  function webglMode(done) { img.src = HERO.poster + "?cors-check"; }
`;

describe("injectHeroVideoText — SD Home engine slot", () => {
  it("replaces HERO.loop and nothing else", () => {
    const r = injectHeroVideoText(SD_HOME_SCRIPT, URL_);
    expect(r.replaced).toBe(1);
    expect(r.text).toContain(`loop: "${URL_}"`);
    expect(r.text).not.toContain("cdn.dbimg.app");
    // The poster is only a CORS probe and the clips are the template's own — untouched.
    expect(r.text).toContain('poster: "media/hero/hero-poster.webp"');
    expect(r.text).toContain('"media/hero/hero-loop.mp4"');
  });

  it("makes the hero video a CORS fetch so WebGL may draw it", () => {
    const r = injectHeroVideoText(SD_HOME_SCRIPT, URL_);
    expect(r.text).toContain(`'<video crossorigin="anonymous" class="hero__video" src="' + HERO.loop`);
  });

  it("is idempotent — a second pass changes nothing", () => {
    const once = injectHeroVideoText(SD_HOME_SCRIPT, URL_).text;
    const twice = injectHeroVideoText(once, URL_).text;
    expect(twice).toBe(once);
    expect(twice.match(/crossorigin/g)?.length).toBe(1);
  });

  it("leaves scripts without the slot alone", () => {
    const js = `var HEROES = { loop: "x" }; const hero = { loop: "y" };`;
    expect(injectHeroVideoText(js, URL_)).toEqual({ text: js, replaced: 0 });
  });
});

describe("injectHeroVideoText — <video data-hero-video> slot", () => {
  it("rewrites src, <source> and crossorigin", () => {
    const html = `<section><video class="bg" data-hero-video autoplay muted loop playsinline src="demo.mp4" crossorigin="use-credentials"><source src="demo.mp4" type="video/mp4"></video></section>`;
    const r = injectHeroVideoText(html, URL_);
    expect(r.replaced).toBe(1);
    expect(r.text).toBe(
      `<section><video class="bg" data-hero-video autoplay muted loop playsinline src="${URL_}" crossorigin="anonymous"><source src="${URL_}" type="video/mp4"></video></section>`,
    );
  });

  it("does not touch other videos", () => {
    const html = `<video src="other.mp4"></video>`;
    expect(injectHeroVideoText(html, URL_).replaced).toBe(0);
  });
});

describe("injectHeroVideo / assembleZip", () => {
  const enc = new TextEncoder();

  it("only rewrites text files that carry a slot", () => {
    const files = { "script.js": enc.encode(SD_HOME_SCRIPT), "style.css": enc.encode("a{}"), "media/x.mp4": new Uint8Array([1, 2]) };
    const r = injectHeroVideo(files, URL_);
    expect(r.replaced).toBe(1);
    expect(r.files["style.css"]).toBe(files["style.css"]);
    expect(r.files["media/x.mp4"]).toBe(files["media/x.mp4"]);
  });

  it("packs the video URL into the zip, covering generated pages too", () => {
    const zip = assembleZip(
      { "script.js": enc.encode(SD_HOME_SCRIPT) },
      { "index.html": { status: "ok", kind: "existing", html: "<h1>Hi</h1>" } },
      { heroVideoUrl: URL_ },
    );
    const files = unzipSync(zip);
    expect(strFromU8(files["script.js"])).toContain(URL_);
    expect(strFromU8(files["index.html"])).toBe("<h1>Hi</h1>");
  });

  it("refuses to pack a video-hero site whose template has no slot", () => {
    expect(() =>
      assembleZip({ "script.js": enc.encode("console.log(1)") }, {}, { heroVideoUrl: URL_ }),
    ).toThrow(/no hero video slot/);
  });

  it("packs exactly as before without a hero video", () => {
    const zip = assembleZip({ "script.js": enc.encode(SD_HOME_SCRIPT) }, {});
    expect(strFromU8(unzipSync(zip)["script.js"])).toBe(SD_HOME_SCRIPT);
  });
});

describe("names", () => {
  it("displayName strips the extension", () => {
    expect(displayName("Kitchen Remodel 2.mp4")).toBe("Kitchen Remodel 2");
    expect(displayName("HVAC.MOV")).toBe("HVAC");
  });

  it("mediaFileName is a readable slug plus the head of the Drive id", () => {
    expect(mediaFileName("Kitchen Remodel 2", "1oxgnYdQ6yV2.mp4xxxx")).toBe("kitchen-remodel-2-1oxgnYdQ6yV2.mp4");
    expect(mediaFileName("Insulation Installation", "1CuddDnTUIuRNK_oAb0Alryu")).toBe("insulation-installation-1CuddDnTUIuR.mp4");
    expect(mediaFileName("!!!", "abc")).toBe("video-abc.mp4");
  });

  it("driveFileIdFrom reads every common Drive file link", () => {
    const id = "1oxgnYdQ6yV2jtRsQuYHENmgvd1v7dQA8";
    expect(driveFileIdFrom(`https://drive.google.com/file/d/${id}/view?usp=sharing`)).toBe(id);
    expect(driveFileIdFrom(`https://drive.google.com/open?id=${id}`)).toBe(id);
    expect(driveFileIdFrom(`https://drive.google.com/uc?export=download&id=${id}`)).toBe(id);
    expect(driveFileIdFrom(`https://drive.usercontent.google.com/download?id=${id}&export=download`)).toBe(id);
    expect(driveFileIdFrom(id)).toBe(id);
    expect(driveFileIdFrom("https://example.com/video.mp4")).toBe("");
    expect(driveFileIdFrom("")).toBe("");
  });

  it("isDriveFolderLink spots a folder pasted where a file belongs", () => {
    expect(isDriveFolderLink("https://drive.google.com/drive/folders/1Njg6srHLTHKBBwsgSz9R0adFkOnAqyP3?usp=sharing")).toBe(true);
    expect(isDriveFolderLink("https://drive.google.com/file/d/1oxgnYdQ6yV2jtRsQuYHENmgvd1v7dQA8/view")).toBe(false);
  });

  it("matchCategory opens the gallery on the lead's trade when the library has it", () => {
    const cats = ["Bathroom Remodel", "Decks", "Flooring", "HVAC", "Kitchen Remodel", "Roofing"];
    expect(matchCategory("Flooring", cats)).toBe("Flooring");
    expect(matchCategory("hvac", cats)).toBe("HVAC");
    expect(matchCategory("Decking", cats)).toBe("Decks");
    expect(matchCategory("Auto Repair", cats)).toBeNull();
    expect(matchCategory("", cats)).toBeNull();
    expect(matchCategory(null, cats)).toBeNull();
  });

  it("formatDuration", () => {
    expect(formatDuration(20_000)).toBe("0:20");
    expect(formatDuration(65_400)).toBe("1:05");
    expect(formatDuration(null)).toBe("");
  });
});

describe("the media subdomain is reserved", () => {
  it("is never handed to a client site", async () => {
    const [reserved] = [...RESERVED_SUBDOMAINS];
    expect(reserved).toBe("sed-media");
    expect(await firstFreeVersion("sed-media", async () => false)).toBe("sed-media-2");
  });

  it("is not listed on the deployments board", () => {
    const rows = buildBoard([], ["sed-media", "acme"], [], "dmviral.com");
    expect(rows.map((r) => r.subdomain)).toEqual(["acme"]);
  });
});
