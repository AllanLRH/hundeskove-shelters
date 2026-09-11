# hundeskove

Finds overnight shelters that sit inside — or close to — a Danish *hundeskov*
(a forest where dogs may roam off-leash), and reports which nights each one is
still free to book.

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
| `--max-distance` | discover | `500` | metres from a dog forest a shelter may be and still count |
| `--months` | availability | `3` | how far ahead to look; 3 is Naturstyrelsen's booking limit |
| `--anchor-step` | availability | `2` | months between calendar anchors; `1` for more overlap |
| `--no-cache` | discover | off | ignore and do not write the place-id cache |

## Output

`output/shelters.json` is the catalogue; `output/availability.json` and
`output/shelters.csv` add the free dates. Rows are sorted with strict
polygon hits first, then by distance.

Two columns matter most:

* **`inside_polygon`** — `true` when the shelter's coordinate really falls
  inside a dog-forest polygon. `distance_m` is then `0.0`.
* **`dog_forest_has_boundary`** — `false` for the 129 of 505 dog forests mapped
  as a bare marker point rather than an outline. Those 23 matches have their
  distance measured to a marker, not to an edge, and can never register as
  inside. Treat their `distance_m` as indicative only.
* **`booking_status`** —
  * `naturstyrelsen` — reservable through book.naturstyrelsen.dk; `available_dates` is populated.
  * `other_operator` — udinaturen says it is bookable, but it belongs to a municipality or a private owner and is reserved through some other system. Follow `booking_url`.
  * `not_bookable` — free / first-come. Still a valid destination.

A national run currently yields 139 shelters, 11 of them strictly inside a dog
forest, out of 1829 shelters and 505 dog forests.

## The APIs

Reverse-engineered; none of this is documented.

### Facility layers — udinaturen.dk

```
GET https://udinaturen.dk/api/map/categories/GetCategoriesByUmbId
      ?region={81..85}&umbId={1133|1115}&organisation=&kommunekoder=
```

`umbId=1133` is dog forests, `umbId=1115` is shelters. `region` is required and
takes a single value, so the five Danish regions need five calls per layer; a
facility near a border comes back from more than one region and is de-duplicated
by `id`.

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
