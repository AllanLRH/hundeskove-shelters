/**
 * Outbound links for a facility: aerial imagery, and udinaturen's own map.
 *
 * Pure string building, so every URL contract here is asserted in tests rather
 * than discovered by clicking.
 */

import type { Facility } from "./facility";

const AERIAL_ZOOM = 18;

export interface MapLink {
  label: string;
  href: string;
  /** True for links that show map data rather than aerial imagery. */
  muted?: boolean;
  title?: string;
}

/**
 * Where to look at the terrain around a facility.
 *
 * Aerial imagery, because the question these answer is what is actually on the
 * ground — tree cover, a clearing, how far the water is — which a road map
 * cannot show. Every one drops a **pin**, the way pasting coordinates into the
 * service's own search box would; merely centring the viewport leaves you
 * guessing which clearing is the shelter.
 */
export function aerialLinks(facility: Facility): MapLink[] {
  const { lat, lon } = facility.position;
  // Six facilities have a blank name upstream; pin something rather than nothing.
  const label = facility.name.trim() || "Shelter";
  // encodeURIComponent leaves "_" alone and Bing splits sp=point. on it, so a
  // name containing one would silently truncate the pin.
  const pinLabel = encodeURIComponent(label).replaceAll("_", "%5F");
  return [
    {
      label: "Google",
      // The form Google itself produces for a searched coordinate switched to
      // satellite: /place/ gives the pin, data=!3m1!1e3 the imagery. The
      // documented ?api=1 form can do one or the other, never both.
      href: `https://www.google.com/maps/place/${lat},${lon}/@${lat},${lon},${AERIAL_ZOOM}z/data=!3m1!1e3`,
    },
    {
      // MapKit URL scheme: q alongside ll labels a pin at ll rather than
      // running a search; t=k is satellite.
      label: "Apple",
      href: `https://maps.apple.com/?q=${encodeURIComponent(label)}&ll=${lat},${lon}&z=${AERIAL_ZOOM}&t=k`,
    },
    {
      // sp=point.lat_lon_title drops a labelled pushpin; style=h is aerial with labels.
      label: "Bing",
      href: `https://www.bing.com/maps?sp=point.${lat}_${lon}_${pinLabel}&lvl=${AERIAL_ZOOM}&style=h`,
    },
    {
      // Mirrors a URL confirmed working in a browser; krak.dk sits behind a
      // Cloudflare challenge so it could not be verified by fetching. The
      // example's trailing som= token is a session id and is deliberately
      // dropped. t=coordinates is what drops the pin, l=hybrid is Luftfoto.
      label: "Krak",
      href: `https://www.krak.dk/kort/s%C3%B8g/${lat}%2C+${lon}?t=coordinates&c=${lat},${lon}&l=hybrid&z=${AERIAL_ZOOM}&fit=true`,
    },
    {
      label: "OSM",
      href: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`,
      muted: true,
      title: "OpenStreetMap — map data, no imagery",
    },
  ];
}

/**
 * udinaturen's map with the Hundeskov layer and this facility's category on.
 *
 * It cannot be centred on a point: its view is only ever driven by fitting to
 * the checked regions, and OpenLayers' Link control (which would sync x/y/z to
 * the URL) is in the bundle but never instantiated — verified by loading the
 * page with x/y/z set and watching the view not move. So this is aimed at the
 * facility's own region, which is as tight as the site allows.
 */
export function udinaturenMapUrl(facility: Facility): string {
  return `https://udinaturen.dk/kort/?region=${facility.region}&categories=1133,${facility.categoryId}`;
}

/**
 * udinaturen's page for this exact facility, whose embedded map *is* centred
 * on it. The slug segment is decorative — the GUID alone serves the right page.
 * That map carries no Hundeskov layer, which is why both links are offered.
 */
export function udinaturenFacilityUrl(facility: Facility): string {
  return `https://udinaturen.dk/facilitet/?id=${facility.id}`;
}
