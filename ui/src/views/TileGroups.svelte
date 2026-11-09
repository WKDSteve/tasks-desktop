<script lang="ts">
  // Groups of tiles: one row of tiles under the heading of each group. What a tile is and what its heading holds is
  // the caller's (`tile`, `head`); this draws the rows and moves a tile: the mouse drags it (onto a tile: before that
  // one; onto the free space of a row: to its end), a finger by its grip, and Shift with the arrow keys moves the tile
  // under the cursor (left and right in its row, up and down into the row above or below). Nothing here knows a repo.
  import type { Snippet } from 'svelte';
  import { createGrip, farEnough, placeAt, type PointerDragEvent } from 'appkit-ui/pointerDrag';
  import { dropIndex } from '../lib/repos';

  interface TileGroup {
    id: string;
    title: string;
    tiles: string[];
  }

  let {
    groups,
    label,
    tile,
    head,
    onmove,
    busy = false,
    gripHint = '',
  }: {
    groups: readonly TileGroup[];
    /** The name of the groups for assistive software. */
    label: string;
    /** One tile: its content (a button that opens it, say). */
    tile: Snippet<[string, TileGroup]>;
    /** The heading of a group: its title and what can be done with it. */
    head: Snippet<[TileGroup, number]>;
    /** A tile was moved from the group `from` to the group `to`, to place `index` there. */
    onmove: (id: string, from: string, to: string, index: number) => void;
    /** A change is on its way: nothing is moved. */
    busy?: boolean;
    gripHint?: string;
  } = $props();

  const MIME = 'application/x-appkit-tile';
  let dragging = $state<{ id: string; from: string } | null>(null);
  let over = $state<string | null>(null);

  function start(event: DragEvent, id: string, from: string): void {
    if (busy) {
      event.preventDefault();
      return;
    }
    dragging = { id, from };
    event.dataTransfer?.setData(MIME, id);
    event.dataTransfer?.setData('text/plain', id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  function end(): void {
    dragging = null;
    over = null;
  }

  function enter(event: DragEvent, key: string): void {
    if (!dragging) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    over = key;
  }

  /** A drop onto a tile (`index` is its place) or onto the free space of a row (`index` null: its end). */
  function drop(event: DragEvent, to: TileGroup, index: number | null): void {
    event.preventDefault();
    event.stopPropagation();
    const from = dragging;
    end();
    if (!from) return;
    const source = groups.find((g) => g.id === from.from)?.tiles ?? [];
    onmove(from.id, from.from, to.id, index === null ? to.tiles.length : dropIndex(source, from.id, from.from, to.id, index));
  }

  // A finger or a pen by the grip: the place under the finger (`data-tile-place` is `group:index`, a row `group:end`).
  let downAt = { x: 0, y: 0 };
  const grip = createGrip(
    () => onFinger,
    () => busy,
  );
  function onFinger(e: PointerDragEvent): void {
    const [from = '', id = ''] = JSON.parse(e.id) as [string, string];
    if (e.phase === 'start') {
      dragging = { id, from };
      downAt = { x: e.x, y: e.y };
      return;
    }
    if (!dragging || dragging.id !== id) return;
    if (e.phase === 'move') {
      over = farEnough(downAt, e) ? placeAt(document, e.x, e.y, 'data-tile-place') : null;
      return;
    }
    const place = e.phase === 'end' ? over : null;
    end();
    if (place === null) return;
    const [group = '', at = ''] = place.split(':');
    const target = groups.find((g) => g.id === group);
    const source = groups.find((g) => g.id === from)?.tiles ?? [];
    if (target) onmove(id, from, group, at === 'end' ? target.tiles.length : dropIndex(source, id, from, group, Number(at)));
  }

  /** Shift with an arrow key on a tile: one place on in its row, or into the row above or below (at its end). */
  function onKey(event: KeyboardEvent, id: string, g: number, i: number): void {
    if (!event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || busy) return;
    const group = groups[g];
    if (!group) return;
    let to: { group: string; index: number } | null = null;
    if (event.key === 'ArrowLeft' && i > 0) to = { group: group.id, index: i - 1 };
    else if (event.key === 'ArrowRight' && i < group.tiles.length - 1) to = { group: group.id, index: i + 1 };
    else if (event.key === 'ArrowUp' && g > 0) to = { group: groups[g - 1]!.id, index: groups[g - 1]!.tiles.length };
    else if (event.key === 'ArrowDown' && g < groups.length - 1) to = { group: groups[g + 1]!.id, index: groups[g + 1]!.tiles.length };
    if (!event.key.startsWith('Arrow')) return;
    event.preventDefault();
    if (to) onmove(id, group.id, to.group, to.index);
  }
</script>

<div class="tile-groups" role="group" aria-label={label}>
  {#each groups as group, g (group.id)}
    <section class="group" aria-labelledby={`tile-group-${group.id}`}>
      <div class="head" id={`tile-group-${group.id}`}>{@render head(group, g)}</div>
      <ul
        class="row"
        class:over={over === `${group.id}:end`}
        data-tile-place={`${group.id}:end`}
        ondragover={(e) => enter(e, `${group.id}:end`)}
        ondrop={(e) => drop(e, group, null)}
      >
        {#each group.tiles as id, i (id)}
          <!-- The keys come from the button of the tile inside (they rise to its place); the place is what is dragged. -->
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <li
            class="place"
            class:over={over === `${group.id}:${i}`}
            data-tile-place={`${group.id}:${i}`}
            draggable={!busy}
            ondragstart={(e) => start(e, id, group.id)}
            ondragend={end}
            ondragover={(e) => {
              e.stopPropagation();
              enter(e, `${group.id}:${i}`);
            }}
            ondrop={(e) => drop(e, group, i)}
            onkeydown={(e) => onKey(e, id, g, i)}
          >
            {@render tile(id, group)}
            <span
              class="grip"
              role="presentation"
              aria-hidden="true"
              data-hint={gripHint}
              onpointerdown={(e) => grip(e, JSON.stringify([group.id, id]), 'start')}
              onpointermove={(e) => grip(e, JSON.stringify([group.id, id]), 'move')}
              onpointerup={(e) => grip(e, JSON.stringify([group.id, id]), 'end')}
              onpointercancel={(e) => grip(e, JSON.stringify([group.id, id]), 'cancel')}>⠿</span
            >
          </li>
        {/each}
      </ul>
    </section>
  {/each}
</div>

<style>
  .tile-groups {
    display: grid;
    gap: 1rem;
  }
  .group {
    display: grid;
    gap: 0.4rem;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    min-height: 5.5rem;
    margin: 0;
    padding: 0.4rem;
    list-style: none;
    border: 1px dashed transparent;
    border-radius: var(--radius);
  }
  .row.over,
  .place.over {
    border-color: var(--accent);
  }
  .place {
    position: relative;
    border: 1px solid transparent;
    border-radius: var(--radius);
  }
  .grip {
    position: absolute;
    right: 0.2rem;
    bottom: 0.1rem;
    color: var(--muted);
    cursor: grab;
    touch-action: none;
    user-select: none;
    font-size: 0.8rem;
  }
</style>
