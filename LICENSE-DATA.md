# Licence of the generated data

The **code** in this repository is MIT (see `LICENSE`). The **data it
generates** is not, and the difference matters if you deploy an instance.

## `output/dog_forests.geojson` is ODbL

`discover` fills 52 of the 129 missing dog-forest outlines with
`leisure=dog_park` boundaries from OpenStreetMap (`src/hundeskove/osm.py`). That
makes `output/dog_forests.geojson` a **Derived Database** under the
[Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/),
and ODbL's share-alike applies to it.

So: **if you serve, publish or otherwise convey that file, you must offer it
under ODbL**, with attribution to "© OpenStreetMap contributors". Note that
`hundeskove serve` does exactly that — it exposes `output/` at `/data/`, so any
public deployment is conveying the derived database, not merely rendering it.

Rendering the boundaries on a map is a *Produced Work* under ODbL §4.5 and
carries only the attribution requirement, which the page footer satisfies. It
is the raw file at `/data/dog_forests.geojson` that triggers share-alike.

## `output/shelters.*` and `output/availability.*`

Facility records come from [udinaturen.dk](https://udinaturen.dk) / GeoFA-FKG,
Danish public-sector geodata, which has been freely available since 2013.
Availability dates are scraped from
[book.naturstyrelsen.dk](https://book.naturstyrelsen.dk). Neither publishes API
terms, and neither serves a `robots.txt` (checked; both 404). These files carry
no OSM-derived geometry, so ODbL does not reach them — but they are extracts of
someone else's database, and the polite deployment practices in the README's
"Deploying" section are there for that reason.

## Attribution to reproduce

> Facilities and dog forests from udinaturen.dk / GeoFA-FKG. Gap-filled
> dog-forest boundaries and map tiles © OpenStreetMap contributors, ODbL.
