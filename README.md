# hundeskove

Finds places to stay overnight that sit inside — or close to — a Danish
*hundeskov* (a forest where dogs may roam off-leash), and reports which nights
each one is still free to book.

"Overnight" covers the same four categories as udinaturen's own "Overnat i
naturen" filter — shelters, primitive overnight sites, campsites and
free-camping areas. That matters: **Primitiv overnatningsplads (1111) yields
more strictly-inside hits than shelters do**, from a sixth as many facilities.

## Usage

```sh
uv sync

# Stage 1: which shelters are relevant? (slow, rarely changes)
uv run hundeskove discover

# Stage 2: when are they free? (fast, run as often as you like)
uv run hundeskove availability

# Both, reusing an existing catalogue if there is one
uv run hundeskove run
```

The two stages are deliberately separate: `availability` reads the catalogue
written by `discover` and never re-runs the spatial join or re-scrapes booking
ids. A GUID→place-id cache in `cache/place_ids.json` makes even a repeat
`discover` cheap.

Useful flags:

| Flag | Stage | Default | Meaning |
| --- | --- | --- | --- |
| `--regions` | discover | `81,82,83,84,85` | Danish regions to cover |
| `--categories` | discover | `1115,1111,1112,1106` | facility umbIds to include |
| `--max-distance` | discover | `500` | metres from a dog forest a facility may be and still count |
| `--refresh-osm` | discover | off | re-query Overpass instead of the cached dog parks |
| `--months` | availability | `3` | how far ahead to look; 3 is Naturstyrelsen's booking limit |
| `--anchor-step` | availability | `2` | months between calendar anchors; `1` for more overlap |
| `--no-cache` | discover | off | ignore and do not write the place-id cache |

## Output

`output/shelters.json` is the catalogue; `output/availability.json` and
`output/shelters.csv` add the free dates. Rows are sorted with strict
polygon hits first, then by distance. (The `shelters.*` filenames predate the
broader category coverage and are kept so existing links keep working.)

Columns that matter most:

* **`inside_polygon`** — `true` when the facility really falls inside a
  dog-forest polygon. `distance_m` is then `0.0`.
* **`overlap_fraction`** — for facilities that are themselves *areas* (313 of
  the Frit teltningsområder), the share lying inside the dog forest. An area is
  essentially never wholly contained, so `inside_polygon` stays `false` and this
  is the column carrying the signal. *Kelleris Hegn* is 97.9% inside the dog
  forest of the same name — camp anywhere, dog off-leash.
* **`facility_type`** / **`umb_id`** — which category the row came from.
* **`dog_forest_has_boundary`** — `false` for dog forests mapped as a bare
  marker with no outline. Their `distance_m` is measured to a marker rather than
  an edge, and they can never register as inside. Treat it as indicative only.
* **`geofence_source`** — `fkg` for an official boundary, `osm` for one filled
  in from OpenStreetMap (see below).
* **`booking_status`** —
  * `naturstyrelsen` — reservable through book.naturstyrelsen.dk; `available_dates` is populated.
  * `other_operator` — udinaturen says it is bookable, but it belongs to a municipality or a private owner and is reserved through some other system. Follow `booking_url`.
  * `not_bookable` — free / first-come. Still a valid destination.

A national run currently yields **338 facilities, 27 strictly inside a dog
forest**, from 2757 facilities and 505 dog forests:

| umbId | category | matched | inside | bookable |
| --- | --- | --- | --- | --- |
| 1115 | Shelter | 141 | 11 | 76 |
| 1111 | Primitiv overnatningsplads | 41 | **14** | 0 |
| 1112 | Lejrplads | 32 | 2 | 18 |
| 1106 | Frit teltningsområde | 124 | 0 (see `overlap_fraction`) | 0 |

Note that **every matched 1111 site is free/first-come** — the category with the
most inside-hits needs no booking at all, so `availability` has nothing to add
for it.

## Browser UI

```sh
just setup    # mise install + uv sync + npm install
just ui       # fetch data, build, and serve on http://127.0.0.1:8000
```

Three views over one shared set of filters — a list, a calendar and a map. The
map draws the dog-forest outlines under the facility markers, so "is it really
in the dog forest?" is answerable by eye. It opens on Copenhagen: fitting all
338 matches spans the whole country, at which zoom the outlines are smaller than
a pixel. `Fit to results` zooms out on demand, `Copenhagen` returns.

The filters that matter:

* **Nights.** A night is named by the day you arrive, because a booking runs
  12:00 to 11:00 the next day. **fri–sat and sat–sun are on by default**; the
  other five are a checkbox each. The calendar runs **Monday to Sunday**, the
  Danish/ISO week, and its columns are arrival days — the `Fri` column is the
  fri–sat night.
* **Availability.** Tri-state, because most places have no calendar at all:
  *bookable* (58, real dates), *free / first-come* (244, no booking needed, so
  free every night) and *booked elsewhere* (36, run by a municipality or private
  owner through another system).
* **Certainty.** Five tiers from *inside an official boundary* down to
  *marker only*. **Both *near the boundary* and *marker only* are off by
  default**: the first is merely close to a dog forest rather than in one, and
  the second has no mapped outline at all, so its distance is measured to a pin.
* **Facility type.** **Only *Shelter* is on by default**; the other three
  categories opt in. (If a run excludes shelters entirely, e.g.
  `--categories 1111`, the default falls back to whatever the data contains
  rather than showing nothing.)
