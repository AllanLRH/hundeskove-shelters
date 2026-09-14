import type { Match } from "../domain/search";
import type { Night } from "../domain/night";
import type { TravelTimes } from "../domain/travel";
import { facilityCard } from "./card";

export function renderList(
  root: HTMLElement,
  matches: readonly Match[],
  selectedId: string | null,
  onSelect: (id: string) => void,
  highlightNight: Night | null,
  travel: TravelTimes,
): void {
  root.replaceChildren();
  if (matches.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent =
      "Nothing matches these filters. Try more nights, or a larger distance.";
    root.append(empty);
    return;
  }

  for (const { facility, nights } of matches) {
    root.append(
      facilityCard(facility, nights, {
        selected: facility.id === selectedId,
        onSelect,
        highlightNight,
        driveSeconds: travel.get(facility.id) ?? null,
      }),
    );
  }
}
