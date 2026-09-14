/**
 * Where the dataset comes from, and how a newer one arrives.
 *
 * Data will eventually refresh in the background. The rule that shapes this
 * interface is that **nothing may swap the data underneath the user**: a newer
 * snapshot lands in `pending()` and notifies subscribers, and `current()` only
 * changes when something calls `adopt()`. That is what lets the UI show a
 * "data has changed" banner and update on a click instead of reshuffling the
 * list while it is being read.
 *
 * Only `StaticDatasetSource` exists today. A polling implementation can be
 * added without any view or state transition changing.
 */

import type { Dataset } from "../domain/dataset";

export interface DatasetSnapshot {
  dataset: Dataset;
  /** Two snapshots with the same revision hold the same data. */
  revision: string;
}

export type Unsubscribe = () => void;

export interface DatasetSource {
  current(): DatasetSnapshot;
  /** A newer snapshot, fetched but deliberately not yet in use. */
  pending(): DatasetSnapshot | null;
  subscribe(listener: (pending: DatasetSnapshot) => void): Unsubscribe;
  /** Make the pending snapshot current. Returns the snapshot now in use. */
  adopt(): DatasetSnapshot;
}

/** The dataset's own identity: it changes whenever availability is re-checked. */
export function revisionOf(dataset: Dataset): string {
  return dataset.checkedAt;
}

export function snapshotOf(dataset: Dataset): DatasetSnapshot {
  return { dataset, revision: revisionOf(dataset) };
}

/** One dataset, fetched once. Never produces a pending snapshot. */
export class StaticDatasetSource implements DatasetSource {
  private snapshot: DatasetSnapshot;

  constructor(dataset: Dataset) {
    this.snapshot = snapshotOf(dataset);
  }

  current(): DatasetSnapshot {
    return this.snapshot;
  }

  pending(): DatasetSnapshot | null {
    return null;
  }

  subscribe(): Unsubscribe {
    return () => {};
  }

  adopt(): DatasetSnapshot {
    return this.snapshot;
  }
}

/**
 * A source that can be handed newer data from outside.
 *
 * The base for a future polling implementation, and what tests use to prove
 * that a pending snapshot changes nothing until it is adopted.
 */
export class MutableDatasetSource implements DatasetSource {
  private snapshot: DatasetSnapshot;
  private waiting: DatasetSnapshot | null = null;
  private listeners = new Set<(pending: DatasetSnapshot) => void>();

  constructor(dataset: Dataset) {
    this.snapshot = snapshotOf(dataset);
  }

  current(): DatasetSnapshot {
    return this.snapshot;
  }

  pending(): DatasetSnapshot | null {
    return this.waiting;
  }

  subscribe(listener: (pending: DatasetSnapshot) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Offer newer data. Same revision as current means there is nothing new. */
  offer(dataset: Dataset): void {
    const next = snapshotOf(dataset);
    if (next.revision === this.snapshot.revision) return;
    this.waiting = next;
    for (const listener of this.listeners) listener(next);
  }

  adopt(): DatasetSnapshot {
    if (this.waiting) {
      this.snapshot = this.waiting;
      this.waiting = null;
    }
    return this.snapshot;
  }
}