* **Proximity.** Max distance, plus a minimum overlap for the facilities that
  are themselves areas.

Those defaults are deliberately strict: out of 338 matches they surface **11** —
the shelters actually inside a dog forest, 7 of them bookable. Widen by ticking
*near the boundary* or the other facility types.

**Seeing which places, and booking them.** Clicking a night in the calendar
opens a detail panel under that month listing the places actually free that
night, each with a direct booking link. Bookable places are listed in full;
first-come ones are free every night by definition, so they sit behind a
disclosure rather than burying the answer. Clicking a marker on the map shows
the same card beneath it, with every free night listed rather than a preview.
The list, the calendar detail and the map selection all render the same card, so
the information never differs between views.

Filter state lives in the URL hash, so a particular view can be bookmarked.

`just dev` runs the Vite dev server with hot reload and reads `output/`
directly. Node is pinned by `mise.toml` and scoped to this directory; it does
not interfere with the uv-managed Python.

## Missing dog-forest boundaries

129 of 505 dog forests have no outline, only a marker. That gap is **real
upstream**, not an artefact of udinaturen: GeoFA/FKG
(`https://geofa.geodanmark.dk/api/v2/sql/fkg`, table `fkg.t_5801_fac_fl`,
`facil_ty_k = 1191`) holds exactly the same 129 points and 376 polygons.

OSM `leisure=dog_park` fills **52** of them. Where both sources have a boundary
they agree at a **median IoU of 0.89**, so they describe the same fences. Only
the 510 `way` dog parks are used; the 16 `relation` ones would need multipolygon
member assembly. A forest is filled only when *exactly one* dog park covers its
marker — ambiguous clusters are left as gaps rather than guessed.

Overpass results are cached in `cache/osm_dog_parks.json`; Overpass is heavily
rate-limited, so a failed fetch is a soft failure that continues with FKG-only
geometry rather than aborting the run.

**Two approaches were measured and rejected** — don't retry them without new
evidence:

* **udinaturen category 1124 "Rekreative naturområder"** is a median **28×
  larger** than the dog forest it contains (max 10,459×). It is the whole
  forest, not the off-leash zone.
* **Subdividing that polygon by OSM roads** (the premise being that a dog forest
  is rarely split by a motor road) lifts median IoU from 0.033 to **0.215** —
  real, but still ~5× too large, versus 0.89 for `leisure=dog_park`. It could
  only ever reach 18 forests, and its error runs toward **false** `inside`
  claims, which for this use case is the harmful direction. A `barrier=fence`
  variant was never scored and remains the one untested angle.

### Attribution

Facility and dog-forest data: udinaturen.dk / GeoFA-FKG. Gap-filled geofences:
**© OpenStreetMap contributors, ODbL**. Redistributing the output as a database
carries ODbL share-alike obligations.

## The APIs

Reverse-engineered; none of this is documented.

### Facility layers — udinaturen.dk

```
GET https://udinaturen.dk/api/map/categories/GetCategoriesByUmbId
      ?region={81..85}&umbId={1133|1115}&organisation=&kommunekoder=
```

`umbId=1133` is dog forests; the overnight categories are `1115`, `1111`, `1112`
and `1106` — exactly what the site's own "VÆLG AKTIVITET" dropdown sends for
"Overnat i naturen". `region` is required and takes a single value, so the five
Danish regions need five calls per layer; a facility near a border comes back
from more than one region and is de-duplicated by `id`.

Geometry is **EPSG:25832 (UTM 32N)** with GeoJSON coordinate nesting. Shelters
are always `MultiPoint`. Both layers share the CRS, so the spatial join needs no
reprojection and distances are plain metres.

The dog-forest layer needs cleaning before any predicate is run against it
(`geo.clean_geometry`):

* **129 of 505 forests are a bare `MultiPoint`** — a marker, not an outline.
* **Zero-area polygon components** written as a ring of one repeated point,
  `[[p, p, p, p]]`. Nine of Kalvebod hundehegn's ten polygons are these; only a
  63,776 m² piece is real. Left in place they make the geometry mixed-dimension,
  which crashes `shapely.make_valid` outright.
* **15 self-intersecting rings.** GEOS predicates on invalid geometry are
  undefined, so these are repaired rather than trusted.
* One forest, *Hundeskov ved Skærum Mølle v/Vemb*, is a 0.5 m² triangle — a
  valid polygon, but plainly a placeholder. It is kept, since dropping it would
  lose the record entirely.

### GUID → booking place id

```
GET https://book.naturstyrelsen.dk/sted/?id={udinaturen GUID}
    -> 302 to /sted/{slug}/, whose HTML contains
       <input type="hidden" name="PID" value="348" />
```

The booking site indexes the same GUIDs, so no name matching is needed. **The
page is Latin-1 encoded.** A 404, or a redirect to the front page, means the
shelter is not run by Naturstyrelsen.

### Availability calendar

```
GET https://book.naturstyrelsen.dk/includes/branding_files/shelterbooking
      /includes/inc_ajaxgetbookingsforsingleplace.asp?i={PID}&d={YYYYMMDD}
```

`BookingDates` are the dates that are **taken**; availability is the complement.

The response window keys off the **calendar month of `d`, ignoring the day**,
and spans that month plus one either side. So a single call anchored on today
does *not* reach three months out — anchors are stepped two months at a time and
the results unioned. The endpoint has no "bookable window" marker, so the
three-month booking limit is clamped client-side.
