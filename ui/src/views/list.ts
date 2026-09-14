import type { Hit } from "../filters";
import { facilityCard } from "./card";

export function renderList(
  root: HTMLElement,
  hits: Hit[],
  selectedId: string | null,
  onSelect: (id: string) => void,
  highlightDate: string | null = null,
  durations?: Map<string, number>,
): void {
  root.replaceChildren();
  if (hits.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent =
      "Nothing matches these filters. Try more nights, or a larger distance.";
    root.append(empty);
    return;
  }

  for (const { facility, nights } of hits) {
    root.append(
      facilityCard(facility, nights, {
        selected: facility.shelter_id === selectedId,
        onSelect,
        highlightDate,
        driveSeconds: durations?.get(facility.shelter_id) ?? null,
      }),
    );
  }
}
