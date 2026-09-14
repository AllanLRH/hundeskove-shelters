import { describe, expect, it } from "vitest";

import { aerialLinks, udinaturenFacilityUrl, udinaturenMapUrl } from "../../src/domain/links";
import { buildFacility, FACILITIES } from "../fixtures/dataset";

const facility = FACILITIES[0]!;
const linkFor = (label: string) => aerialLinks(facility).find((l) => l.label === label)!;

describe("aerial links", () => {
  it("sends every service the facility's coordinates", () => {
    for (const link of aerialLinks(facility)) {
      expect(link.href).toContain(String(facility.position.lat));
      expect(link.href).toContain(String(facility.position.lon));
    }
  });

  it("asks each imagery service for aerial rather than its default road map", () => {
    expect(linkFor("Google").href).toContain("data=!3m1!1e3");
    expect(linkFor("Apple").href).toContain("t=k");
    expect(linkFor("Bing").href).toContain("style=h");
    expect(linkFor("Krak").href).toContain("l=hybrid");
  });

  it("drops a pin rather than merely centring the viewport", () => {
    // Centring leaves you guessing which clearing in the trees is the shelter.
    expect(linkFor("Google").href).toContain("/maps/place/");
    expect(linkFor("Apple").href).toContain("q=");
    expect(linkFor("Bing").href).toContain("sp=point.");
    expect(linkFor("Krak").href).toContain("t=coordinates");
    expect(linkFor("OSM").href).toContain("mlat=");
  });

  it("uses no merely-centring form", () => {
    for (const link of aerialLinks(facility)) {
      expect(link.href).not.toContain("map_action=map");
      expect(link.href).not.toContain("?cp=");
    }
  });

  it("marks OSM as map data rather than imagery", () => {
    expect(linkFor("OSM").muted).toBe(true);
  });

  it("is https throughout", () => {
    for (const link of aerialLinks(facility)) {
      expect(link.href.startsWith("https://")).toBe(true);
    }
  });

  it("cannot have its Bing pin truncated by an underscore in a name", () => {
    // encodeURIComponent leaves "_" alone, and Bing splits sp=point. on it.
    const awkward = buildFacility("x", { name: "Shelter_A_B" });
    const bing = aerialLinks(awkward).find((l) => l.label === "Bing")!.href;
    const afterCoords = bing.slice(bing.indexOf("sp=point.") + "sp=point.".length);
    const title = afterCoords.split("_").slice(2).join("_");
    expect(title).not.toContain("_");
  });

  it("falls back to a label when a name is blank", () => {
    // Six facilities have a blank name upstream.
    const unnamed = buildFacility("x", { name: "   " });
    expect(aerialLinks(unnamed).find((l) => l.label === "Apple")!.href).toContain(
      "q=Shelter&",
    );
  });
});

describe("udinaturen links", () => {
  it("aims the layered map at the facility's own region, not all of Denmark", () => {
    // The map cannot be centred on a point, so the region is as tight as it gets.
    const url = udinaturenMapUrl(facility);
    expect(url).toContain(`region=${facility.region}`);
    expect(url).not.toContain("region=81,82,83,84,85");
  });

  it("turns on Hundeskov alongside the facility's own category", () => {
    expect(udinaturenMapUrl(facility)).toContain(`categories=1133,${facility.categoryId}`);
  });

  it("tracks whichever category is asked for", () => {
    for (const categoryId of [1115, 1111, 1112, 1106]) {
      const url = udinaturenMapUrl(buildFacility("x", { categoryId }));
      expect(url).toContain(`categories=1133,${categoryId}`);
    }
  });

  it("builds the per-facility page from the id alone, with no slug to get wrong", () => {
    expect(udinaturenFacilityUrl(facility)).toBe(
      `https://udinaturen.dk/facilitet/?id=${facility.id}`,
    );
  });
});
