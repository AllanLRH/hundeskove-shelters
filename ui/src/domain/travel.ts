/**
 * How long it takes to drive to each facility.
 *
 * A value object rather than a bare `Map<string, number>`, so the meaning of
 * the keys and the units cannot be lost while it is threaded through filtering,
 * sorting and rendering — and so "we have no data yet" stays distinguishable
 * from "nowhere is reachable".
 */

export interface Origin {
  lat: number;
  lon: number;
  /** What the geocoder matched, so the user can see it picked the right place. */
  label: string;
}

export class TravelTimes {
  private constructor(private readonly seconds: ReadonlyMap<string, number>) {}

  static empty(): TravelTimes {
    return new TravelTimes(new Map());
  }

  static fromSeconds(entries: Iterable<readonly [string, number]>): TravelTimes {
    return new TravelTimes(new Map(entries));
  }

  /** Driving seconds to a facility, or undefined if it could not be routed. */
  get(facilityId: string): number | undefined {
    return this.seconds.get(facilityId);
  }

  /** False while no lookup has happened, which callers must not read as "nothing is near". */
  get known(): boolean {
    return this.seconds.size > 0;
  }

  get size(): number {
    return this.seconds.size;
  }

  entries(): IterableIterator<[string, number]> {
    return new Map(this.seconds).entries();
  }

  /**
   * Drop entries for facilities that no longer exist.
   *
   * Needed when a refreshed dataset is adopted: these are keyed by facility id,
   * so a departed facility would otherwise keep a drive time attached to it.
   */
  retaining(facilityIds: ReadonlySet<string>): TravelTimes {
    return new TravelTimes(
      new Map([...this.seconds].filter(([id]) => facilityIds.has(id))),
    );
  }
}

/** "1 h 12 min" / "38 min", from seconds. */
export function formatDuration(seconds: number): string {
  const total = Math.round(seconds / 60);
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}
